from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from app.skills.manifest import SkillManifest
from app.skills.permissions import check_permissions
from app.skills.runtime import SKILL_RUNTIME, SkillResult


@dataclass
class SkillEntry:
    manifest: SkillManifest
    content: str


class SkillManager:
    """平台级 Skill 管理器（spec #13）。所有 Agent 共享，不绑定单个 Agent。"""

    def __init__(self) -> None:
        self._skills: dict[str, SkillEntry] = {}

    def register(self, entry: SkillEntry) -> None:
        self._skills[entry.manifest.id] = entry

    def get(self, skill_id: str) -> Optional[SkillEntry]:
        return self._skills.get(skill_id)

    def list(self) -> list[dict[str, Any]]:
        return [e.manifest.to_dict() for e in self._skills.values()]

    async def execute(self, skill_id: str, args: dict[str, Any], context: dict[str, Any]) -> SkillResult:
        entry = self._skills.get(skill_id)
        if not entry:
            return SkillResult(False, None, f"skill not found: {skill_id}")
        ok, denied = check_permissions(entry.manifest.permissions)
        if not ok:
            return SkillResult(False, None, f"权限不足，被拒绝: {denied}")
        return await SKILL_RUNTIME.execute(entry.manifest, entry.content, args or {}, context or {})
