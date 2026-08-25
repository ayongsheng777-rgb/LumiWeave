from __future__ import annotations

import json
from typing import Any

from app import db
from app.config import AI_OVERRIDES, CUSTOM_MODELS

_KV_KEY = "ai_overrides"
_MODELS_KEY = "ai_models"


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


async def load_custom_models() -> None:
    """启动时从 app_kv 恢复自定义模型库（界面增删改的模型，重启不丢）。

    🔴 必须原地更新（clear/extend），不能 `CUSTOM_MODELS = data` 重新赋值：
    跨模块 `from app.config import CUSTOM_MODELS` 拿到的是列表引用，重新赋值
    只会改当前模块的变量名，config 里的原始列表不变，导致界面读到空列表、
    DB 里却残留数据（test_model_x 删不掉的根因）。
    """
    row = await db.fetchrow("SELECT value FROM app_kv WHERE key=$1", _MODELS_KEY)
    if not row:
        return
    try:
        data = json.loads(row["value"])
    except Exception:
        return
    if isinstance(data, list):
        CUSTOM_MODELS.clear()
        CUSTOM_MODELS.extend(data)


async def save_custom_models() -> None:
    """把自定义模型库写回 app_kv。"""
    await db.execute(
        """
        INSERT INTO app_kv (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
        """,
        _MODELS_KEY,
        json.dumps(CUSTOM_MODELS, ensure_ascii=False),
    )
