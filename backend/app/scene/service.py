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
    # 血缘自动连线（2026-08-30，三场景通用）：派生物料带 source_object_id 时
    # 自动建 源→新节点 的 lineage 边（源须同场景存在；同向边不重复建）。
    src = str((data or {}).get("source_object_id") or "").strip()
    if src and src != oid:
        try:
            exists = await db.fetchrow(
                "SELECT 1 FROM scene_objects WHERE id=$1 AND scene_id=$2", src, scene_id)
            if exists:
                dup = await db.fetchrow(
                    "SELECT 1 FROM scene_edges WHERE scene_id=$1 AND source_id=$2 AND target_id=$3",
                    scene_id, src, oid)
                if not dup:
                    await create_edge(scene_id, src, oid, edge_type="lineage")
        except Exception:  # noqa: BLE001  连线失败不阻塞对象创建
            pass
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


# ─────────────────────────────────────────────────────────────────────────────
# Scene Version（场景版本管理，§35）
# ─────────────────────────────────────────────────────────────────────────────

def new_version_id() -> str:
    return "sver_" + uuid.uuid4().hex[:24]


async def create_version(scene_id: str, label: str, snapshot: dict | None = None) -> str:
    """保存当前场景快照为新版本。snapshot 缺省时自动抓取当前 objects/edges/data。"""
    if not snapshot:
        scene = await get_scene(scene_id)
        objs = await list_objects(scene_id)
        edges = await list_edges(scene_id)
        snapshot = {
            "objects": [ {k: o[k] for k in ("id", "object_type", "x", "y", "width", "height", "rotation", "z_index", "locked", "hidden", "data") if k in o} for o in objs ],
            "edges": [ {k: e[k] for k in ("id", "source_id", "target_id", "edge_type", "data") if k in e} for e in edges ],
            "data": (scene or {}).get("data", {}),
        }
    # 版本号 = 已有最大 +1
    rows = await db.fetch("SELECT COALESCE(MAX(version),0) AS m FROM scene_versions WHERE scene_id=$1", scene_id)
    ver = (rows[0]["m"] if rows else 0) + 1
    vid = new_version_id()
    await db.execute(
        """INSERT INTO scene_versions (id, scene_id, version, label, snapshot)
           VALUES ($1,$2,$3,$4,$5::jsonb)""",
        vid, scene_id, ver, label or f"v{ver}", json.dumps(snapshot or {}, ensure_ascii=False),
    )
    return vid


async def list_versions(scene_id: str) -> list[dict]:
    rows = await db.fetch(
        "SELECT id, scene_id, version, label, created_at FROM scene_versions WHERE scene_id=$1 ORDER BY version DESC",
        scene_id,
    )
    return [dict(r) for r in rows]


async def get_version(vid: str) -> dict | None:
    row = await db.fetchrow("SELECT * FROM scene_versions WHERE id=$1", vid)
    if not row:
        return None
    d = dict(row)
    d["snapshot"] = _parse_json(d.get("snapshot"))
    return d


async def restore_version(scene_id: str, vid: str) -> dict | None:
    """用快照覆盖当前场景的 objects/edges（保留场景基本信息）。"""
    v = await get_version(vid)
    if not v:
        return None
    snap = v.get("snapshot") or {}
    # 清掉现有对象与连线
    await db.execute("DELETE FROM scene_objects WHERE scene_id=$1", scene_id)
    await db.execute("DELETE FROM scene_edges WHERE scene_id=$1", scene_id)
    for o in snap.get("objects", []):
        oid = o.get("id") or new_object_id()
        await db.execute(
            """INSERT INTO scene_objects
               (id, scene_id, object_type, x, y, width, height, rotation, z_index, locked, hidden, data)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
               ON CONFLICT (id) DO UPDATE SET
                 object_type=EXCLUDED.object_type, x=EXCLUDED.x, y=EXCLUDED.y,
                 width=EXCLUDED.width, height=EXCLUDED.height, rotation=EXCLUDED.rotation,
                 z_index=EXCLUDED.z_index, locked=EXCLUDED.locked, hidden=EXCLUDED.hidden,
                 data=EXCLUDED.data, updated_at=NOW()""",
            oid, scene_id, o.get("object_type", "text"),
            float(o.get("x", 0)), float(o.get("y", 0)), float(o.get("width", 300)), float(o.get("height", 200)),
            float(o.get("rotation", 0)), int(o.get("z_index", 0)),
            bool(o.get("locked", False)), bool(o.get("hidden", False)),
            json.dumps(o.get("data", {}) or {}, ensure_ascii=False),
        )
    for e in snap.get("edges", []):
        await db.execute(
            """INSERT INTO scene_edges (id, scene_id, source_id, target_id, edge_type, data)
               VALUES ($1,$2,$3,$4,$5,$6::jsonb)
               ON CONFLICT (id) DO NOTHING""",
            e.get("id") or new_edge_id(), scene_id,
            str(e.get("source_id", "")), str(e.get("target_id", "")),
            str(e.get("edge_type", "default")), json.dumps(e.get("data", {}) or {}, ensure_ascii=False),
        )
    if snap.get("data") is not None:
        await update_scene(scene_id, data=snap["data"])
    return await get_scene(scene_id)


# ─────────────────────────────────────────────────────────────────────────────
# Asset（素材库，§37/§38 复用 V2 assets 表，按 scene_id 检索）
# ─────────────────────────────────────────────────────────────────────────────

async def add_asset_for_scene(scene_id: str, asset_type: str, url: str,
                              name: str = "", metadata: dict | None = None) -> str:
    aid = "asset_" + uuid.uuid4().hex[:24]
    await db.execute(
        """INSERT INTO assets (id, task_id, type, url, name, scene_id, metadata)
           VALUES ($1,'', $2,$3,$4,$5,$6::jsonb)""",
        aid, asset_type, url, name, scene_id, json.dumps(metadata or {}, ensure_ascii=False),
    )
    return aid


async def list_scene_assets(scene_id: str, asset_type: str = "") -> list[dict]:
    if asset_type:
        rows = await db.fetch(
            "SELECT * FROM assets WHERE scene_id=$1 AND type=$2 ORDER BY created_at DESC",
            scene_id, asset_type,
        )
    else:
        rows = await db.fetch(
            "SELECT * FROM assets WHERE scene_id=$1 ORDER BY created_at DESC", scene_id,
        )
    out = []
    for r in rows:
        d = dict(r)
        d["metadata"] = _parse_json(d.get("metadata"))
        out.append(d)
    return out
