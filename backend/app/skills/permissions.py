from __future__ import annotations

from typing import Iterable

# 高风险能力：默认关闭（spec #15）。必须显式开启才可用。
RISKY_PERMISSIONS = {
    "shell.execute",
    "file.delete",
    "network.request",
    "database.write",
    "comfyui.execute",
}

_ENABLED_RISKY: set[str] = set()


def set_enabled_risky(perms: Iterable[str]) -> None:
    _ENABLED_RISKY.clear()
    _ENABLED_RISKY.update(perms or [])


def enabled_risky() -> set[str]:
    return set(_ENABLED_RISKY)


def check_permissions(required: list[str], enabled_risky: set[str] | None = None) -> tuple[bool, list[str]]:
    """返回 (是否放行, 被拒绝的权限列表)。高风险权限未显式开启则拒绝。"""
    enabled = enabled_risky if enabled_risky is not None else _ENABLED_RISKY
    denied = []
    for p in required or []:
        if p in RISKY_PERMISSIONS and p not in enabled:
            denied.append(p)
    return (len(denied) == 0, denied)
