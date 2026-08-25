from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SkillManifest:
    """统一 Skill 清单（spec #12）。所有 Skill 必须实现统一 Manifest。"""

    id: str
    name: str
    version: str = "1.0.0"
    description: str = ""
    runtime: str = "prompt"  # prompt | tool | workflow
    entry: str = "SKILL.md"
    permissions: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    source: str = "builtin"
    params: list[dict] = field(default_factory=list)  # 参数 schema：[{name,type,label,default,required}]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "version": self.version,
            "description": self.description, "runtime": self.runtime,
            "entry": self.entry, "permissions": self.permissions,
            "tags": self.tags, "source": self.source, "params": self.params,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "SkillManifest":
        return cls(
            id=d.get("id", ""), name=d.get("name", ""),
            version=d.get("version", "1.0.0"), description=d.get("description", ""),
            runtime=d.get("runtime", "prompt"), entry=d.get("entry", "SKILL.md"),
            permissions=list(d.get("permissions", []) or []),
            tags=list(d.get("tags", []) or []), source=d.get("source", "builtin"),
            params=list(d.get("params", []) or []),
        )
