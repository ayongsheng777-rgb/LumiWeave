"""AI 导演台：导演任务持久化服务。

director_task 表记录一次"一键排片"任务的完整状态：
status（状态机）+ progress（0-100）+ log（步骤日志）+ result（资产/分镜/视频结果）。
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from app import db

TASK_KEYS = ("id", "scene_id", "project_id", "story_id", "status", "progress",
             "current_step", "log", "result", "created_at", "updated_at")


def new_task_id() -> str:
    return "dr_" + uuid.uuid4().hex[:16]


def _parse(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:  # noqa: BLE001
            return v
    return v


def _row(r: Any) -> dict:
    d = dict(r)
    d["log"] = _parse(d.get("log"))
    d["result"] = _parse(d.get("result"))
    return d


async def create_task(scene_id: str, story_id: str, project_id: str = "") -> str:
    tid = new_task_id()
    await db.execute(
        """INSERT INTO director_task (id, scene_id, project_id, story_id, status, progress, current_step, log, result)
           VALUES ($1,$2,$3,$4,'INIT',0,'', '[]', '{}')""",
        tid, scene_id, project_id, story_id,
    )
    return tid


async def get_task(task_id: str) -> dict | None:
    row = await db.fetchrow("SELECT * FROM director_task WHERE id=$1", task_id)
    return _row(row) if row else None


async def list_tasks(scene_id: str, limit: int = 20) -> list[dict]:
    rows = await db.fetch(
        "SELECT * FROM director_task WHERE scene_id=$1 ORDER BY created_at DESC LIMIT $2",
        scene_id, int(limit),
    )
    return [_row(r) for r in rows]


async def update_task(task_id: str, *, status: str | None = None, progress: int | None = None,
                      current_step: str | None = None, log: list[dict] | None = None,
                      result: dict | None = None, append_log: dict | None = None) -> dict | None:
    """更新任务；append_log 追加一条步骤日志。"""
    if append_log is not None:
        cur = await get_task(task_id)
        log = (cur or {}).get("log") or []
        log = list(log) + [append_log]
    sets, args = ["updated_at=NOW()"], []
    for key, val in (("status", status), ("progress", progress),
                     ("current_step", current_step), ("log", log), ("result", result)):
        if val is None:
            continue
        sets.append(f"{key}=${len(args) + 1}" + ("::jsonb" if key in ("log", "result") else ""))
        args.append(json.dumps(val, ensure_ascii=False) if key in ("log", "result") else val)
    if not args:
        return await get_task(task_id)
    args.append(task_id)
    await db.execute(f"UPDATE director_task SET {', '.join(sets)} WHERE id=${len(args)}", *args)
    # 2026-08-29：状态迁移同步写 task_events（执行历史可回放；静默失败不影响主流程）
    if status is not None:
        try:
            from app.task_service import add_event
            await add_event(task_id, status, {"progress": progress, "step": current_step or ""})
        except Exception:  # noqa: BLE001
            pass
    return await get_task(task_id)
