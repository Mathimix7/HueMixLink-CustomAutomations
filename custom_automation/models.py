"""Data models for custom automation rules."""
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
    """A single condition that must be true for the rule to fire."""
    type: str  # light_is_on, light_is_off, room_is_on, room_is_off, brightness_above, brightness_below, door_is_open, door_is_closed, time_range, day_of_week, scene_active, and, or
    target_id: Optional[str] = None
    target_type: Optional[str] = None  # light, room, zone
    value: Any = None
    operator: Optional[str] = None  # >=, <=, >, <, ==
    start: Optional[str] = None  # for time_range: "HH:MM"
    end: Optional[str] = None  # for time_range: "HH:MM"
    scene_id: Optional[str] = None  # for scene_active
    conditions: List['Condition'] = field(default_factory=list)  # for and/or combinators

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
    """An action to execute when the rule fires."""
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


@dataclass
class AutomationRule:
    """A complete automation rule: trigger -> conditions -> actions."""
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    name: str = ""
    enabled: bool = True
    trigger: Trigger = field(default_factory=lambda: Trigger(type=""))
    conditions: List[Condition] = field(default_factory=list)
    actions: List[Action] = field(default_factory=list)
    last_fired: Optional[str] = None
    fire_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'name': self.name,
            'enabled': self.enabled,
            'trigger': self.trigger.to_dict(),
            'conditions': [c.to_dict() for c in self.conditions],
            'actions': [a.to_dict() for a in self.actions],
            'last_fired': self.last_fired,
            'fire_count': self.fire_count,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> AutomationRule:
        return cls(
            id=str(data.get('id', uuid.uuid4().hex)),
            name=str(data.get('name', '')),
            enabled=bool(data.get('enabled', True)),
            trigger=Trigger.from_dict(data.get('trigger') or {}),
            conditions=[Condition.from_dict(c) for c in (data.get('conditions') or [])],
            actions=[Action.from_dict(a) for a in (data.get('actions') or [])],
            last_fired=data.get('last_fired'),
            fire_count=int(data.get('fire_count', 0)),
        )
