from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.ai.client import chat_full
from app.skills.manifest import SkillManifest

# tool 运行时：注册的 callable（skill_id -> 函数）
TOOLS: dict[str, Callable[[dict[str, Any], dict[str, Any]], Awaitable[str]]] = {}


def register_tool(skill_id: str, fn: Callable[[dict[str, Any], dict[str, Any]], Awaitable[str]]) -> None:
    TOOLS[skill_id] = fn


@dataclass
class SkillResult:
    ok: bool
    result: str | None = None
    error: str | None = None


class SkillRuntime:
    """平台级 Skill 运行器（spec #9 / #12）。不绑定单个 Agent。"""

    async def execute_prompt(self, manifest: SkillManifest, content: str, args: dict[str, Any]) -> SkillResult:
        user = "请基于以下参数完成任务：\n" + json.dumps(args, ensure_ascii=False, indent=2)
        res = await chat_full(
            content, user, scenario="skill",
            temperature=0.6, max_tokens=2048,
        )
        if not res.ok:
            return SkillResult(False, None, res.usage and "skill 生成失败" or "skill 生成失败")
        return SkillResult(True, res.content)

    async def execute(self, manifest: SkillManifest, content: str, args: dict[str, Any], context: dict[str, Any]) -> SkillResult:
        rt = manifest.runtime
        if rt == "prompt":
            return await self.execute_prompt(manifest, content, args)
        if rt == "tool":
            tool = TOOLS.get(manifest.id)
            if not tool:
                return SkillResult(False, None, f"未注册 tool: {manifest.id}")
            try:
                out = await tool(args, context)
                return SkillResult(True, str(out))
            except Exception as exc:
                return SkillResult(False, None, f"tool 执行异常: {exc}")
        if rt == "workflow":
            # 首版 workflow 复用 prompt 编排（step 列表由 SKILL 指引描述）
            return await self.execute_prompt(manifest, content, args)
        return SkillResult(False, None, f"未知 runtime: {rt}")


SKILL_RUNTIME = SkillRuntime()
