"""RenderJob — 渲染任务生命周期管理（规格书 §4 + §6）。"""
from __future__ import annotations

import uuid, asyncio
from datetime import datetime
from typing import Optional
from dataclasses import dataclass, field
from enum import Enum

from app.render_kernel.schemas.render_plan import RenderPlan
from app.render_kernel.schemas.events import JobEvent, JobEventType
from app.render_kernel.router.smart_router import SmartRouter
from app.render_kernel.db import (
    job_save, job_update_status, job_get, job_list,
    job_append_event,
)


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


class RenderJobManager:
    """
    渲染任务管理器：
    创建 → 提交到 Router → 轮询状态 → 写 DB + 推送 WS 事件。
    """

    def __init__(self) -> None:
        self.router = SmartRouter()
        self._running: dict[str, asyncio.Task] = {}

    async def create_job(self, plan: RenderPlan) -> RenderJob:
        """创建并持久化一个渲染任务。"""
        engine = self.router.route(plan)
        job = RenderJob(
            job_id=str(uuid.uuid4()),
            plan_id=plan.plan_id,
            engine=engine,
            status=JobStatus.QUEUED,
            plan=plan,
        )
        job_save(job)
        event = JobEvent.created(job.job_id, plan.plan_id, engine)
        job_append_event(job.job_id, event)
        return job

    async def start_job(self, job_id: str) -> None:
        """启动任务（异步轮询引擎状态）。"""
        job = job_get(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        job.status = JobStatus.RUNNING
        job.started_at = datetime.utcnow()
        job_update_status(job)
        event = JobEvent(event="progress", job_id=job_id, payload={
            "progress": 0.0, "message": "任务已启动，正在渲染…"
        })
        job_append_event(job_id, event)

        # 启动异步轮询
        task = asyncio.create_task(self._poll_job(job_id))
        self._running[job_id] = task

    async def _poll_job(self, job_id: str) -> None:
        """轮询引擎状态，直到完成/失败。"""
        job = job_get(job_id)
        if not job:
            return

        while True:
            await asyncio.sleep(5)
            job = job_get(job_id)
            if not job or job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
                break

            try:
                resp = await self.router.status(job.engine, job.job_id)
                if resp.status == "completed":
                    job.status = JobStatus.COMPLETED
                    job.completed_at = datetime.utcnow()
                    job.output_urls = resp.output_urls
                    job_update_status(job)
                    event = JobEvent.completed(
                        job_id=job_id,
                        output_urls=resp.output_urls,
                        output_type="video" if job.engine == "minimax-video" else "image",
                    )
                    job_append_event(job_id, event)
                    break
                elif resp.status == "failed":
                    job.status = JobStatus.FAILED
                    job.error = resp.error
                    job_update_status(job)
                    event = JobEvent.failed(
                        job_id=job_id,
                        error_code="ENGINE_ERROR",
                        error_message=resp.error or "Unknown",
                    )
                    job_append_event(job_id, event)
                    break
                else:
                    # running / queued，继续轮询
                    pass
            except Exception as e:
                job.error = str(e)
                job_update_status(job)
                break

        self._running.pop(job_id, None)

    async def submit_plan(self, plan: RenderPlan) -> RenderJob:
        """快捷方法：创建 job → 立即提交到引擎 → 启动轮询。"""
        job = await self.create_job(plan)
        resp = await self.router.submit(plan)
        if resp.status == "failed":
            job.error = resp.error
            job.status = JobStatus.FAILED
            job_update_status(job)
            return job
        # 更新 job_id（引擎可能返回不同 ID）
        if resp.job_id and resp.job_id != job.job_id:
            job.job_id = resp.job_id
            job_update_status(job)
        await self.start_job(job.job_id)
        return job

    def cancel_job(self, job_id: str) -> None:
        """取消任务。"""
        self._running.pop(job_id, None)
        job = job_get(job_id)
        if job:
            job.status = JobStatus.CANCELLED
            job_update_status(job)
            event = JobEvent(event="cancelled", job_id=job_id)
            job_append_event(job_id, event)


# ── 全局单例 ───────────────────────────────────────────────────────────────────
_job_manager: Optional[RenderJobManager] = None


def get_job_manager() -> RenderJobManager:
    global _job_manager
    if _job_manager is None:
        _job_manager = RenderJobManager()
    return _job_manager
