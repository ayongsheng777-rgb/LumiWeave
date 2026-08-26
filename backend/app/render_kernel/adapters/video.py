"""视频生成引擎适配器（规格书 §5）。"""
from __future__ import annotations

import httpx, uuid
from app.render_kernel.schemas.render_plan import RenderPlan
from app.render_kernel.adapters.base import RenderAdapter, AdapterResponse
from app.config import settings


class VideoAdapter(RenderAdapter):
    """MiniMax 视频生成（H3 协议）。"""

    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or settings.minimax_api_key
        self.base_url = (base_url or settings.minimax_base_url).rstrip("/")

    @property
    def engine_name(self) -> str:
        return "minimax-video"

    async def submit(self, plan: RenderPlan) -> AdapterResponse:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": plan.video.model,
            "prompt": plan.visual_text,
            "duration": plan.video.duration,
            "fps": plan.video.fps,
            "prompt_strength": plan.video.prompt_strength,
        }
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{self.base_url}/v1/video/generations",
                    json=payload, headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()
                job_id = data.get("data", {}).get("task_id", str(uuid.uuid4()))
                return AdapterResponse(job_id=job_id, status="queued", engine="minimax-video", raw=data)
        except Exception as e:
            return AdapterResponse(job_id="", status="failed", engine="minimax-video", error=str(e))

    async def status(self, job_id: str) -> AdapterResponse:
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{self.base_url}/v1/task/status",
                    params={"task_id": job_id},
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()
                task_status = data.get("status", "running")
                status_map = {"SUCCESS": "completed", "FAIL": "failed", "PROCESSING": "running"}
                mapped = status_map.get(task_status, "running")
                output_urls = []
                if mapped == "completed":
                    output_urls = [data.get("data", {}).get("video_url", "")]
                    output_urls = [u for u in output_urls if u]
                return AdapterResponse(
                    job_id=job_id, status=mapped, engine="minimax-video",
                    output_urls=output_urls, raw=data,
                )
        except Exception as e:
            return AdapterResponse(job_id=job_id, status="failed", engine="minimax-video", error=str(e))
