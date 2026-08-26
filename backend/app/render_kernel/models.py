"""Render Kernel 领域模型：RenderJob / JobStatus（避免 db ↔ job 循环导入）。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from dataclasses import dataclass, field
from enum import Enum

from app.render_kernel.schemas.render_plan import RenderPlan
from app.render_kernel.schemas.events import JobEvent


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class RenderJob:
    """
    渲染任务完整上下文。
    对应 DB 表 render_jobs。
    """
    job_id: str
    plan_id: str
    engine: str
    status: JobStatus = JobStatus.QUEUED
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    output_urls: list[str] = field(default_factory=list)
    error: Optional[str] = None
    plan: Optional[RenderPlan] = None
    events: list[JobEvent] = field(default_factory=list)
