from __future__ import annotations

import asyncio
import uuid
from typing import Any, Optional

import httpx

from app.renderers.registry import BaseRenderer, RendererConfig


class ComfyUIConnector(BaseRenderer):
    """ComfyUI 真实连接器（spec #19 / #69）。queue / history / progress / cancel / retry / timeout。"""

    def __init__(self, cfg: RendererConfig):
        super().__init__(cfg)
        self.client_id = cfg.client_id or str(uuid.uuid4())

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.cfg.api_key:
            h["Authorization"] = f"Bearer {self.cfg.api_key}"
        return h

    async def health_check(self) -> bool:
        if not self.cfg.endpoint:
            return False
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
                resp = await client.get(f"{self.cfg.endpoint.rstrip('/')}/system_stats")
                return resp.status_code == 200
        except Exception:
            return False

    async def queue_prompt(self, workflow: dict[str, Any], retries: int = 3) -> Optional[str]:
        """提交工作流到 ComfyUI 队列，返回 prompt_id。带重试（rule #15）。"""
        payload = {"prompt": workflow, "client_id": self.client_id}
        last_err = ""
        for attempt in range(1, retries + 1):
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
                    resp = await client.post(
                        f"{self.cfg.endpoint.rstrip('/')}/prompt",
                        headers=self._headers(), json=payload,
                    )
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("prompt_id")
                last_err = f"HTTP {resp.status_code}"
            except Exception as exc:
                last_err = str(exc)
            await asyncio.sleep(min(2 * attempt, 6))
        self.last_error = last_err
        return None

    async def get_history(self, prompt_id: str) -> Optional[dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
                resp = await client.get(f"{self.cfg.endpoint.rstrip('/')}/history/{prompt_id}")
            if resp.status_code == 200:
                return resp.json().get(prompt_id)
        except Exception:
            return None
        return None

    async def wait_for_result(self, prompt_id: str, timeout: int | None = None) -> Optional[dict[str, Any]]:
        """轮询历史直到出现结果（rule #13 timeout）。WebSocket 不可用时降级为轮询。"""
        timeout = timeout or self.cfg.timeout
        deadline = asyncio.get_event_loop().time() + timeout
        interval = 3.0
        while asyncio.get_event_loop().time() < deadline:
            hist = await self.get_history(prompt_id)
            if hist is not None:
                return hist
            await asyncio.sleep(interval)
        self.last_error = "等待 ComfyUI 结果超时"
        return None

    async def cancel(self, prompt_id: str | None = None) -> bool:
        """取消当前队列（best-effort）。"""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
                resp = await client.post(
                    f"{self.cfg.endpoint.rstrip('/')}/interrupt",
                    headers=self._headers(),
                )
                return resp.status_code in (200, 204)
        except Exception:
            return False

    async def generate(self, workflow: dict[str, Any]) -> dict[str, Any]:
        """端到端：入队 -> 等待 -> 抽取图片。返回 {ok, prompt_id, images, error}。"""
        prompt_id = await self.queue_prompt(workflow)
        if not prompt_id:
            return {"ok": False, "prompt_id": None, "images": [], "error": self.last_error or "入队失败"}
        hist = await self.wait_for_result(prompt_id)
        if not hist:
            return {"ok": False, "prompt_id": prompt_id, "images": [], "error": self.last_error or "无结果"}
        images = self._extract_images(hist)
        return {"ok": True, "prompt_id": prompt_id, "images": images, "error": None}

    @staticmethod
    def _extract_images(hist: dict[str, Any]) -> list[dict[str, str]]:
        out: list[dict[str, str]] = []
        outputs = hist.get("outputs", {})
        for node_out in outputs.values():
            for img in node_out.get("images", []) or []:
                out.append({
                    "filename": img.get("filename", ""),
                    "subfolder": img.get("subfolder", ""),
                    "type": img.get("type", "output"),
                })
        return out
