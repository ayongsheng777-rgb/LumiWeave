"""MCP 工具注册表（ToolRegistry）。

统一登记所有 MCP 工具的元信息（名称/描述/所需权限/分类），
供权限校验、文档生成与 MCP 客户端发现使用。
实际执行仍由 MCPServer 的 @tool 装饰器接管。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.mcp.auth.permission import required_permission


@dataclass
class ToolDefinition:
    name: str
    description: str
    category: str  # canvas | workflow | asset | provider | project
    required: str | None = None  # read | write | execute

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "required_permission": self.required or required_permission(self.name),
        }


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}

    def register(self, name: str, description: str, category: str) -> None:
        self._tools[name] = ToolDefinition(
            name=name, description=description, category=category,
            required=required_permission(name),
        )

    def get(self, name: str) -> ToolDefinition | None:
        return self._tools.get(name)

    def list(self) -> list[dict[str, Any]]:
        return [d.to_dict() for d in self._tools.values()]


tool_registry = ToolRegistry()
