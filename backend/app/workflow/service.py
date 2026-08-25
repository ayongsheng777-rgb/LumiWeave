"""工作流 DAG 持久化服务（规格书 §5.5/§23：保存 → 刷新 → 恢复）。

V2.1 之前 workflow 只存在前端内存，刷新即丢。本模块把完整 DAG
（nodes + edges，引擎层格式）落库到 `workflows` 表，打通持久化闭环。

与 canvas_objects 的关系（规格书 §6）：
    Project → Canvas → { CanvasObject, WorkflowGraph }
两者通过 project_id 关联，本模块只负责 WorkflowGraph 的存取。
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from app import db


def new_workflow_id() -> str:
    return "wf_" + uuid.uuid4().hex[:24]


def _row_to_workflow(row: Any) -> dict[str, Any]:
    d = dict(row)
    v = d.get("graph")
    if isinstance(v, str):
        try:
            d["graph"] = json.loads(v)
        except Exception:
            d["graph"] = {"nodes": [], "edges": []}
    return d


async def save_workflow(
    project_id: str,
    graph: dict[str, Any],
    *,
    name: str = "",
    workflow_id: str | None = None,
) -> str:
    """保存（新增或更新）一个工作流，返回 workflow_id。

    graph 为引擎层格式：{"nodes": [...], "edges": [...]}。
    """
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    payload = {"nodes": nodes, "edges": edges}

    if workflow_id:
        await db.execute(
            """UPDATE workflows SET graph=$1::jsonb, name=$2, updated_at=NOW()
               WHERE id=$3""",
            json.dumps(payload, ensure_ascii=False), name, workflow_id,
        )
        return workflow_id

    wid = new_workflow_id()
    await db.execute(
        """INSERT INTO workflows (id, project_id, name, graph)
           VALUES ($1,$2,$3,$4::jsonb)""",
        wid, project_id, name, json.dumps(payload, ensure_ascii=False),
    )
    return wid


async def get_workflow(workflow_id: str) -> dict[str, Any] | None:
    row = await db.fetchrow("SELECT * FROM workflows WHERE id=$1", workflow_id)
    return _row_to_workflow(row) if row else None


async def list_workflows(project_id: str) -> list[dict[str, Any]]:
    rows = await db.fetch(
        "SELECT * FROM workflows WHERE project_id=$1 ORDER BY updated_at DESC",
        project_id,
    )
    return [_row_to_workflow(r) for r in rows]


async def delete_workflow(workflow_id: str) -> None:
    await db.execute("DELETE FROM workflows WHERE id=$1", workflow_id)
