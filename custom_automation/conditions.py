"""Condition evaluator for automation rules."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

from .models import Condition

logger = logging.getLogger(__name__)


class ConditionEvaluator:
    """Evaluates whether conditions are met given the current state."""

    def __init__(self, hue_state_manager=None, device_manager=None):
        self._hue_state_manager = hue_state_manager
        self._device_manager = device_manager

    def evaluate(self, condition: Condition, event_data: Optional[Dict] = None) -> bool:
        """Evaluate a single condition.

        Args:
            condition: The condition to evaluate
            event_data: Context data from the triggering event

        Returns:
            True if condition is met, False otherwise
        """
        try:
            evaluator = getattr(self, f'_eval_{condition.type}', None)
            if evaluator:
                return evaluator(condition, event_data)
            logger.warning(f"Unknown condition type: {condition.type}")
            return False
        except Exception as e:
            logger.error(f"Error evaluating condition '{condition.type}': {e}")
            return False

    def evaluate_all(self, conditions, event_data=None) -> bool:
        """Evaluate a list of conditions (implicit AND).

        Args:
            conditions: List of Condition objects
            event_data: Context data from the triggering event

        Returns:
            True if ALL conditions are met
        """
        return self.evaluate_root(conditions, 'and', event_data)

    def evaluate_root(self, conditions, mode: str = 'and', event_data=None) -> bool:
        """Evaluate a root-level condition list under a combine mode.

        Empty list always means "matches" (no gate) for and/or;
        empty NOT fails (nothing to invert).
        """
        mode = (mode or 'and').lower()
        if not conditions:
            return mode != 'not'
        if mode == 'not':
            if not conditions:
                return False
            return not self.evaluate(conditions[0], event_data)
        if mode == 'or':
            for cond in conditions:
                if self.evaluate(cond, event_data):
                    return True
            return False
        for cond in conditions:
            if not self.evaluate(cond, event_data):
                return False
        return True

    def _eval_light_is_on(self, condition: Condition, event_data=None) -> bool:
        target = self._resolve_target_id(condition, event_data)
        if not target:
            return False
        light_state = self._get_light_state(target)
        if not light_state:
            return False
        is_on = light_state.get('on', False)
        return is_on == True

    def _eval_light_is_off(self, condition: Condition, event_data=None) -> bool:
        target = self._resolve_target_id(condition, event_data)
        if not target:
            return False
        light_state = self._get_light_state(target)
        if not light_state:
            return True  # Unknown light is treated as off
        is_on = light_state.get('on', False)
        return is_on == False

    def _eval_room_is_on(self, condition: Condition, event_data=None) -> bool:
        target = self._resolve_target_id(condition, event_data)
        if not target:
            return False
        room_state = self._get_room_state(target)
        if not room_state:
            return False
        return room_state.get('is_on', False) == True

    def _eval_room_is_off(self, condition: Condition, event_data=None) -> bool:
        target = self._resolve_target_id(condition, event_data)
        if not target:
            return False
        room_state = self._get_room_state(target)
        if not room_state:
            return True
        return room_state.get('is_on', False) == False

    def _eval_brightness_above(self, condition: Condition, event_data=None) -> bool:
        target = self._resolve_target_id(condition, event_data)
        if not target:
            return False
        cat = getattr(condition, 'target_type', None) or 'light'
        if cat in ('room', 'zone'):
            state = self._get_room_state(target)
            if not state:
                return False
            brightness = state.get('avg_brightness', state.get('brightness', 0))
        else:
            light_state = self._get_light_state(target)
            if not light_state:
                return False
            brightness = light_state.get('brightness', 0)
        threshold = float(condition.value or 0)
        op = condition.operator or '>='
        if op == '>=':
            return brightness >= threshold
        elif op == '<=':
            return brightness <= threshold
        elif op == '<':
            return brightness < threshold
        elif op == '==':
            return abs(float(brightness) - threshold) < 0.5
        return brightness > threshold

    def _eval_brightness_below(self, condition: Condition, event_data=None) -> bool:
        target = self._resolve_target_id(condition, event_data)
        if not target:
            return False
        cat = getattr(condition, 'target_type', None) or 'light'
        if cat in ('room', 'zone'):
            state = self._get_room_state(target)
            if not state:
                return True
            brightness = state.get('avg_brightness', state.get('brightness', 0))
        else:
            light_state = self._get_light_state(target)
            if not light_state:
                return True
            brightness = light_state.get('brightness', 0)
        threshold = float(condition.value or 100)
        op = condition.operator or '<'
        if op == '<=':
            return brightness <= threshold
        elif op == '>=':
            return brightness >= threshold
        elif op == '>':
            return brightness > threshold
        elif op == '==':
            return abs(float(brightness) - threshold) < 0.5
        return brightness < threshold

    def _eval_door_is_open(self, condition: Condition, event_data=None) -> bool:
        target = self._resolve_target_id(condition, event_data)
        if not target:
            return False
        if self._device_manager:
            sensor = self._device_manager.get_door_sensor_by_mac(target)
            if sensor:
                return sensor.get('state') == 'open'
        return False

    def _eval_door_is_closed(self, condition: Condition, event_data=None) -> bool:
        target = self._resolve_target_id(condition, event_data)
        if not target:
            return False
        if self._device_manager:
            sensor = self._device_manager.get_door_sensor_by_mac(target)
            if sensor:
                return sensor.get('state') == 'closed'
        return True  # Unknown sensor treated as closed

    def _eval_time_range(self, condition: Condition, event_data=None) -> bool:
        now = datetime.now()
        current_time = now.strftime("%H:%M")
        start = condition.start or "00:00"
        end = condition.end or "23:59"
        if start <= end:
            return start <= current_time <= end
        else:
            # Wraps around midnight (e.g., 22:00 to 06:00)
            return current_time >= start or current_time <= end

    def _eval_day_of_week(self, condition: Condition, event_data=None) -> bool:
        days = condition.value
        if not days:
            return True
        if isinstance(days, str):
            days = [d.strip() for d in days.split(',')]
        day_names = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        today = day_names[datetime.now().weekday()]
        return today in [d.lower() for d in days]

    def _eval_scene_active(self, condition: Condition, event_data=None) -> bool:
        target = self._resolve_target_id(condition, event_data)
        if not target:
            return False
        scene_id = condition.scene_id
        if not scene_id:
            return False
        if self._hue_state_manager:
            state = self._get_room_state(target)
            if state:
                current_scene = state.get('current_scene_id')
                if current_scene == scene_id:
                    return True
        return False

    def _eval_and(self, condition: Condition, event_data=None) -> bool:
        for sub in condition.conditions:
            if not self.evaluate(sub, event_data):
                return False
        return True

    def _eval_or(self, condition: Condition, event_data=None) -> bool:
        for sub in condition.conditions:
            if self.evaluate(sub, event_data):
                return True
        return False

    def _eval_not(self, condition: Condition, event_data=None) -> bool:
        children = condition.conditions or []
        if not children:
            return False
        return not self.evaluate(children[0], event_data)

    def _resolve_target_id(self, condition: Condition, event_data=None) -> Optional[str]:
        if condition.target_id:
            return condition.target_id
        if event_data:
            return event_data.get('target_id') or event_data.get('light_id') or event_data.get('room_id')
        return None

    def _get_light_state(self, light_id: str) -> Optional[Dict]:
        if self._hue_state_manager:
            return self._hue_state_manager.get_light_state(light_id)
        return None

    def _get_room_state(self, room_id: str) -> Optional[Dict]:
        if self._hue_state_manager:
            state = self._hue_state_manager.get_room_state(room_id)
            if state:
                return state
            return self._hue_state_manager.get_zone_state(room_id)
        return None
