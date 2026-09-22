"""Action executor for automation rules."""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable, Dict, Optional

from .models import Action

logger = logging.getLogger(__name__)


class ActionExecutor:
    """Executes automation actions against Hue lights and groups."""

    def __init__(self, hue_controller=None, hue_state_manager=None, network_server=None):
        self._hue = hue_controller
        self._hue_state_manager = hue_state_manager
        self._network_server = network_server
        self._execution_lock = threading.RLock()
        self._origin_tracker: set = set()  # track rule-originated changes
        self._origin_lock = threading.Lock()

    def mark_origin(self, key: str) -> None:
        """Mark a change as originating from automation (to prevent loops)."""
        with self._origin_lock:
            self._origin_tracker.add(key)

    def is_originated_from_automation(self, key: str) -> bool:
        """Check if a change key was originated by this automation system."""
        with self._origin_lock:
            return key in self._origin_tracker

    def consume_origin(self, key: str) -> bool:
        """Consume and return whether a change was originated by automation."""
        with self._origin_lock:
            if key in self._origin_tracker:
                self._origin_tracker.discard(key)
                return True
            return False

    def execute(self, action: Action, event_data: Optional[Dict] = None) -> bool:
        """Execute a single action.

        Args:
            action: The action to execute
            event_data: Context data from the triggering event

        Returns:
            True if action succeeded, False otherwise
        """
        try:
            handler = getattr(self, f'_exec_{action.type}', None)
            if handler:
                return handler(action, event_data)
            logger.warning(f"Unknown action type: {action.type}")
            return False
        except Exception as e:
            logger.error(f"Error executing action '{action.type}': {e}")
            return False

    def execute_all(self, actions, event_data=None) -> bool:
        """Execute a list of actions sequentially.

        Args:
            actions: List of Action objects
            event_data: Context data from the triggering event

        Returns:
            True if all actions succeeded
        """
        all_ok = True
        for action in actions:
            if not self.execute(action, event_data):
                all_ok = False
        return all_ok

    def _resolve_light_id(self, action: Action, event_data=None) -> Optional[str]:
        if action.target_id and action.target_type == 'light':
            return action.target_id
        if action.target_id:
            return action.target_id
        if event_data:
            return event_data.get('light_id') or event_data.get('target_id')
        return None

    def _resolve_group(self, action: Action, event_data=None) -> tuple:
        if action.group_id:
            return action.group_id, action.group_type or 'room'
        if action.target_type in ('room', 'zone'):
            return action.target_id, action.target_type
        return None, 'room'

    def _exec_set_light_brightness(self, action: Action, event_data=None) -> bool:
        group_id, group_type = self._resolve_group(action, event_data)
        if group_id:
            return self._exec_group_brightness(action, group_id, group_type, event_data)
        light_id = self._resolve_light_id(action, event_data)
        if not light_id or not self._hue:
            return False
        brightness = action.brightness
        if brightness is None:
            return False

        origin_key = f"light:{light_id}:brightness"
        self.mark_origin(origin_key)

        try:
            payload = {'dimming': {'brightness': float(brightness)}}
            self._hue.set_light(light_id, payload)

            if self._hue_state_manager:
                self._hue_state_manager.update_light(light_id=light_id, brightness=float(brightness))

            logger.info(f"Set light {light_id} brightness to {brightness}%")
            return True
        except Exception as e:
            logger.error(f"Failed to set light {light_id} brightness: {e}")
            return False

    def _exec_group_brightness(self, action: Action, group_id: str, group_type: str, event_data=None) -> bool:
        if not group_id or not self._hue:
            return False
        brightness = action.brightness
        if brightness is None:
            return False

        origin_key = f"group:{group_id}:brightness"
        self.mark_origin(origin_key)

        try:
            grouped_light_id = self._resolve_grouped_light_id(group_id, group_type)
            if not grouped_light_id:
                return False
            payload = {'dimming': {'brightness': float(brightness)}}
            self._hue._put_resource('grouped_light', grouped_light_id, payload)
            if action.force and self._hue_state_manager:
                if group_type == 'zone':
                    self._hue_state_manager.update_zone(zone_id=group_id, brightness=float(brightness))
                else:
                    self._hue_state_manager.update_room(room_id=group_id, brightness=float(brightness))
            logger.info(f"Set {group_type} {group_id} brightness to {brightness}%")
            return True
        except Exception as e:
            logger.error(f"Failed to set {group_type} {group_id} brightness: {e}")
            return False

    def _exec_set_light_on(self, action: Action, event_data=None) -> bool:
        light_id = self._resolve_light_id(action, event_data)
        if not light_id or not self._hue:
            return False

        origin_key = f"light:{light_id}:on"
        self.mark_origin(origin_key)

        try:
            payload = {'on': {'on': True}}
            if action.brightness is not None:
                payload['dimming'] = {'brightness': float(action.brightness)}
            self._hue.set_light(light_id, payload)

            if self._hue_state_manager:
                self._hue_state_manager.update_light(light_id=light_id, is_on=True)

            logger.info(f"Turned on light {light_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to turn on light {light_id}: {e}")
            return False

    def _exec_set_light_off(self, action: Action, event_data=None) -> bool:
        light_id = self._resolve_light_id(action, event_data)
        if not light_id or not self._hue:
            return False

        origin_key = f"light:{light_id}:on"
        self.mark_origin(origin_key)

        try:
            payload = {'on': {'on': False}}
            self._hue.set_light(light_id, payload)

            if self._hue_state_manager:
                self._hue_state_manager.update_light(light_id=light_id, is_on=False)

            logger.info(f"Turned off light {light_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to turn off light {light_id}: {e}")
            return False

    def _exec_set_light_color(self, action: Action, event_data=None) -> bool:
        light_id = self._resolve_light_id(action, event_data)
        if not light_id or not self._hue:
            return False

        origin_key = f"light:{light_id}:color"
        self.mark_origin(origin_key)

        try:
            payload = {}
            if action.xy:
                payload['color'] = {'xy': {'x': action.xy['x'], 'y': action.xy['y']}}
            if action.ct:
                payload['color_temperature'] = {'mirek': int(action.ct)}

            if not payload:
                return False

            self._hue.set_light(light_id, payload)
            if self._hue_state_manager:
                update_kwargs = {}
                if action.xy:
                    update_kwargs['xy'] = action.xy
                if action.ct:
                    update_kwargs['ct'] = action.ct
                if update_kwargs:
                    self._hue_state_manager.update_light(light_id=light_id, **update_kwargs)
            logger.info(f"Set light {light_id} color: {payload}")
            return True
        except Exception as e:
            logger.error(f"Failed to set light {light_id} color: {e}")
            return False

    def _exec_call_scene(self, action: Action, event_data=None) -> bool:
        scene_id = action.scene_id
        if not scene_id or not self._hue:
            return False

        try:
            payload = {'recall': {'action': 'active'}}
            self._hue.set_scene(scene_id, payload)
            logger.info(f"Activated scene {scene_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to activate scene {scene_id}: {e}")
            return False

    def _exec_turn_off_room(self, action: Action, event_data=None) -> bool:
        group_id, group_type = self._resolve_group(action, event_data)
        if not group_id or not self._hue:
            return False

        origin_key = f"group:{group_id}:off"
        self.mark_origin(origin_key)

        try:
            grouped_light_id = self._resolve_grouped_light_id(group_id, group_type)
            if not grouped_light_id:
                return False
            payload = {'on': {'on': False}}
            self._hue._put_resource('grouped_light', grouped_light_id, payload)
            if self._hue_state_manager:
                if group_type == 'zone':
                    self._hue_state_manager.update_zone(zone_id=group_id, is_on=False)
                else:
                    self._hue_state_manager.update_room(room_id=group_id, is_on=False)
            logger.info(f"Turned off {group_type} {group_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to turn off {group_type} {group_id}: {e}")
            return False

    def _exec_turn_on_room(self, action: Action, event_data=None) -> bool:
        group_id, group_type = self._resolve_group(action, event_data)
        if not group_id or not self._hue:
            return False

        origin_key = f"group:{group_id}:on"
        self.mark_origin(origin_key)

        try:
            grouped_light_id = self._resolve_grouped_light_id(group_id, group_type)
            if not grouped_light_id:
                return False
            payload = {'on': {'on': True}}
            self._hue._put_resource('grouped_light', grouped_light_id, payload)
            if self._hue_state_manager:
                if group_type == 'zone':
                    self._hue_state_manager.update_zone(zone_id=group_id, is_on=True)
                else:
                    self._hue_state_manager.update_room(room_id=group_id, is_on=True)
            logger.info(f"Turned on {group_type} {group_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to turn on {group_type} {group_id}: {e}")
            return False

    def _exec_delay(self, action: Action, event_data=None) -> bool:
        seconds = action.seconds or 0
        if seconds > 0:
            logger.debug(f"Delaying {seconds}s")
            time.sleep(seconds)
        return True

    def _exec_log_message(self, action: Action, event_data=None) -> bool:
        msg = action.message or "Automation log"
        logger.info(f"[Automation] {msg}")
        return True

    def _resolve_grouped_light_id(self, group_id: str, group_type: str = 'room') -> Optional[str]:
        if self._hue_state_manager:
            if group_type == 'zone':
                state = self._hue_state_manager.get_zone_state(group_id)
            else:
                state = self._hue_state_manager.get_room_state(group_id)
            if state:
                gl_id = state.get('grouped_light_id')
                if gl_id:
                    return gl_id

        if not self._hue:
            return None

        try:
            group = self._hue.get_group(group_id, group_type)
            for service in group.get('services', []):
                if service.get('rtype') == 'grouped_light':
                    return service.get('rid')
        except Exception as e:
            logger.error(f"Failed to resolve grouped_light for {group_type} {group_id}: {e}")
        return None
