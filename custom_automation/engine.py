"""Automation rule engine - matches events to rules and executes them."""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from .models import AutomationRule, Branch, Trigger
from .conditions import ConditionEvaluator
from .actions import ActionExecutor
from .storage import AutomationStorage

logger = logging.getLogger(__name__)


class AutomationEngine:
    """Evaluates and executes automation rules based on incoming events."""

    def __init__(self, storage: AutomationStorage, evaluator: ConditionEvaluator,
                 executor: ActionExecutor):
        self._storage = storage
        self._evaluator = evaluator
        self._executor = executor
        self._lock = threading.RLock()
        self._processing_event = False  # Prevent re-entrant processing
        self._cooldown_until: Dict[str, float] = {}  # rule_id -> monotonic deadline

    def handle_event(self, trigger_type: str, event_data: Optional[Dict] = None,
                     target_id: Optional[str] = None) -> None:
        """Process an incoming event and fire matching rules.

        Args:
            trigger_type: The type of trigger (e.g. 'light_state_change', 'motion_detected')
            event_data: Arbitrary data from the event
            target_id: Optional specific target this event is about
        """
        with self._lock:
            if self._processing_event:
                logger.debug(f"Skipping nested event processing for {trigger_type}")
                return
            self._processing_event = True

        try:
            rules = self._storage.list_rules()
            for rule in rules:
                if not rule.enabled:
                    continue

                # Triggers: OR — any matching trigger starts evaluation
                trigger_matched = False
                for trig in rule.triggers:
                    if self._matches_trigger(trig, trigger_type, target_id, event_data):
                        trigger_matched = True
                        break
                if not trigger_matched:
                    continue

                # Debounce: skip if still within cooldown after last fire
                cooldown = float(getattr(rule, 'cooldown_seconds', 0) or 0)
                if cooldown > 0:
                    deadline = self._cooldown_until.get(rule.id, 0.0)
                    if time.monotonic() < deadline:
                        logger.debug(
                            f"Rule '{rule.name}' in cooldown "
                            f"({deadline - time.monotonic():.1f}s left)"
                        )
                        continue

                # Branches: first match wins (else is always true if reached)
                chosen = self._select_branch(rule, event_data)
                if chosen is None:
                    logger.debug(f"Rule '{rule.name}' ({rule.id}) no branch matched")
                    continue

                # Check if this was originated by automation (loop prevention)
                if self._is_self_triggered(rule, event_data):
                    logger.debug(f"Skipping rule '{rule.name}' - self-triggered")
                    continue

                # Stamp cooldown before actions so overlapping events are blocked
                if cooldown > 0:
                    self._cooldown_until[rule.id] = time.monotonic() + cooldown

                # Execute only the chosen branch's actions
                logger.info(
                    f"Firing rule '{rule.name}' ({rule.id}) branch={chosen.kind} ({chosen.id})"
                )
                has_delay = any(getattr(a, 'type', '') == 'delay' for a in chosen.actions)
                if has_delay:
                    t = threading.Thread(
                        target=self._exec_actions_background,
                        args=(rule, chosen, event_data),
                        daemon=True,
                    )
                    t.start()
                else:
                    success = self._executor.execute_all(chosen.actions, event_data)
                    if success:
                        logger.info(f"Rule '{rule.name}' executed successfully")
                    else:
                        logger.warning(f"Rule '{rule.name}' had action failures")

                # Update rule stats
                rule.last_fired = datetime.now().isoformat()
                self._storage.save_rule(rule)
        finally:
            with self._lock:
                self._processing_event = False

    def _select_branch(self, rule: AutomationRule, event_data: Optional[Dict]) -> Optional[Branch]:
        """Return the first matching branch, or None if nothing matched."""
        for branch in rule.branches:
            if branch.kind == 'else':
                return branch
            if self._evaluator.evaluate_root(
                branch.conditions, getattr(branch, 'condition_mode', 'and'), event_data
            ):
                return branch
        return None

    def _matches_trigger(self, trigger: Trigger, event_type: str,
                         target_id: Optional[str], event_data: Optional[Dict]) -> bool:
        """Check if an event matches a rule's trigger definition."""
        # door_event trigger matches both door_opened and door_closed
        type_match = (trigger.type == event_type)
        if not type_match:
            if trigger.type == 'door_event' and event_type in ('door_opened', 'door_closed'):
                type_match = True
        if not type_match:
            return False

        # If trigger specifies a target, check it matches
        if trigger.target_id:
            event_target = target_id or (event_data or {}).get('target_id') or \
                           (event_data or {}).get('light_id') or \
                           (event_data or {}).get('room_id') or \
                           (event_data or {}).get('sensor_mac')
            if event_target and event_target != trigger.target_id:
                return False

        # If trigger specifies attributes, check at least one changed
        if trigger.attributes and event_data:
            changed_attrs = event_data.get('changed_attributes', [])
            if changed_attrs:
                matched = False
                for a in trigger.attributes:
                    if a in changed_attrs:
                        matched = True
                        break
                    # 'on' in changed_attributes covers both 'on' and 'off' triggers
                    if a in ('on', 'off') and 'on' in changed_attrs:
                        matched = True
                        break
                if not matched:
                    return False

        cfg = trigger.config
        if not cfg:
            return True

        ed = event_data or {}

        # wanted_state: for light/room state changes, check the new state matches
        wanted_state = cfg.get('wanted_state')
        if wanted_state and event_type in ('light_state_change', 'room_state_change'):
            new_state = ed.get('new_state') or ed.get('room_state') or ed.get('zone_state') or {}
            actual_on = new_state.get('on')
            if actual_on is None:
                actual_on = new_state.get('is_on')
            if wanted_state == 'on' and actual_on is not True:
                return False
            if wanted_state == 'off' and actual_on is not False:
                return False

        # wanted_scene: for scene changes, check the scene matches
        wanted_scene = cfg.get('wanted_scene')
        if wanted_scene and event_type in ('light_state_change', 'room_state_change'):
            actual_scene = ed.get('scene_id')
            if actual_scene and actual_scene != wanted_scene:
                return False

        # door_action: for door_event triggers, check opened/closed matches
        door_action = cfg.get('door_action')
        if door_action and trigger.type == 'door_event':
            actual_door_action = ed.get('action')
            if actual_door_action and actual_door_action != door_action:
                return False

        # trigger_time: for time_of_day events, check the time
        trigger_time = cfg.get('trigger_time')
        if trigger_time and event_type == 'time_of_day':
            from datetime import datetime as _dt
            now = _dt.now()
            trigger_parts = trigger_time.split(':')
            if len(trigger_parts) == 2:
                th, tm = int(trigger_parts[0]), int(trigger_parts[1])
                if not (now.hour == th and now.minute == tm):
                    return False

        # trigger_days: for time_of_day events, check the day
        trigger_days = cfg.get('trigger_days')
        if trigger_days and event_type == 'time_of_day':
            from datetime import datetime as _dt
            day_names = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
            today = day_names[_dt.now().weekday()]
            requested = [d.strip().lower() for d in trigger_days.split(',') if d.strip()]
            if requested and today not in requested:
                return False

        return True

    def _is_self_triggered(self, rule: AutomationRule, event_data: Optional[Dict]) -> bool:
        """Check if the event was caused by this automation system."""
        if not event_data:
            return False
        origin_key = event_data.get('automation_origin')
        if origin_key:
            return self._executor.consume_origin(origin_key)
        return False

    def _exec_actions_background(self, rule: AutomationRule, branch: Branch,
                                 event_data: Optional[Dict]) -> None:
        """Run a branch's actions in a background thread (for delays)."""
        try:
            success = self._executor.execute_all(branch.actions, event_data)
            if success:
                logger.info(f"Rule '{rule.name}' background actions completed")
            else:
                logger.warning(f"Rule '{rule.name}' had background action failures")
        except Exception as e:
            logger.error(f"Error in background execution for '{rule.name}': {e}")
