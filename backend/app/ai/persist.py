from __future__ import annotations

import json
from typing import Any

from app import db
from app.config import AI_OVERRIDES

_KV_KEY = "ai_overrides"


async def load_overrides() -> None:
    """启动时从 app_kv 恢复 AI 配置覆盖层（重启后依然生效）。"""
    row = await db.fetchrow("SELECT value FROM app_kv WHERE key=$1", _KV_KEY)
    if not row:
        return
    try:
        data = json.loads(row["value"])
    except Exception:
        return
    AI_OVERRIDES["active"] = data.get("active")
    AI_OVERRIDES["models"] = data.get("models", {}) or {}


async def save_overrides() -> None:
    """把当前覆盖层写回 app_kv（持久化）。"""
    data: dict[str, Any] = {
        "active": AI_OVERRIDES["active"],
        "models": AI_OVERRIDES["models"],
    }
    await db.execute(
        """
        INSERT INTO app_kv (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
        """,
        _KV_KEY,
        json.dumps(data, ensure_ascii=False),
    )
