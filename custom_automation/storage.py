"""JSON persistence layer for automation rules."""
from __future__ import annotations

import logging
import shutil
import threading
from typing import Dict, List, Optional

from services.data_manager import data_manager

from .models import AutomationRule, is_legacy_rule_dict, normalize_rule_dict

logger = logging.getLogger(__name__)

FILE_AUTOMATIONS = 'custom_automations.json'


class AutomationStorage:
    """Read/write automation rules from JSON data file."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ensure_file()

    def _ensure_file(self) -> None:
        try:
            fp = data_manager._get_filepath(FILE_AUTOMATIONS)
            if not fp.exists():
                data_manager.write_json(FILE_AUTOMATIONS, {'rules': []})
                logger.info(f"Created missing data file: {fp}")
        except Exception as e:
            logger.error(f"Failed to ensure data file {FILE_AUTOMATIONS}: {e}")

    def _load(self) -> List[Dict]:
        data = data_manager.read_json(FILE_AUTOMATIONS, default={'rules': []})
        if isinstance(data, list):
            return data
        return data.get('rules', [])

    def _save(self, rules: List[Dict]) -> None:
        data_manager.write_json(FILE_AUTOMATIONS, {'rules': rules})

    def normalize_legacy_rules(self) -> int:
        """One-time rewrite of v1 rules to v2 on disk. Returns count migrated.

        Creates custom_automations.json.bak before the first rewrite.
        """
        with self._lock:
            raw_rules = self._load()
            legacy = [r for r in raw_rules if is_legacy_rule_dict(r)]
            if not legacy:
                return 0
            try:
                fp = data_manager._get_filepath(FILE_AUTOMATIONS)
                if fp.exists():
                    bak = fp.with_suffix('.json.bak')
                    shutil.copy2(fp, bak)
                    logger.info(f"Backed up legacy automations to {bak}")
            except Exception as e:
                logger.warning(f"Could not create automations backup: {e}")

            migrated = [normalize_rule_dict(r) for r in raw_rules]
            # Re-parse through the model to guarantee a clean v2 shape
            cleaned = [AutomationRule.from_dict(r).to_dict() for r in migrated]
            self._save(cleaned)
            logger.info(f"Normalized {len(legacy)} legacy rule(s) to schema v2")
            return len(legacy)

    def list_rules(self) -> List[AutomationRule]:
        with self._lock:
            return [AutomationRule.from_dict(r) for r in self._load()]

    def get_rule(self, rule_id: str) -> Optional[AutomationRule]:
        with self._lock:
            for r in self._load():
                if r.get('id') == rule_id:
                    return AutomationRule.from_dict(r)
            return None

    def save_rule(self, rule: AutomationRule) -> AutomationRule:
        with self._lock:
            rules = self._load()
            updated = False
            for i, r in enumerate(rules):
                if r.get('id') == rule.id:
                    rules[i] = rule.to_dict()
                    updated = True
                    break
            if not updated:
                rules.append(rule.to_dict())
            self._save(rules)
            return rule

    def delete_rule(self, rule_id: str) -> bool:
        with self._lock:
            rules = self._load()
            original_len = len(rules)
            rules = [r for r in rules if r.get('id') != rule_id]
            if len(rules) < original_len:
                self._save(rules)
                return True
            return False
