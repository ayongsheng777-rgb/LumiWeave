"""MCP 权限模型（Client → Permission → Tool → Resource）。

权限分三类：READ（读）、WRITE（写）、EXECUTE（执行）。
每个 MCP 客户端（mcp_clients 表）持有 permissions 列表，
调用工具时按工具声明的 required_permission 校验。
"""
from __future__ import annotations

from typing import Any

PERMISSION_READ = "read"
PERMISSION_WRITE = "write"
PERMISSION_EXECUTE = "execute"

# 工具所需权限映射（tool 命名空间 -> 所需权限）
_TOOL_PERMISSIONS: dict[str, str] = {
    # 读类
    "canvas.list": PERMISSION_READ,
    "canvas.get": PERMISSION_READ,
    "canvas.export": PERMISSION_READ,
    "workflow.list": PERMISSION_READ,
    "workflow.get": PERMISSION_READ,
    "workflow.inspect": PERMISSION_READ,
    "asset.list": PERMISSION_READ,
    "provider.list": PERMISSION_READ,
    "provider.health": PERMISSION_READ,
    "provider.route": PERMISSION_READ,
    "project.status": PERMISSION_READ,
    # 写类
    "canvas.create": PERMISSION_WRITE,
    "canvas.update": PERMISSION_WRITE,
    "canvas.delete": PERMISSION_WRITE,
    "canvas.move": PERMISSION_WRITE,
    "workflow.create": PERMISSION_WRITE,
    "workflow.delete": PERMISSION_WRITE,
    "asset.attach": PERMISSION_WRITE,
    "asset.delete": PERMISSION_WRITE,
    "asset.rename": PERMISSION_WRITE,
    # 执行类
    "canvas.generate": PERMISSION_EXECUTE,
    "workflow.execute": PERMISSION_EXECUTE,
}


def required_permission(tool_name: str) -> str | None:
    """返回某工具所需的权限类别，未登记返回 None（默认放行）。"""
    return _TOOL_PERMISSIONS.get(tool_name)


def has_permission(client_permissions: list[str] | Any, tool_name: str) -> bool:
    """校验客户端是否具备调用某工具的权限。"""
    req = required_permission(tool_name)
    if req is None:
        return True
    if isinstance(client_permissions, str):
        return True  # 字符串视为通配/旧格式，放行
    perms = set(client_permissions or [])
    if "*" in perms or "all" in perms:
        return True
    return req in perms
