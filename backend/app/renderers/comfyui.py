from __future__ import annotations

import asyncio
import copy
import time
import uuid
from typing import Any, Optional

import httpx

from app.renderers.registry import BaseRenderer, RendererConfig


def build_runtime_workflow(template: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
    """配置式 ComfyUI Workflow 模板 + 输入映射 = 运行时工作流（规格书 §15）。

    模板结构：
        {
          "nodes": { "<id>": {"class_type": "...", "inputs": {...}}, ... },
          "links": [...],
          "metadata": {
            "input_mapping": { "prompt": "6.inputs.text", "width": "5.inputs.width" }
          }
        }
    inputs 形如 {"prompt": "一只猫", "width": 512}，按 input_mapping 的
    "node_id.inputs.field" 路径注入到 nodes 对应位置。
    """
    workflow = copy.deepcopy(template)
    nodes = workflow.get("nodes", {})
    mapping = (workflow.get("metadata") or {}).get("input_mapping") or {}
    for input_name, value in inputs.items():
        path = mapping.get(input_name)
        if not path:
            continue
        parts = path.split(".")
        if len(parts) != 3 or parts[1] != "inputs":
            continue
        node_id, _, field = parts
        if node_id in nodes and isinstance(nodes[node_id], dict):
            nodes[node_id].setdefault("inputs", {})[field] = value
    workflow.pop("metadata", None)
    return workflow


class ComfyUIConnector(BaseRenderer):
    """ComfyUI 真实连接器（spec #13/#14/#15）。

    submit / status / cancel / result 分离，同时提供 generate 便捷封装。
    真实调用：GET /system_stats、POST /prompt、GET /history/{id}、GET /view。
    """

    def __init__(self, cfg: RendererConfig):
        super().__init__(cfg)
        self.client_id = cfg.client_id or str(uuid.uuid4())

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.cfg.api_key:
            h["Authorization"] = f"Bearer {self.cfg.api_key}"
        return h

    async def health(self) -> dict[str, Any]:
        if not self.cfg.enabled:
            return {"enabled": False, "healthy": False, "reason": "renderer 未启用"}
        if not self.cfg.endpoint:
            return {"enabled": True, "healthy": False, "reason": "endpoint 未配置"}
        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
                resp = await client.get(f"{self.cfg.endpoint.rstrip('/')}/system_stats")
            latency_ms = int((time.monotonic() - t0) * 1000)
            if resp.status_code == 200:
                return {"enabled": True, "healthy": True, "latency_ms": latency_ms,
                        "capabilities": self.capabilities()}
            return {"enabled": True, "healthy": False, "latency_ms": latency_ms,
                    "reason": f"HTTP {resp.status_code}"}
        except Exception as exc:
            latency_ms = int((time.monotonic() - t0) * 1000)
            return {"enabled": True, "healthy": False, "latency_ms": latency_ms,
                    "reason": str(exc)}

    async def submit(self, workflow: dict[str, Any], *, task_id: str) -> dict[str, Any]:
        """提交工作流到 ComfyUI 队列，返回 remote_task_id = prompt_id。"""
        payload = {"prompt": workflow, "client_id": self.client_id}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
                resp = await client.post(
                    f"{self.cfg.endpoint.rstrip('/')}/prompt",
                    headers=self._headers(), json=payload,
                )
            if resp.status_code != 200:
                return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
            data = resp.json()
            prompt_id = data.get("prompt_id")
            if not prompt_id:
                return {"ok": False, "error": f"入队失败: {data}"}
            return {"ok": True, "remote_task_id": prompt_id, "prompt_id": prompt_id}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    async def status(self, remote_task_id: str) -> dict[str, Any]:
        """查询任务状态：completed / error / running。"""
        hist = await self._get_history(remote_task_id)
        if hist is None:
            return {"status": "running", "remote_task_id": remote_task_id}
        status = hist.get("status", {})
        if status.get("status_str") == "error" or status.get("completed") is False:
            return {"status": "failed", "remote_task_id": remote_task_id, "history": hist}
        return {"status": "completed", "remote_task_id": remote_task_id, "history": hist}

    async def cancel(self, remote_task_id: str) -> dict[str, Any]:
        """取消当前队列（best-effort）。"""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
                resp = await client.post(
                    f"{self.cfg.endpoint.rstrip('/')}/interrupt", headers=self._headers(),
                )
                return {"ok": resp.status_code in (200, 204)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    async def result(self, remote_task_id: str) -> dict[str, Any]:
        """取回生成结果：图片/视频列表（filename/subfolder/type + url）。"""
        hist = await self._get_history(remote_task_id)
        if hist is None:
            return {"ok": False, "remote_task_id": remote_task_id, "images": [],
                    "videos": [], "error": "结果尚未就绪"}
        images = self._extract_images(hist)
        videos = self._extract_videos(hist)
        base = self.cfg.endpoint.rstrip("/")
        for img in images:
            img["url"] = (f"{base}/view?filename={img['filename']}"
                          f"&subfolder={img['subfolder']}&type={img['type']}")
        for vid in videos:
            vid["url"] = (f"{base}/view?filename={vid['filename']}"
                          f"&subfolder={vid['subfolder']}&type={vid['type']}")
        return {"ok": True, "remote_task_id": remote_task_id, "prompt_id": remote_task_id,
                "images": images, "videos": videos, "error": None}

    async def generate(self, workflow: dict[str, Any]) -> dict[str, Any]:
        """端到端：入队 -> 轮询等待 -> 抽取图片。返回 {ok, prompt_id, images, error}。"""
        submitted = await self.submit(workflow, task_id="")
        if not submitted.get("ok"):
            return {"ok": False, "prompt_id": None, "images": [], "error": submitted.get("error")}
        prompt_id = submitted["remote_task_id"]
        deadline = asyncio.get_event_loop().time() + self.cfg.timeout
        while asyncio.get_event_loop().time() < deadline:
            st = await self.status(prompt_id)
            if st.get("status") == "completed":
                return await self.result(prompt_id)
            if st.get("status") == "failed":
                return {"ok": False, "prompt_id": prompt_id, "images": [],
                        "error": "ComfyUI 执行失败"}
            await asyncio.sleep(3.0)
        return {"ok": False, "prompt_id": prompt_id, "images": [], "error": "等待 ComfyUI 结果超时"}

    # ---- 内部 ----

    async def _get_history(self, prompt_id: str) -> Optional[dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
                resp = await client.get(f"{self.cfg.endpoint.rstrip('/')}/history/{prompt_id}")
            if resp.status_code == 200:
                return resp.json().get(prompt_id)
        except Exception:
            return None
        return None

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

    @staticmethod
    def _extract_videos(hist: dict[str, Any]) -> list[dict[str, str]]:
        """抽取视频输出（ComfyUI 视频工作流如 Wan/AnimateDiff 用 VHS 等节点，
        结果落在 outputs 的 videos/gifs/animated 字段）。"""
        out: list[dict[str, str]] = []
        outputs = hist.get("outputs", {})
        for node_out in outputs.values():
            for key in ("videos", "gifs", "animated"):
                for v in node_out.get(key, []) or []:
                    if isinstance(v, dict) and v.get("filename"):
                        out.append({
                            "filename": v.get("filename", ""),
                            "subfolder": v.get("subfolder", ""),
                            "type": v.get("type", "output"),
                            "format": v.get("format", "mp4"),
                        })
        return out
