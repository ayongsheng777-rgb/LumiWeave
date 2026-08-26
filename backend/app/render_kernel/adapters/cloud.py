"""Cloud 渲染适配器（MiniMax H3 云端，规格书 §5）。"""
from __future__ import annotations

import httpx, uuid, os
from app.render_kernel.schemas.render_plan import RenderPlan
from app.render_kernel.adapters.base import RenderAdapter, AdapterResponse


class CloudAdapter(RenderAdapter):
    """
    MiniMax H3 云端渲染适配器。
    环境变量 MINIMAX_API_KEY / MINIMAX_BASE_URL 配置端点。
    """

    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or os.getenv("MINIMAX_API_KEY", "")
        self.base_url = (base_url or os.getenv("MINIMAX_BASE_URL", "https://api.minimax.chat")).rstrip("/")
        self.group_id = os.getenv("MINIMAX_GROUP_ID", "")

    @property
    def engine_name(self) -> str:
        return "cloud"

    async def submit(self, plan: RenderPlan) -> AdapterResponse:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        is_video = plan.video and plan.video.duration > 0
        payload = {
            "model": plan.video.model if is_video else "minimax-image-01",
            "prompt": plan.visual_text,
            "negative_prompt": plan.negative_text,
            "num_images": plan.image.batch_size,
            "width": plan.image.width,
            "height": plan.image.height,
        }
        if is_video:
            payload["duration"] = plan.video.duration
            payload["fps"] = plan.video.fps

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                endpoint = f"{self.base_url}/v1/{'video' if is_video else 'image'}/generations"
                resp = await client.post(endpoint, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                job_id = data.get("data", {}).get("task_id", str(uuid.uuid4()))
                return AdapterResponse(job_id=job_id, status="queued", engine="cloud", raw=data)
        except Exception as e:
            return AdapterResponse(job_id="", status="failed", engine="cloud", error=str(e))

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
                if resp.status_code == 404:
                    return AdapterResponse(job_id=job_id, status="queued", engine="cloud")
                resp.raise_for_status()
                data = resp.json()
                task_status = data.get("status", "running")
                status_map = {"SUCCESS": "completed", "FAIL": "failed", "PROCESSING": "running"}
                mapped = status_map.get(task_status, "running")
                output_urls = []
                if mapped == "completed":
                    output_urls = [data.get("data", {}).get("video_url", ""),
                                  data.get("data", {}).get("image_url", "")]
                    output_urls = [u for u in output_urls if u]
                return AdapterResponse(job_id=job_id, status=mapped, engine="cloud",
                                      output_urls=output_urls, raw=data)
        except Exception as e:
            return AdapterResponse(job_id=job_id, status="failed", engine="cloud", error=str(e))
