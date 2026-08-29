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
    # 影视类（LLM/出图/生视频均消耗云端费用 → 执行权限）
    "film.story_parse": PERMISSION_EXECUTE,
    "film.character_generate": PERMISSION_EXECUTE,
    "film.scene_generate": PERMISSION_EXECUTE,
    "film.prop_generate": PERMISSION_EXECUTE,
    "film.storyboard_generate": PERMISSION_EXECUTE,
    "film.video_generate": PERMISSION_EXECUTE,
    "film.subtitle_generate": PERMISSION_EXECUTE,
    "film.build_story": PERMISSION_EXECUTE,
    "film.export": PERMISSION_WRITE,
    # 场景类
    "scene.list": PERMISSION_READ,
    "scene.load": PERMISSION_READ,
    "scene.asset.list": PERMISSION_READ,
    "scene.create": PERMISSION_WRITE,
    "scene.save": PERMISSION_WRITE,
    "scene.version.save": PERMISSION_WRITE,
    "scene.action.execute": PERMISSION_EXECUTE,
    # 营销类
    "marketing.create_project": PERMISSION_WRITE,
    "marketing.export_assets": PERMISSION_WRITE,
    "marketing.generate_strategy": PERMISSION_EXECUTE,
    "marketing.generate_storyboard": PERMISSION_EXECUTE,
    "marketing.generate_visual_board": PERMISSION_EXECUTE,
    "marketing.render_campaign": PERMISSION_EXECUTE,
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
        client_permissions = [client_permissions]  # 单字符串按单条权限处理（不再视为通配）
    perms = set(client_permissions or [])
    if "*" in perms:
        return True
    return req in perms
