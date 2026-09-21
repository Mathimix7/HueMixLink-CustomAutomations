"""Custom Automations plugin for HueMix-Link.

Provides user-defined event-driven automations with trigger -> condition -> action rules.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, render_template, request

from .models import Action, AutomationRule, Condition, Trigger
from .storage import AutomationStorage
from .conditions import ConditionEvaluator
from .actions import ActionExecutor
from .engine import AutomationEngine
from .triggers import EventTriggerManager

logger = logging.getLogger(__name__)


@dataclass
class CustomAutomationPlugin:
    """Custom automations plugin."""

    options: dict[str, Any] = field(default_factory=dict)
    context: Any = None
    manifest: Any = None

    def __post_init__(self) -> None:
        self.blueprint = Blueprint(
            'custom_automation',
            __name__,
            url_prefix='/plugins/automations',
            template_folder='templates',
            static_folder='static',
        )
        # Pages
        self.blueprint.add_url_rule('/', 'index', self.index)
        # API
        self.blueprint.add_url_rule('/api/rules', 'api_list_rules', self.api_list_rules)
        self.blueprint.add_url_rule('/api/rules/<rule_id>', 'api_get_rule', self.api_get_rule)
        self.blueprint.add_url_rule('/api/rules', 'api_create_rule', self.api_create_rule, methods=['POST'])
        self.blueprint.add_url_rule('/api/rules/<rule_id>', 'api_update_rule', self.api_update_rule, methods=['PUT'])
        self.blueprint.add_url_rule('/api/rules/<rule_id>', 'api_delete_rule', self.api_delete_rule, methods=['DELETE'])
        self.blueprint.add_url_rule('/api/rules/<rule_id>/toggle', 'api_toggle_rule', self.api_toggle_rule, methods=['POST'])
        self.blueprint.add_url_rule('/api/rules/<rule_id>/test', 'api_test_rule', self.api_test_rule, methods=['POST'])
        self.blueprint.add_url_rule('/api/available_targets', 'api_available_targets', self.api_available_targets)

        # Core components (initialized in register/start)
        self._storage: Optional[AutomationStorage] = None
        self._evaluator: Optional[ConditionEvaluator] = None
        self._executor: Optional[ActionExecutor] = None
        self._engine: Optional[AutomationEngine] = None
        self._triggers: Optional[EventTriggerManager] = None

    def register(self, app, context=None):
        self.context = context or self.context
        app.register_blueprint(self.blueprint)

    def start(self, context=None):
        self.context = context or self.context
        self._init_components()
        self._intercept_automation_events()
        if self._triggers:
            self._triggers.start()
        self._log('Custom automations plugin started.')

    def stop(self, context=None):
        if self._triggers:
            self._triggers.stop()
        self._log('Custom automations plugin stopped.')

    def _init_components(self) -> None:
        """Initialize storage, evaluator, executor, engine, triggers."""
        self._storage = AutomationStorage()

        hue_state_manager = None
        hue_controller = None
        network_server = None
        device_manager = None

        try:
            from services.hue_state_manager import hue_state_manager as hsm
            hue_state_manager = hsm
        except Exception:
            pass

        try:
            from network.device_manager import device_manager as dm
            device_manager = dm
        except Exception:
            pass

        if self.context:
            try:
                network_server = self.context.require('network_server')
            except Exception:
                pass

        try:
            from services.hue_service import hue_service
            hue_controller = hue_service.get_controller()
        except Exception:
            pass

        self._evaluator = ConditionEvaluator(
            hue_state_manager=hue_state_manager,
            device_manager=device_manager,
        )
        self._executor = ActionExecutor(
            hue_controller=hue_controller,
            hue_state_manager=hue_state_manager,
            network_server=network_server,
        )
        self._engine = AutomationEngine(
            storage=self._storage,
            evaluator=self._evaluator,
            executor=self._executor,
        )
        self._triggers = EventTriggerManager(
            engine=self._engine,
            hue_state_manager=hue_state_manager,
            network_server=network_server,
        )

    def _intercept_automation_events(self) -> None:
        """Hook into the existing automation engine for motion/door events."""
        if not self.context:
            return

        try:
            automation_service = self.context.require('automation_service')
            engine = automation_service.get_engine()
            if engine:
                # Wrap the existing handlers to also feed our triggers
                orig_motion = engine.handle_motion_event
                orig_door = engine.handle_door_event

                def wrapped_motion(mac, action, light_level=None, battery_mv=None):
                    orig_motion(mac, action, light_level, battery_mv)
                    if self._triggers:
                        self._triggers.feed_motion_event(mac, action, light_level, battery_mv)

                def wrapped_door(mac, action, light_level=None, battery_mv=None):
                    orig_door(mac, action, light_level, battery_mv)
                    if self._triggers:
                        self._triggers.feed_door_event(mac, action, light_level, battery_mv)

                engine.handle_motion_event = wrapped_motion
                engine.handle_door_event = wrapped_door
                self._log('Intercepted automation engine event handlers')
        except Exception as e:
            self._log(f'Could not intercept automation engine: {e}')

        # Also subscribe to plugin events
        try:
            self.context.subscribe('motion_event', self._on_plugin_motion_event)
            self.context.subscribe('door_event', self._on_plugin_door_event)
        except Exception:
            pass

    def _on_plugin_motion_event(self, event_name, payload, host=None):
        if self._triggers and payload:
            self._triggers.feed_motion_event(
                payload.get('sensor_mac', ''),
                payload.get('action', 0),
                payload.get('light_level'),
                payload.get('battery_mv'),
            )

    def _on_plugin_door_event(self, event_name, payload, host=None):
        if self._triggers and payload:
            self._triggers.feed_door_event(
                payload.get('sensor_mac', ''),
                payload.get('action', 0),
                payload.get('light_level'),
                payload.get('battery_mv'),
            )

    # ===== Web UI =====

    def index(self):
        return render_template('automations.html')

    # ===== REST API =====

    def api_list_rules(self):
        rules = self._storage.list_rules()
        return jsonify({'rules': [r.to_dict() for r in rules]})

    def api_get_rule(self, rule_id):
        rule = self._storage.get_rule(rule_id)
        if not rule:
            return jsonify({'error': 'Rule not found'}), 404
        return jsonify(rule.to_dict())

    def api_create_rule(self):
        data = request.get_json(silent=True) or {}
        if not data.get('name'):
            return jsonify({'error': 'Name is required'}), 400

        rule = AutomationRule(
            id=uuid.uuid4().hex,
            name=data['name'],
            enabled=data.get('enabled', True),
            trigger=Trigger.from_dict(data.get('trigger') or {}),
            conditions=[Condition.from_dict(c) for c in (data.get('conditions') or [])],
            actions=[Action.from_dict(a) for a in (data.get('actions') or [])],
        )
        self._storage.save_rule(rule)
        self._log(f"Created rule: {rule.name} ({rule.id})")
        return jsonify(rule.to_dict()), 201

    def api_update_rule(self, rule_id):
        existing = self._storage.get_rule(rule_id)
        if not existing:
            return jsonify({'error': 'Rule not found'}), 404

        data = request.get_json(silent=True) or {}
        if 'name' in data:
            existing.name = data['name']
        if 'enabled' in data:
            existing.enabled = data['enabled']
        if 'trigger' in data:
            existing.trigger = Trigger.from_dict(data['trigger'])
        if 'conditions' in data:
            existing.conditions = [Condition.from_dict(c) for c in data['conditions']]
        if 'actions' in data:
            existing.actions = [Action.from_dict(a) for a in data['actions']]

        self._storage.save_rule(existing)
        self._log(f"Updated rule: {existing.name} ({existing.id})")
        return jsonify(existing.to_dict())

    def api_delete_rule(self, rule_id):
        if self._storage.delete_rule(rule_id):
            self._log(f"Deleted rule: {rule_id}")
            return jsonify({'success': True})
        return jsonify({'error': 'Rule not found'}), 404

    def api_toggle_rule(self, rule_id):
        rule = self._storage.get_rule(rule_id)
        if not rule:
            return jsonify({'error': 'Rule not found'}), 404
        rule.enabled = not rule.enabled
        self._storage.save_rule(rule)
        self._log(f"Rule '{rule.name}' {'enabled' if rule.enabled else 'disabled'}")
        return jsonify(rule.to_dict())

    def api_test_rule(self, rule_id):
        rule = self._storage.get_rule(rule_id)
        if not rule:
            return jsonify({'error': 'Rule not found'}), 404

        # Test by executing actions directly (skip conditions)
        success = self._executor.execute_all(rule.actions, {})
        return jsonify({'success': success, 'rule': rule.to_dict()})

    def api_available_targets(self):
        """Return available lights, rooms, zones, motion sensors, door sensors."""
        targets = {
            'lights': [],
            'rooms': [],
            'zones': [],
            'motion_sensors': [],
            'door_sensors': [],
            'scenes': [],
        }

        try:
            from services.hue_state_manager import hue_state_manager as hsm
            light_to_room = {}
            for rid, state in hsm.get_all_rooms().items():
                targets['rooms'].append({
                    'id': rid,
                    'name': state.get('name', rid[:8]),
                })
                for lid in state.get('lights', []):
                    light_to_room[lid] = rid
            light_to_zone = {}
            for zid, state in hsm.get_all_zones().items():
                targets['zones'].append({
                    'id': zid,
                    'name': state.get('name', zid[:8]),
                })
                for lid in state.get('lights', []):
                    light_to_zone[lid] = zid
            for lid, state in hsm.get_all_lights().items():
                targets['lights'].append({
                    'id': lid,
                    'name': state.get('name', lid[:8]),
                    'room_id': light_to_room.get(lid) or light_to_zone.get(lid) or '',
                })
            for sid, state in hsm.get_all_scenes().items():
                targets['scenes'].append({
                    'id': sid,
                    'name': state.get('name', sid[:8]),
                    'room_id': state.get('room_id'),
                })
        except Exception:
            pass

        try:
            from network.device_manager import device_manager as dm
            for sensor in dm.get_all_motion_sensors():
                targets['motion_sensors'].append({
                    'mac': sensor.get('mac_address'),
                    'name': sensor.get('name', sensor.get('mac_address', '')[-8:]),
                })
            for sensor in dm.get_all_door_sensors():
                targets['door_sensors'].append({
                    'mac': sensor.get('mac_address'),
                    'name': sensor.get('name', sensor.get('mac_address', '')[-8:]),
                    'state': sensor.get('state', 'unknown'),
                })
        except Exception:
            pass

        return jsonify(targets)

    def _log(self, message: str) -> None:
        log = getattr(self.context, 'logger', None) if self.context is not None else None
        if log is None:
            log = logging.getLogger('plugins.custom_automation')
        try:
            log.info(message)
        except Exception:
            pass


def create_plugin(options=None, context=None, manifest=None, host=None, **_kwargs):
    return CustomAutomationPlugin(options=options or {}, context=context or host, manifest=manifest)
