"""ComfyUI 适配器（规格书 §5）。"""
from __future__ import annotations

import httpx, uuid
from app.render_kernel.schemas.render_plan import RenderPlan
from app.render_kernel.adapters.base import RenderAdapter, AdapterResponse


class ComfyUIAdapter(RenderAdapter):

    def __init__(self, base_url: str = "http://127.0.0.1:8188"):
        self.base_url = base_url.rstrip("/")

    @property
    def engine_name(self) -> str:
        return "comfyui"

    async def submit(self, plan: RenderPlan) -> AdapterResponse:
        # 构建 ComfyUI prompt dict（简化版，真实接入需根据 workflow 模板调整）
        prompt = {
            "3": {"class_type": "KSampler", "inputs": {
                "seed": plan.image.seed or 42,
                "steps": plan.image.steps,
                "cfg": plan.image.cfg_scale,
                "sampler_name": "euler",
                "scheduler": "normal",
                "positive": plan.visual_text,
                "negative": plan.negative_text,
                "model": ["CLIPTextEncode", 4],
            }},
        }
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(f"{self.base_url}/prompt", json={"prompt": prompt})
                resp.raise_for_status()
                data = resp.json()
                job_id = data.get("prompt_id", str(uuid.uuid4()))
                return AdapterResponse(job_id=job_id, status="queued", engine="comfyui")
        except Exception as e:
            return AdapterResponse(
                job_id="", status="failed", engine="comfyui",
                error=f"ComfyUI submit error: {e}",
            )

    async def status(self, job_id: str) -> AdapterResponse:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(f"{self.base_url}/history/{job_id}")
                if resp.status_code == 404:
                    return AdapterResponse(job_id=job_id, status="queued", engine="comfyui")
                resp.raise_for_status()
                data = resp.json()
                if job_id in data:
                    outputs = data[job_id].get("outputs", {})
                    images = [
                        f"{self.base_url}/view?filename={n['images'][0]}"
                        for n in outputs.values()
                        if "images" in n
                    ]
                    return AdapterResponse(
                        job_id=job_id, status="completed",
                        engine="comfyui", output_urls=images,
                    )
                return AdapterResponse(job_id=job_id, status="running", engine="comfyui")
        except Exception as e:
            return AdapterResponse(job_id=job_id, status="failed", engine="comfyui", error=str(e))
