"""画布对象服务层（V2 Issue #002）：CanvasObject 的 CRUD 与序列化。"""
from __future__ import annotations

import json
import uuid
from typing import Any

from app import db

# 🔴 必须与前端 src/canvas/objectNodes.tsx 的 objectNodeTypes 对齐，
# 否则 create_object 会把未知类型静默降级成 'text'，导致画布节点渲染异常。
OBJECT_TYPES = {
    "text", "image", "video", "audio", "file", "prompt", "ai_result",
    "frame", "group", "workflow", "agent", "skill", "note", "reference",
    "input", "analyze", "asset", "output", "llm", "render",
    # 影视 / 工作流节点转换后在画布端真实渲染的类型
    "story", "character", "scene", "prop", "storyboard",
    "subtitle", "layout", "export", "image_input",
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
    oid: str | None = None,
) -> str:
    obj_type = obj_type if obj_type in OBJECT_TYPES else "text"
    oid = oid or new_object_id()
    await db.execute(
        """INSERT INTO canvas_objects (id, project_id, type, content, position, size, layer, metadata)
           VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             project_id=EXCLUDED.project_id, type=EXCLUDED.type, content=EXCLUDED.content,
             position=EXCLUDED.position, size=EXCLUDED.size, layer=EXCLUDED.layer,
             metadata=EXCLUDED.metadata, updated_at=NOW()""",
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


# ==================== 连线（Edge）CRUD ====================

def new_edge_id() -> str:
    return "edge_" + uuid.uuid4().hex[:24]


def _row_to_edge(row: Any) -> dict[str, Any]:
    d = dict(row)
    if isinstance(d.get("metadata"), str):
        try:
            d["metadata"] = json.loads(d["metadata"])
        except Exception:
            d["metadata"] = {}
    return d


async def list_edges(project_id: str) -> list[dict[str, Any]]:
    rows = await db.fetch(
        "SELECT * FROM canvas_edges WHERE project_id=$1 ORDER BY created_at ASC",
        project_id,
    )
    return [_row_to_edge(r) for r in rows]


async def create_edge(
    project_id: str,
    source: str,
    target: str,
    source_handle: str | None = None,
    target_handle: str | None = None,
    edge_type: str = "workflow",
    metadata: dict[str, Any] | None = None,
) -> str:
    eid = new_edge_id()
    await db.execute(
        """INSERT INTO canvas_edges (id, project_id, source, target, source_handle, target_handle, type, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)""",
        eid, project_id, source, target, source_handle, target_handle, edge_type,
        json.dumps(metadata or {}, ensure_ascii=False),
    )
    return eid


async def delete_edge(edge_id: str) -> None:
    await db.execute("DELETE FROM canvas_edges WHERE id=$1", edge_id)


async def delete_edges_by_nodes(node_ids: list[str]) -> None:
    """删除节点时级联清理相关连线。"""
    if not node_ids:
        return
    await db.execute(
        "DELETE FROM canvas_edges WHERE source = ANY($1) OR target = ANY($1)",
        node_ids,
    )
