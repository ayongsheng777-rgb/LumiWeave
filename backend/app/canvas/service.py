"""画布对象服务层（V2 Issue #002）：CanvasObject 的 CRUD 与序列化。"""
from __future__ import annotations

import json
import uuid
from typing import Any

from app import db

OBJECT_TYPES = {
    "text", "image", "video", "audio", "file", "prompt", "ai_result",
    "frame", "group", "workflow", "agent", "skill", "note", "reference",
}


def new_object_id() -> str:
    return "obj_" + uuid.uuid4().hex[:24]


def _row_to_obj(row: Any) -> dict[str, Any]:
    d = dict(row)
    for key in ("content", "position", "size", "metadata"):
        v = d.get(key)
        if isinstance(v, str):
            try:
                d[key] = json.loads(v)
            except Exception:
                d[key] = {}
    return d


async def create_object(
    project_id: str,
    obj_type: str,
    content: dict[str, Any] | None = None,
    position: dict[str, Any] | None = None,
    size: dict[str, Any] | None = None,
    layer: int = 0,
    metadata: dict[str, Any] | None = None,
) -> str:
    obj_type = obj_type if obj_type in OBJECT_TYPES else "text"
    oid = new_object_id()
    await db.execute(
        """INSERT INTO canvas_objects (id, project_id, type, content, position, size, layer, metadata)
           VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8::jsonb)""",
        oid, project_id, obj_type,
        json.dumps(content or {}, ensure_ascii=False),
        json.dumps(position or {"x": 0, "y": 0}, ensure_ascii=False),
        json.dumps(size or {}, ensure_ascii=False),
        layer,
        json.dumps(metadata or {}, ensure_ascii=False),
    )
    return oid


async def list_objects(project_id: str) -> list[dict[str, Any]]:
    rows = await db.fetch(
        "SELECT * FROM canvas_objects WHERE project_id=$1 ORDER BY layer ASC, created_at ASC",
        project_id,
    )
    return [_row_to_obj(r) for r in rows]


async def get_object(oid: str) -> dict[str, Any] | None:
    row = await db.fetchrow("SELECT * FROM canvas_objects WHERE id=$1", oid)
    return _row_to_obj(row) if row else None


async def update_object(oid: str, **fields: Any) -> dict[str, Any] | None:
    jsonb_fields = {"content", "position", "size", "metadata"}
    sets: list[str] = []
    args: list[Any] = []
    for key in ("content", "position", "size", "layer", "metadata", "type"):
        if key not in fields:
            continue
        if key in jsonb_fields:
            sets.append(f"{key}=${len(args) + 1}::jsonb")
            args.append(json.dumps(fields[key] or {}, ensure_ascii=False))
        else:
            sets.append(f"{key}=${len(args) + 1}")
            args.append(fields[key])
    if not sets:
        return await get_object(oid)
    sets.append("updated_at=NOW()")
    args.append(oid)
    await db.execute(
        f"UPDATE canvas_objects SET {', '.join(sets)} WHERE id=${len(args)}", *args
    )
    return await get_object(oid)


async def delete_object(oid: str) -> None:
    await db.execute("DELETE FROM canvas_objects WHERE id=$1", oid)


async def batch_create(objects: list[dict[str, Any]], project_id: str) -> list[str]:
    """AI 批量创建对象，返回 id 列表。"""
    ids: list[str] = []
    for obj in objects:
        oid = await create_object(
            project_id,
            str(obj.get("type", "text")),
            obj.get("content") or {},
            obj.get("position") or {},
            obj.get("size") or {},
            int(obj.get("layer", 0)),
            obj.get("metadata") or {},
        )
        ids.append(oid)
    return ids
