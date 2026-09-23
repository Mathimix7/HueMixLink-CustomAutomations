"""Data models for custom automation rules (schema v2)."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class Trigger:
    """Defines when an automation rule should be evaluated."""
    type: str  # light_state_change, room_state_change, motion_detected, door_event, time_of_day, startup
    target_id: Optional[str] = None  # light_id, room_id, sensor_mac
    target_type: Optional[str] = None  # light, room, zone, motion, door
    attributes: List[str] = field(default_factory=list)  # on, brightness, scene, color
    config: Dict[str, Any] = field(default_factory=dict)
    # trigger-specific config keys:
    #   wanted_state: 'on'/'off' for light/room state change
    #   door_action: 'opened'/'closed' for door_event
    #   trigger_time: 'HH:MM' for time_of_day
    #   trigger_days: 'monday,tuesday,...' for time_of_day

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            'type': self.type,
            'attributes': list(self.attributes),
        }
        if self.target_id is not None:
            d['target_id'] = self.target_id
        if self.target_type is not None:
            d['target_type'] = self.target_type
        if self.config:
            d.update(self.config)
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Trigger:
        known_keys = {'type', 'target_id', 'target_type', 'attributes'}
        raw = {k: v for k, v in data.items() if k not in known_keys}
        config = {}
        for k, v in raw.items():
            if k == 'config' and isinstance(v, dict):
                config.update(v)
            elif k != 'triggerProperties':
                config[k] = v
        return cls(
            type=str(data.get('type', '')),
            target_id=data.get('target_id'),
            target_type=data.get('target_type'),
            attributes=list(data.get('attributes') or []),
            config=config,
        )


@dataclass
class Condition:
    """A condition node: leaf, or group (and/or/not) with nested conditions."""
    type: str  # light_is_on, ..., scene_active, and, or, not
    target_id: Optional[str] = None
    target_type: Optional[str] = None  # light, room, zone
    value: Any = None
    operator: Optional[str] = None  # >=, <=, >, <, ==
    start: Optional[str] = None  # for time_range: "HH:MM"
    end: Optional[str] = None  # for time_range: "HH:MM"
    scene_id: Optional[str] = None  # for scene_active
    conditions: List['Condition'] = field(default_factory=list)  # for and/or/not groups

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {'type': self.type}
        if self.target_id is not None:
            d['target_id'] = self.target_id
        if self.target_type is not None:
            d['target_type'] = self.target_type
        if self.value is not None:
            d['value'] = self.value
        if self.operator is not None:
            d['operator'] = self.operator
        if self.start is not None:
            d['start'] = self.start
        if self.end is not None:
            d['end'] = self.end
        if self.scene_id is not None:
            d['scene_id'] = self.scene_id
        if self.conditions:
            d['conditions'] = [c.to_dict() for c in self.conditions]
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Condition:
        sub = [Condition.from_dict(c) for c in (data.get('conditions') or [])]
        return cls(
            type=str(data.get('type', '')),
            target_id=data.get('target_id'),
            target_type=data.get('target_type'),
            value=data.get('value'),
            operator=data.get('operator'),
            start=data.get('start'),
            end=data.get('end'),
            scene_id=data.get('scene_id'),
            conditions=sub,
        )


@dataclass
class Action:
    """An action to execute when a branch fires."""
    type: str  # set_light_brightness, set_light_on, set_light_off, set_light_color, call_scene, turn_off_room, turn_on_room, delay, log_message
    target_id: Optional[str] = None
    target_type: Optional[str] = None  # light, room, zone
    brightness: Optional[float] = None
    force: bool = False  # Force-write even if value looks same (for IKEA fix)
    scene_id: Optional[str] = None
    group_id: Optional[str] = None
    group_type: Optional[str] = None  # room, zone
    seconds: Optional[float] = None  # for delay
    message: Optional[str] = None  # for log_message
    xy: Optional[Dict[str, float]] = None  # {x, y}
    ct: Optional[int] = None  # color temperature in mired
    on: Optional[bool] = None  # for set_light_on/off

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {'type': self.type}
        for k in ('target_id', 'target_type', 'brightness', 'force', 'scene_id',
                   'group_id', 'group_type', 'seconds', 'message', 'on'):
            v = getattr(self, k)
            if v is not None:
                d[k] = v
        if self.xy is not None:
            d['xy'] = dict(self.xy)
        if self.ct is not None:
            d['ct'] = self.ct
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Action:
        return cls(
            type=str(data.get('type', '')),
            target_id=data.get('target_id'),
            target_type=data.get('target_type'),
            brightness=data.get('brightness'),
            force=bool(data.get('force', False)),
            scene_id=data.get('scene_id'),
            group_id=data.get('group_id'),
            group_type=data.get('group_type'),
            seconds=data.get('seconds'),
            message=data.get('message'),
            xy=data.get('xy'),
            ct=data.get('ct'),
            on=data.get('on'),
        )


BRANCH_KINDS = ('if', 'else_if', 'else')


@dataclass
class Branch:
    """One path of a rule: conditions gate a list of actions."""
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    kind: str = 'if'  # if | else_if | else
    condition_mode: str = 'and'  # and | or | not — how root conditions combine
    conditions: List[Condition] = field(default_factory=list)
    actions: List[Action] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'kind': self.kind,
            'condition_mode': self.condition_mode,
            'conditions': [c.to_dict() for c in self.conditions],
            'actions': [a.to_dict() for a in self.actions],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Branch:
        kind = str(data.get('kind', 'if') or 'if')
        if kind not in BRANCH_KINDS:
            kind = 'if'
        mode = str(data.get('condition_mode', 'and') or 'and')
        if mode not in ('and', 'or', 'not'):
            mode = 'and'
        return cls(
            id=str(data.get('id') or uuid.uuid4().hex),
            kind=kind,
            condition_mode=mode,
            conditions=[Condition.from_dict(c) for c in (data.get('conditions') or [])],
            actions=[Action.from_dict(a) for a in (data.get('actions') or [])],
        )


def is_legacy_rule_dict(data: Dict[str, Any]) -> bool:
    """True if payload uses v1 shape (singular trigger, no branches)."""
    if not isinstance(data, dict):
        return False
    if data.get('schema_version') == 2:
        return False
    if data.get('triggers') is not None or data.get('branches') is not None:
        return False
    return True


def migrate_v1_to_v2(data: Dict[str, Any]) -> Dict[str, Any]:
    """Rewrite a v1 rule dict to v2. Pure; does not mutate input.

    v1: trigger + flat conditions (AND) + actions
    v2: triggers[] + branches[if]
    """
    if not isinstance(data, dict):
        data = {}
    trigger = data.get('trigger') or {}
    conditions = data.get('conditions') or []
    actions = data.get('actions') or []
    return {
        'id': data.get('id') or uuid.uuid4().hex,
        'name': str(data.get('name', '')),
        'enabled': bool(data.get('enabled', True)),
        'schema_version': 2,
        'triggers': [trigger] if trigger.get('type') else [],
        'branches': [{
            'id': uuid.uuid4().hex,
            'kind': 'if',
            'condition_mode': 'and',
            'conditions': conditions,
            'actions': actions,
        }],
        'cooldown_seconds': float(data.get('cooldown_seconds', 0) or 0),
        'last_fired': data.get('last_fired'),
    }


def normalize_rule_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    """Return a v2 rule dict (migrating v1 if needed)."""
    if is_legacy_rule_dict(data):
        return migrate_v1_to_v2(data)
    return data


@dataclass
class AutomationRule:
    """A complete automation rule: triggers (OR) -> branches (if/else-if/else)."""
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    name: str = ""
    enabled: bool = True
    schema_version: int = 2
    triggers: List[Trigger] = field(default_factory=list)
    branches: List[Branch] = field(default_factory=list)
    cooldown_seconds: float = 0.0  # debounce: ignore triggers for N seconds after fire
    last_fired: Optional[str] = None

    @property
    def if_branch(self) -> Optional[Branch]:
        for b in self.branches:
            if b.kind == 'if':
                return b
        return self.branches[0] if self.branches else None

    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'name': self.name,
            'enabled': self.enabled,
            'schema_version': 2,
            'triggers': [t.to_dict() for t in self.triggers],
            'branches': [b.to_dict() for b in self.branches],
            'cooldown_seconds': float(self.cooldown_seconds or 0),
            'last_fired': self.last_fired,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> AutomationRule:
        data = normalize_rule_dict(data or {})
        triggers_raw = data.get('triggers')
        if triggers_raw is None:
            # Partial/malformed v2: fall back if a singular trigger is present
            singular = data.get('trigger')
            triggers_raw = [singular] if singular else []
        branches_raw = data.get('branches')
        if branches_raw is None:
            branches_raw = [{
                'id': uuid.uuid4().hex,
                'kind': 'if',
                'condition_mode': 'and',
                'conditions': data.get('conditions') or [],
                'actions': data.get('actions') or [],
            }]
        # Ensure at least one if-branch exists
        branches = [Branch.from_dict(b) for b in branches_raw]
        if branches and branches[0].kind != 'if':
            # Force first branch to if so evaluation is well-defined
            branches[0].kind = 'if'
        if not branches:
            branches = [Branch(kind='if')]
        return cls(
            id=str(data.get('id') or uuid.uuid4().hex),
            name=str(data.get('name', '')),
            enabled=bool(data.get('enabled', True)),
            schema_version=2,
            triggers=[Trigger.from_dict(t) for t in triggers_raw],
            branches=branches,
            cooldown_seconds=float(data.get('cooldown_seconds', 0) or 0),
            last_fired=data.get('last_fired'),
        )
