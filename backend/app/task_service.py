from __future__ import annotations

import json
import uuid
from typing import Any

from app import db

# 统一 Task 生命周期（规格书 §11）
TASK_QUEUED = "queued"
TASK_RUNNING = "running"
TASK_COMPLETED = "completed"
TASK_FAILED = "failed"
TASK_CANCELLED = "cancelled"
TASK_TIMEOUT = "timeout"
TASK_STATUSES = {TASK_QUEUED, TASK_RUNNING, TASK_COMPLETED, TASK_FAILED, TASK_CANCELLED, TASK_TIMEOUT}

# 内存级取消标记：task_id -> True（进程重启后清空，持久化取消见 status=cancelled）
_cancel_flags: dict[str, bool] = {}


def new_task_id() -> str:
    return "task_" + uuid.uuid4().hex[:24]


async def create_task(
    *,
    user_id: str = "",
    canvas_id: str = "",
    agent_id: str = "",
    skill_id: str = "",
    renderer_id: str = "",
    project_id: str = "",
    type: str = "",
    workflow_id: str = "",
    status: str = TASK_QUEUED,
) -> str:
    tid = new_task_id()
    await db.execute(
        """INSERT INTO tasks (id, user_id, canvas_id, agent_id, skill_id, renderer_id,
                              project_id, type, workflow_id, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
        tid, user_id, canvas_id, agent_id, skill_id, renderer_id, project_id, type,
        workflow_id, status,
    )
    return tid


async def add_event(task_id: str, etype: str, payload: dict[str, Any] | None = None) -> None:
    await db.execute(
        "INSERT INTO task_events (task_id, type, payload) VALUES ($1,$2,$3::jsonb)",
        task_id, etype, json.dumps(payload or {}, ensure_ascii=False),
    )


async def set_status(task_id: str, status: str) -> None:
    if status not in TASK_STATUSES:
        status = TASK_FAILED
    await db.execute(
        "UPDATE tasks SET status=$2, updated_at=NOW() WHERE id=$1", task_id, status
    )


async def set_result(task_id: str, content: str, data: dict[str, Any] | None = None) -> None:
    await db.execute(
        """INSERT INTO task_results (task_id, content, data) VALUES ($1,$2,$3::jsonb)
           ON CONFLICT (task_id) DO UPDATE SET content=EXCLUDED.content, data=EXCLUDED.data, ts=NOW()""",
        task_id, content, json.dumps(data or {}, ensure_ascii=False),
    )


async def get_task(task_id: str) -> dict | None:
    row = await db.fetchrow("SELECT * FROM tasks WHERE id=$1", task_id)
    return dict(row) if row else None


async def get_task_detail(task_id: str) -> dict | None:
    """任务详情 + 事件 + 结果，一次查全（供 /api/tasks/{id}）。"""
    task = await get_task(task_id)
    if not task:
        return None
    events = await db.fetch(
        "SELECT type, payload, ts FROM task_events WHERE task_id=$1 ORDER BY ts ASC", task_id
    )
    task["events"] = [{"type": e["type"], "payload": _parse_json(e["payload"]), "ts": str(e["ts"])}
                      for e in events]
    result = await db.fetchrow("SELECT content, data, ts FROM task_results WHERE task_id=$1", task_id)
    if result:
        task["result"] = {"content": result["content"], "data": _parse_json(result["data"]),
                          "ts": str(result["ts"])}
    else:
        task["result"] = None
    return task


async def get_events(task_id: str) -> list[dict[str, Any]]:
    rows = await db.fetch(
        "SELECT type, payload, ts FROM task_events WHERE task_id=$1 ORDER BY ts ASC", task_id
    )
    return [{"type": e["type"], "payload": _parse_json(e["payload"]), "ts": str(e["ts"])}
            for e in rows]


async def list_tasks(project_id: str = "", limit: int = 50) -> list[dict[str, Any]]:
    if project_id:
        rows = await db.fetch(
            "SELECT * FROM tasks WHERE project_id=$1 ORDER BY created_at DESC LIMIT $2",
            project_id, limit,
        )
    else:
        rows = await db.fetch("SELECT * FROM tasks ORDER BY created_at DESC LIMIT $1", limit)
    return [dict(r) for r in rows]


# ==================== 取消机制 ====================


def request_cancel(task_id: str) -> None:
    """登记取消标记；引擎在节点间检查并中止。"""
    _cancel_flags[task_id] = True


def is_cancelled(task_id: str) -> bool:
    return _cancel_flags.get(task_id, False)


def clear_cancel(task_id: str) -> None:
    _cancel_flags.pop(task_id, None)


def _parse_json(v: Any) -> Any:
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return v
    return v
