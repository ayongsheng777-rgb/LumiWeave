"""场景引擎服务层（V2.5 规格书 §33-§34）。

scenes / scene_objects / scene_edges 三张表的 CRUD 与序列化。
JSONB 字段统一 json.dumps 写入、json.loads 读取（asyncpg 透传规则，见 AGENTS.md §七.1）。
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from app import db


# ── ID 生成 ─────────────────────────────────────────────────────────────────

def new_scene_id() -> str:
    return "scene_" + uuid.uuid4().hex[:24]


def new_object_id() -> str:
    return "sobj_" + uuid.uuid4().hex[:24]


def new_edge_id() -> str:
    return "sedge_" + uuid.uuid4().hex[:24]


def _parse_json(v: Any) -> Any:
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return {}
    return v or {}


# ─────────────────────────────────────────────────────────────────────────────
# Scene（场景实例）
# ─────────────────────────────────────────────────────────────────────────────

async def create_scene(project_id: str, scene_type: str, name: str,
                       data: dict | None = None, sid: str | None = None) -> str:
    sid = sid or new_scene_id()
    await db.execute(
        """INSERT INTO scenes (id, project_id, scene_type, name, version, data)
           VALUES ($1,$2,$3,$4,1,$5::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             project_id=EXCLUDED.project_id, scene_type=EXCLUDED.scene_type,
             name=EXCLUDED.name, data=EXCLUDED.data, updated_at=NOW()""",
        sid, project_id, scene_type, name, json.dumps(data or {}, ensure_ascii=False),
    )
    return sid


async def list_scenes(project_id: str) -> list[dict]:
    rows = await db.fetch(
        "SELECT * FROM scenes WHERE project_id=$1 ORDER BY created_at ASC", project_id
    )
    return [_row_to_scene(r) for r in rows]


async def get_scene(sid: str) -> dict | None:
    row = await db.fetchrow("SELECT * FROM scenes WHERE id=$1", sid)
    return _row_to_scene(row) if row else None


async def update_scene(sid: str, **fields: Any) -> dict | None:
    sets, args = [], []
    for key in ("scene_type", "name", "data", "version"):
        if key not in fields:
            continue
        if key == "data":
            sets.append(f"data=${len(args) + 1}::jsonb")
            args.append(json.dumps(fields[key] or {}, ensure_ascii=False))
        else:
            sets.append(f"{key}=${len(args) + 1}")
            args.append(fields[key])
    if not sets:
        return await get_scene(sid)
    sets.append("updated_at=NOW()")
    args.append(sid)
    await db.execute(f"UPDATE scenes SET {', '.join(sets)} WHERE id=${len(args)}", *args)
    return await get_scene(sid)


async def delete_scene(sid: str) -> None:
    # 级联清对象与连线
    await db.execute("DELETE FROM scene_objects WHERE scene_id=$1", sid)
    await db.execute("DELETE FROM scene_edges WHERE scene_id=$1", sid)
    await db.execute("DELETE FROM scenes WHERE id=$1", sid)


def _row_to_scene(row: Any) -> dict:
    d = dict(row)
    d["data"] = _parse_json(d.get("data"))
    return d


# ─────────────────────────────────────────────────────────────────────────────
# SceneObject（场景内的专业对象）
# ─────────────────────────────────────────────────────────────────────────────

async def create_object(scene_id: str, obj_type: str, *,
                        x: float = 0, y: float = 0, width: float = 300, height: float = 200,
                        rotation: float = 0, z_index: int = 0,
                        data: dict | None = None, oid: str | None = None) -> str:
    oid = oid or new_object_id()
    await db.execute(
        """INSERT INTO scene_objects
           (id, scene_id, object_type, x, y, width, height, rotation, z_index, data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             scene_id=EXCLUDED.scene_id, object_type=EXCLUDED.object_type,
             x=EXCLUDED.x, y=EXCLUDED.y, width=EXCLUDED.width, height=EXCLUDED.height,
             rotation=EXCLUDED.rotation, z_index=EXCLUDED.z_index, data=EXCLUDED.data,
             updated_at=NOW()""",
        oid, scene_id, obj_type, x, y, width, height, rotation, z_index,
        json.dumps(data or {}, ensure_ascii=False),
    )
    return oid


async def list_objects(scene_id: str) -> list[dict]:
    rows = await db.fetch(
        "SELECT * FROM scene_objects WHERE scene_id=$1 ORDER BY z_index ASC, created_at ASC",
        scene_id,
    )
    return [_row_to_object(r) for r in rows]


async def get_object(oid: str) -> dict | None:
    row = await db.fetchrow("SELECT * FROM scene_objects WHERE id=$1", oid)
    return _row_to_object(row) if row else None


async def update_object(oid: str, **fields: Any) -> dict | None:
    sets, args = [], []
    numeric = {"x", "y", "width", "height", "rotation", "z_index"}
    for key in ("object_type", "x", "y", "width", "height", "rotation", "z_index", "data", "locked", "hidden"):
        if key not in fields:
            continue
        if key == "data":
            sets.append("data=$" + str(len(args) + 1) + "::jsonb")
            args.append(json.dumps(fields[key] or {}, ensure_ascii=False))
        elif key in numeric:
            sets.append(f"{key}=${len(args) + 1}")
            args.append(float(fields[key]) if key != "z_index" else int(fields[key]))
        else:
            sets.append(f"{key}=${len(args) + 1}")
            args.append(fields[key])
    if not sets:
        return await get_object(oid)
    sets.append("updated_at=NOW()")
    args.append(oid)
    await db.execute(f"UPDATE scene_objects SET {', '.join(sets)} WHERE id=${len(args)}", *args)
    return await get_object(oid)


async def delete_object(oid: str) -> None:
    await db.execute("DELETE FROM scene_edges WHERE source_id=$1 OR target_id=$1", oid)
    await db.execute("DELETE FROM scene_objects WHERE id=$1", oid)


def _row_to_object(row: Any) -> dict:
    d = dict(row)
    d["data"] = _parse_json(d.get("data"))
    return d


# ─────────────────────────────────────────────────────────────────────────────
# SceneEdge（场景内连线）
# ─────────────────────────────────────────────────────────────────────────────

async def create_edge(scene_id: str, source: str, target: str,
                      edge_type: str = "default", data: dict | None = None,
                      eid: str | None = None) -> str:
    eid = eid or new_edge_id()
    await db.execute(
        """INSERT INTO scene_edges (id, scene_id, source_id, target_id, edge_type, data)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb)""",
        eid, scene_id, source, target, edge_type, json.dumps(data or {}, ensure_ascii=False),
    )
    return eid


async def list_edges(scene_id: str) -> list[dict]:
    rows = await db.fetch(
        "SELECT * FROM scene_edges WHERE scene_id=$1 ORDER BY created_at ASC", scene_id
    )
    return [_row_to_edge(r) for r in rows]


async def delete_edge(eid: str) -> None:
    await db.execute("DELETE FROM scene_edges WHERE id=$1", eid)


def _row_to_edge(row: Any) -> dict:
    d = dict(row)
    d["data"] = _parse_json(d.get("data"))
    return d
