"""Event listeners that connect existing Hue/HueMixLink events to the automation engine."""
from __future__ import annotations

import logging
import threading
import time as _time
from datetime import datetime
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)


class EventTriggerManager:
    """Manages subscriptions to core events and feeds them to the automation engine."""

    def __init__(self, engine, hue_state_manager=None, network_server=None):
        self._engine = engine
        self._hue_state_manager = hue_state_manager
        self._network_server = network_server
        self._subscribed = False
        self._scheduler_running = False
        self._scheduler_thread = None
        self._lock = threading.RLock()
        self._prev_room_state = {}
        self._prev_zone_state = {}

    def start(self) -> None:
        """Subscribe to all relevant events."""
        with self._lock:
            if self._subscribed:
                return

            if self._hue_state_manager:
                self._hue_state_manager.subscribe_light_changes(self._on_light_changed)
                self._hue_state_manager.subscribe_scene_changes(self._on_scene_changed)
                self._hue_state_manager.subscribe_room_changes(self._on_room_changed)
                self._hue_state_manager.subscribe_zone_changes(self._on_zone_changed)
                logger.info("Subscribed to Hue state manager events")

            self._subscribed = True
            self._start_scheduler()
            logger.info("EventTriggerManager started")

    def stop(self) -> None:
        """Unsubscribe from events."""
        with self._lock:
            if not self._subscribed:
                return

            if self._hue_state_manager:
                self._hue_state_manager.unsubscribe_light_changes(self._on_light_changed)
                self._hue_state_manager.unsubscribe_scene_changes(self._on_scene_changed)
                self._hue_state_manager.unsubscribe_room_changes(self._on_room_changed)
                self._hue_state_manager.unsubscribe_zone_changes(self._on_zone_changed)

            self._subscribed = False
            self._stop_scheduler()
            logger.info("EventTriggerManager stopped")

    def feed_motion_event(self, sensor_mac: str, action: int, light_level: Optional[int] = None,
                          battery_mv: Optional[int] = None) -> None:
        """Feed a motion event from the automation engine."""
        event_data = {
            'sensor_mac': sensor_mac,
            'action': 'motion_detected',
            'light_level': light_level,
            'battery_mv': battery_mv,
            'target_id': sensor_mac,
        }
        self._engine.handle_event('motion_detected', event_data, target_id=sensor_mac)

    def feed_door_event(self, sensor_mac: str, action: int, light_level: Optional[int] = None,
                        battery_mv: Optional[int] = None) -> None:
        """Feed a door event from the automation engine."""
        action_map = {11: 'opened', 12: 'closed'}
        action_str = action_map.get(action, f'unknown_{action}')
        trigger_type = f'door_{action_str}'

        event_data = {
            'sensor_mac': sensor_mac,
            'action': action_str,
            'action_code': action,
            'light_level': light_level,
            'battery_mv': battery_mv,
            'target_id': sensor_mac,
        }
        self._engine.handle_event(trigger_type, event_data, target_id=sensor_mac)

    def feed_startup(self) -> None:
        """Feed a startup event."""
        self._engine.handle_event('startup', {})

    def _on_light_changed(self, light_id: str, new_state: Dict, old_state: Dict) -> None:
        """Handle individual light state change from SSE."""
        changed = []
        if new_state.get('on') != old_state.get('on'):
            changed.append('on')
        if new_state.get('brightness') != old_state.get('brightness'):
            changed.append('brightness')
        if new_state.get('xy') != old_state.get('xy'):
            changed.append('color')
        if new_state.get('ct') != old_state.get('ct'):
            changed.append('color')

        if not changed:
            return

        event_data = {
            'light_id': light_id,
            'target_id': light_id,
            'new_state': new_state,
            'old_state': old_state,
            'changed_attributes': changed,
        }
        self._engine.handle_event('light_state_change', event_data, target_id=light_id)

    def _on_scene_changed(self, group_id: str, scene_id: Optional[str],
                          old_scene_id: Optional[str], source: str) -> None:
        """Handle scene change from SSE or internal."""
        event_data = {
            'room_id': group_id,
            'target_id': group_id,
            'scene_id': scene_id,
            'old_scene_id': old_scene_id,
            'source': source,
            'changed_attributes': ['scene'],
        }
        self._engine.handle_event('room_state_change', event_data, target_id=group_id)

    def _on_room_changed(self, room_id: str, room_state: Dict) -> None:
        """Handle room on/off or brightness change."""
        old = self._prev_room_state.get(room_id, {})
        changed = []
        if room_state.get('is_on') != old.get('is_on'):
            changed.append('on')
        if room_state.get('avg_brightness') != old.get('avg_brightness'):
            changed.append('brightness')
        if room_state.get('current_scene_id') != old.get('current_scene_id'):
            changed.append('scene')
        self._prev_room_state[room_id] = dict(room_state)
        if not changed:
            return
        event_data = {
            'room_id': room_id,
            'target_id': room_id,
            'room_state': room_state,
            'changed_attributes': changed,
        }
        self._engine.handle_event('room_state_change', event_data, target_id=room_id)

    def _on_zone_changed(self, zone_id: str, zone_state: Dict) -> None:
        """Handle zone on/off or brightness change."""
        old = self._prev_zone_state.get(zone_id, {})
        changed = []
        if zone_state.get('is_on') != old.get('is_on'):
            changed.append('on')
        if zone_state.get('avg_brightness') != old.get('avg_brightness'):
            changed.append('brightness')
        if zone_state.get('current_scene_id') != old.get('current_scene_id'):
            changed.append('scene')
        self._prev_zone_state[zone_id] = dict(zone_state)
        if not changed:
            return
        event_data = {
            'room_id': zone_id,
            'target_id': zone_id,
            'zone_state': zone_state,
            'changed_attributes': changed,
        }
        self._engine.handle_event('room_state_change', event_data, target_id=zone_id)

    def _start_scheduler(self) -> None:
        if self._scheduler_running:
            return
        self._scheduler_running = True
        self._scheduler_thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self._scheduler_thread.start()
        logger.info("Time-of-day scheduler started")

    def _stop_scheduler(self) -> None:
        self._scheduler_running = False
        if self._scheduler_thread:
            self._scheduler_thread.join(timeout=5)
            self._scheduler_thread = None
        logger.info("Time-of-day scheduler stopped")

    def _scheduler_loop(self) -> None:
        last_minute = None
        while self._scheduler_running:
            now = datetime.now()
            current_minute = (now.hour, now.minute)
            if current_minute != last_minute:
                last_minute = current_minute
                try:
                    self._engine.handle_event('time_of_day', {})
                except Exception as e:
                    logger.error(f"Error in time_of_day scheduler: {e}")
            _time.sleep(1)
