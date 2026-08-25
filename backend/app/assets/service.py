"""素材库服务层（V2 Issue #009）：管理 AI 生成结果与历史素材。"""
from __future__ import annotations

import json
import uuid
from typing import Any

from app import db


def new_asset_id() -> str:
    return "asset_" + uuid.uuid4().hex[:24]


def _row_to_asset(row: Any) -> dict[str, Any]:
    d = dict(row)
    v = d.get("metadata")
    if isinstance(v, str):
        try:
            d["metadata"] = json.loads(v)
        except Exception:
            d["metadata"] = {}
    return d


async def add_asset(
    task_id: str,
    asset_type: str,
    url: str,
    metadata: dict[str, Any] | None = None,
    name: str = "",
) -> str:
    aid = new_asset_id()
    await db.execute(
        """INSERT INTO assets (id, task_id, type, url, metadata, name)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6)""",
        aid, task_id, asset_type, url,
        json.dumps(metadata or {}, ensure_ascii=False), name,
    )
    return aid


async def list_assets(asset_type: str = "", limit: int = 100) -> list[dict[str, Any]]:
    if asset_type:
        rows = await db.fetch(
            "SELECT * FROM assets WHERE type=$1 ORDER BY created_at DESC LIMIT $2",
            asset_type, limit,
        )
    else:
        rows = await db.fetch(
            "SELECT * FROM assets ORDER BY created_at DESC LIMIT $1", limit
        )
    return [_row_to_asset(r) for r in rows]


async def delete_asset(aid: str) -> bool:
    res = await db.execute("DELETE FROM assets WHERE id=$1", aid)
    return bool(res)


async def rename_asset(aid: str, name: str) -> dict[str, Any] | None:
    await db.execute("UPDATE assets SET name=$2 WHERE id=$1", aid, name)
    row = await db.fetchrow("SELECT * FROM assets WHERE id=$1", aid)
    return _row_to_asset(row) if row else None
