from __future__ import annotations

import json
import uuid
from typing import Any

from app import db


def new_task_id() -> str:
    return "task_" + uuid.uuid4().hex[:24]


async def create_task(
    *,
    user_id: str = "",
    canvas_id: str = "",
    agent_id: str = "",
    skill_id: str = "",
    renderer_id: str = "",
) -> str:
    tid = new_task_id()
    await db.execute(
        """INSERT INTO tasks (id, user_id, canvas_id, agent_id, skill_id, renderer_id, status)
           VALUES ($1,$2,$3,$4,$5,$6,'pending')""",
        tid, user_id, canvas_id, agent_id, skill_id, renderer_id,
    )
    return tid


async def add_event(task_id: str, etype: str, payload: dict[str, Any] | None = None) -> None:
    await db.execute(
        "INSERT INTO task_events (task_id, type, payload) VALUES ($1,$2,$3::jsonb)",
        task_id, etype, json.dumps(payload or {}, ensure_ascii=False),
    )


async def set_status(task_id: str, status: str) -> None:
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
