"""Render Kernel DB 层 — render_jobs / render_job_events / model_capabilities（规格书 §4）。

使用项目现有 asyncpg 连接池（app.db），真实落地 PostgreSQL。
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from app import db as _pg
from app.render_kernel.schemas.render_plan import RenderPlan
from app.render_kernel.schemas.events import JobEvent
from app.render_kernel.models import RenderJob, JobStatus


# ── render_jobs ───────────────────────────────────────────────────────────────

async def job_save(job: RenderJob) -> None:
    """INSERT ... ON CONFLICT 保存任务（含 plan_data 完整快照）。"""
    plan_json = job.plan.model_dump(mode="json") if job.plan else None
    await _pg.execute(
        """
        INSERT INTO render_jobs
            (job_id, plan_id, engine, status, progress, output_urls, error,
             plan_data, created_at, started_at, completed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (job_id) DO UPDATE SET
            status = EXCLUDED.status,
            progress = EXCLUDED.progress,
            output_urls = EXCLUDED.output_urls,
            error = EXCLUDED.error,
            started_at = EXCLUDED.started_at,
            completed_at = EXCLUDED.completed_at
        """,
        job.job_id,
        job.plan_id,
        job.engine,
        job.status.value,
        0.0,
        json.dumps(job.output_urls or []),
        job.error,
        json.dumps(plan_json) if plan_json is not None else None,
        job.created_at,
        job.started_at,
        job.completed_at,
    )


async def job_update_status(job: RenderJob) -> None:
    """更新任务状态 + 时间戳 + 输出。"""
    await _pg.execute(
        """
        UPDATE render_jobs
           SET status = $2, output_urls = $3, error = $4,
               started_at = COALESCE($5, started_at),
               completed_at = $6
         WHERE job_id = $1
        """,
        job.job_id,
        job.status.value,
        json.dumps(job.output_urls or []),
        job.error,
        job.started_at,
        job.completed_at,
    )


def _row_to_job(row) -> RenderJob:
    """asyncpg.Record → RenderJob。"""
    job = RenderJob(
        job_id=row["job_id"],
        plan_id=row["plan_id"],
        engine=row["engine"],
        status=JobStatus(row["status"]),
        created_at=row["created_at"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        output_urls=list(row["output_urls"] or []) if row["output_urls"] else [],
        error=row["error"],
    )
    # 恢复 plan 快照（若有）
    plan_raw = row["plan_data"]
    if plan_raw:
        try:
            plan_dict = plan_raw if isinstance(plan_raw, dict) else json.loads(plan_raw)
            job.plan = RenderPlan(**plan_dict)
        except Exception:
            job.plan = None
    return job


async def job_get(job_id: str) -> Optional[RenderJob]:
    row = await _pg.fetchrow(
        "SELECT * FROM render_jobs WHERE job_id = $1", job_id,
    )
    return _row_to_job(row) if row else None


async def job_list(limit: int = 50) -> list[RenderJob]:
    rows = await _pg.fetch(
        "SELECT * FROM render_jobs ORDER BY created_at DESC LIMIT $1", limit,
    )
    return [_row_to_job(r) for r in rows]


# ── render_job_events ─────────────────────────────────────────────────────────

async def job_append_event(job_id: str, event: JobEvent) -> None:
    await _pg.execute(
        """
        INSERT INTO render_job_events (job_id, event, payload)
        VALUES ($1, $2, $3)
        """,
        job_id,
        event.event,
        json.dumps(event.payload or {}, default=str),
    )


async def job_get_events(job_id: str) -> list[dict]:
    rows = await _pg.fetch(
        """
        SELECT event, payload, created_at
          FROM render_job_events
         WHERE job_id = $1
         ORDER BY id ASC
        """,
        job_id,
    )
    return [{
        "event": r["event"],
        "payload": r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"] or "{}"),
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
    } for r in rows]


# ── model_capabilities ────────────────────────────────────────────────────────

async def capabilities_list() -> list[dict]:
    """从 model_capabilities 表读取全部启用记录。"""
    rows = await _pg.fetch(
        "SELECT * FROM model_capabilities WHERE enabled = true ORDER BY priority ASC"
    )
    return [dict(r) for r in rows]
