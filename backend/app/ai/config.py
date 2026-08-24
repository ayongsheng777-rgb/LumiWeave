from __future__ import annotations

import json
from typing import Any

from app.config import settings


def model_profiles() -> list[dict[str, Any]]:
    return settings.model_profiles()


def active_profile() -> dict[str, Any] | None:
    return settings.active_ai_profile()


def get_profile(profile_id: str | None = None) -> dict[str, Any] | None:
    if profile_id:
        return settings.get_profile_by_id(profile_id)
    return active_profile()


def available() -> bool:
    if not settings.ai_enabled:
        return False
    for p in model_profiles():
        key = (p.get("api_key") or "").strip()
        if key and not _is_placeholder(key):
            return True
    return False


def _is_placeholder(key: str) -> bool:
    lowered = key.lower()
    placeholders = ("your", "xxx", "sk-xxx", "changeme", "placeholder", "todo", "test")
    return any(p in lowered for p in placeholders) or len(key) < 8


def mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "****"
    return "****" + key[-4:]
