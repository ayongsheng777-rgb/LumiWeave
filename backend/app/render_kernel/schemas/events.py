"""JobEvent — 渲染任务生命周期事件（规格书 §6）。"""
from __future__ import annotations

from typing import Optional, Literal
from pydantic import BaseModel, Field
from datetime import datetime


JobEventType = Literal[
    "created",
    "progress",
    "completed",
    "failed",
    "cancelled",
]


class JobCreatedPayload(BaseModel):
    job_id: str
    plan_id: str
    engine: str
    status: Literal["queued"] = "queued"
    queued_at: datetime = Field(default_factory=datetime.utcnow)


class JobProgressPayload(BaseModel):
    job_id: str
    progress: float = Field(ge=0.0, le=1.0, description="0.0-1.0")
    step: Optional[int] = Field(default=None, description="当前步数")
    total_steps: Optional[int] = Field(default=None)
    message: str = Field(default="")
    preview_url: Optional[str] = Field(default=None, description="中间预览图 URL")


class JobCompletedPayload(BaseModel):
    job_id: str
    output_urls: list[str] = Field(default_factory=list, description="产出的资产 URL")
    output_type: Literal["image", "video", "images"] = "image"
    duration: Optional[float] = Field(default=None, description="视频时长（秒）")
    metadata: dict = Field(default_factory=dict)


class JobFailedPayload(BaseModel):
    job_id: str
    error_code: str = Field(default="UNKNOWN")
    error_message: str = Field(default="")
    retryable: bool = Field(default=False)


class JobEvent(BaseModel):
    """
    规格书 §6 统一事件格式。
    WebSocket 推送 + REST 轮询共用同一 payload 结构。
    """
    event: JobEventType
    job_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    payload: Optional[dict] = Field(default=None)

    @classmethod
    def created(cls, job_id: str, plan_id: str, engine: str) -> JobEvent:
        p = JobCreatedPayload(job_id=job_id, plan_id=plan_id, engine=engine)
        return cls(event="created", job_id=job_id, payload=p.model_dump())

    @classmethod
    def progress(cls, **kw) -> JobEvent:
        p = JobProgressPayload(**kw)
        return cls(event="progress", job_id=kw["job_id"], payload=p.model_dump())

    @classmethod
    def completed(cls, **kw) -> JobEvent:
        p = JobCompletedPayload(**kw)
        return cls(event="completed", job_id=kw["job_id"], payload=p.model_dump())

    @classmethod
    def failed(cls, **kw) -> JobEvent:
        p = JobFailedPayload(**kw)
        return cls(event="failed", job_id=kw["job_id"], payload=p.model_dump())
