"""RenderJob — 渲染任务生命周期管理（规格书 §4 + §6）。"""
from __future__ import annotations

import uuid, asyncio
from datetime import datetime
from typing import Optional

from app.render_kernel.schemas.render_plan import RenderPlan
from app.render_kernel.schemas.events import JobEvent, JobEventType
from app.render_kernel.models import RenderJob, JobStatus
from app.render_kernel.router.smart_router import SmartRouter
from app.render_kernel.db import (
    job_save, job_update_status, job_get, job_list,
    job_append_event,
)


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
        await job_save(job)
        event = JobEvent.created(job.job_id, plan.plan_id, engine)
        await job_append_event(job.job_id, event)
        return job

    async def start_job(self, job_id: str) -> None:
        """启动任务（异步轮询引擎状态）。"""
        job = await job_get(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        job.status = JobStatus.RUNNING
        job.started_at = datetime.utcnow()
        await job_update_status(job)
        event = JobEvent(event="progress", job_id=job_id, payload={
            "progress": 0.0, "message": "任务已启动，正在渲染…"
        })
        await job_append_event(job_id, event)

        # 启动异步轮询
        task = asyncio.create_task(self._poll_job(job_id))
        self._running[job_id] = task

    async def _poll_job(self, job_id: str) -> None:
        """轮询引擎状态，直到完成/失败。"""
        job = await job_get(job_id)
        if not job:
            return

        while True:
            await asyncio.sleep(5)
            job = await job_get(job_id)
            if not job or job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
                break

            try:
                resp = await self.router.status(job.engine, job.job_id)
                if resp.status == "completed":
                    job.status = JobStatus.COMPLETED
                    job.completed_at = datetime.utcnow()
                    job.output_urls = resp.output_urls
                    await job_update_status(job)
                    event = JobEvent.completed(
                        job_id=job_id,
                        output_urls=resp.output_urls,
                        output_type="video" if job.engine == "minimax-video" else "image",
                    )
                    await job_append_event(job_id, event)
                    break
                elif resp.status == "failed":
                    job.status = JobStatus.FAILED
                    job.error = resp.error
                    await job_update_status(job)
                    event = JobEvent.failed(
                        job_id=job_id,
                        error_code="ENGINE_ERROR",
                        error_message=resp.error or "Unknown",
                    )
                    await job_append_event(job_id, event)
                    break
                else:
                    # running / queued，继续轮询
                    pass
            except Exception as e:
                job.error = str(e)
                await job_update_status(job)
                break

        self._running.pop(job_id, None)

    async def submit_plan(self, plan: RenderPlan) -> RenderJob:
        """快捷方法：创建 job → 立即提交到引擎 → 启动轮询。"""
        job = await self.create_job(plan)
        resp = await self.router.submit(plan)
        if resp.status == "failed":
            job.error = resp.error
            job.status = JobStatus.FAILED
            await job_update_status(job)
            return job
        # 更新 job_id（引擎可能返回不同 ID）
        if resp.job_id and resp.job_id != job.job_id:
            job.job_id = resp.job_id
            await job_update_status(job)
        await self.start_job(job.job_id)
        return job

    async def cancel_job(self, job_id: str) -> None:
        """取消任务。"""
        self._running.pop(job_id, None)
        job = await job_get(job_id)
        if job:
            job.status = JobStatus.CANCELLED
            await job_update_status(job)
            event = JobEvent(event="cancelled", job_id=job_id)
            await job_append_event(job_id, event)


# ── 全局单例 ───────────────────────────────────────────────────────────────────
_job_manager: Optional[RenderJobManager] = None


def get_job_manager() -> RenderJobManager:
    global _job_manager
    if _job_manager is None:
        _job_manager = RenderJobManager()
    return _job_manager
