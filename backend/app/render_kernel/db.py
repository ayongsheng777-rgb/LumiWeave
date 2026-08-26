"""Render Kernel DB 层 — render_jobs / model_capabilities 表操作（规格书 §4）。"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Optional
from app.render_kernel.schemas.render_plan import RenderPlan
from app.render_kernel.schemas.events import JobEvent
from app.render_kernel.job import RenderJob, JobStatus

# ── 内存存储（生产替换为 PostgreSQL via SQLAlchemy）──────────────────────────
_jobs: dict[str, RenderJob] = {}
_events: dict[str, list[dict]] = {}
_capabilities: list[dict] = []


# ── render_jobs ───────────────────────────────────────────────────────────────

def job_save(job: RenderJob) -> None:
    _jobs[job.job_id] = job


def job_get(job_id: str) -> Optional[RenderJob]:
    return _jobs.get(job_id)


def job_update_status(job: RenderJob) -> None:
    _jobs[job.job_id] = job


def job_list(limit: int = 50) -> list[RenderJob]:
    return sorted(_jobs.values(), key=lambda j: j.created_at, reverse=True)[:limit]


# ── job_events ────────────────────────────────────────────────────────────────

def job_append_event(job_id: str, event: JobEvent) -> None:
    _events.setdefault(job_id, []).append(event.model_dump())


def job_get_events(job_id: str) -> list[dict]:
    return _events.get(job_id, [])


# ── model_capabilities ────────────────────────────────────────────────────────

def capabilities_save(rows: list[dict]) -> None:
    global _capabilities
    _capabilities = rows


def capabilities_list() -> list[dict]:
    return _capabilities
