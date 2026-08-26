"""RenderAdapter 基类（规格书 §5 Adapter Pattern）。"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional
from app.render_kernel.schemas.render_plan import RenderPlan


@dataclass
class AdapterResponse:
    job_id: str
    status: str                        # queued | running | completed | failed
    engine: str
    output_urls: list[str] = field(default_factory=list)
    error: Optional[str] = None
    raw: Optional[dict] = None


class RenderAdapter(ABC):
    """
    各渲染引擎的统一抽象接口。
    子类实现 submit / status / cancel 三个方法即可接入 Render Kernel。
    """

    @property
    @abstractmethod
    def engine_name(self) -> str:
        """引擎标识: comfyui | cloud | minimax-video"""
        ...

    @abstractmethod
    async def submit(self, plan: RenderPlan) -> AdapterResponse:
        """
        提交渲染任务。
        返回 AdapterResponse（至少含 job_id + status）。
        """
        ...

    @abstractmethod
    async def status(self, job_id: str) -> AdapterResponse:
        """查询任务状态。"""
        ...

    async def cancel(self, job_id: str) -> AdapterResponse:
        """取消任务（可选实现）。"""
        return AdapterResponse(
            job_id=job_id,
            status="unknown",
            engine=self.engine_name,
            error="Cancel not implemented for this adapter.",
        )
