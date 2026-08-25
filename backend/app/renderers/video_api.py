"""云端视频 API 连接器（V2 Issue #007 视频模块）。

统一「提交 → 轮询 → 取结果」的异步视频生成协议，按 endpoint 自动识别服务商：
  - minimax   MiniMax H3（Hailuo，文生/图生视频）
  - kling     可灵 Kling
  - siliconflow 硅基流动
  - openai    通用 OpenAI 兼容（聚合平台兜底）

所有实现遵守 BaseRenderer 的 submit / status / cancel / result 分离契约。
无 api_key 或 endpoint 未配置时，health 明确返回 reason，不伪造 healthy。
"""
from __future__ import annotations

import time
import uuid
from typing import Any, Optional

import httpx

from app.renderers.registry import BaseRenderer, RendererConfig


def detect_provider(endpoint: str, client_id: str = "") -> str:
    hint = ((endpoint or "") + " " + (client_id or "")).lower()
    if "minimax" in hint or "hailuo" in hint or "h3" in hint:
        return "minimax_h3"
    if "kling" in hint or "kuaishou" in hint or "lingmou" in hint:
        return "kling"
    if "siliconflow" in hint:
        return "siliconflow"
    if "ltx" in hint:
        return "ltx_video"
    return "openai"


class VideoApiConnector(BaseRenderer):
    """云端视频生成连接器。type=video-api。"""

    def __init__(self, cfg: RendererConfig):
        super().__init__(cfg)
        self.provider = detect_provider(cfg.endpoint, cfg.client_id)

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.cfg.api_key:
            h["Authorization"] = f"Bearer {self.cfg.api_key}"
        return h

    def _base(self) -> str:
        return (self.cfg.endpoint or "").rstrip("/")

    # ---- 统一参数抽取 ----
    @staticmethod
    def _params(workflow: dict[str, Any]) -> dict[str, Any]:
        """从工作流/节点数据里抽视频参数（宽容容错）。"""
        p = workflow.get("params") or workflow.get("video") or workflow
        if isinstance(p, str):
            import json
            try:
                p = json.loads(p)
            except Exception:
                p = {}
        return p if isinstance(p, dict) else {}

    # ---- health ----
    async def health(self) -> dict[str, Any]:
        if not self.cfg.enabled:
            return {"enabled": False, "healthy": False, "reason": "renderer 未启用"}
        if not self.cfg.endpoint:
            return {"enabled": True, "healthy": False, "reason": "endpoint 未配置"}
        if not self.cfg.api_key:
            return {"enabled": True, "healthy": False, "reason": "api_key 未配置"}
        return {"enabled": True, "healthy": True, "reason": "已配置",
                "provider": self.provider, "capabilities": self.capabilities()}

    def capabilities(self) -> list[str]:
        return ["text_to_video", "image_to_video"]

    # ---- submit ----
    async def submit(self, workflow: dict[str, Any], *, task_id: str) -> dict[str, Any]:
        p = self._params(workflow)
        path, payload = self._build_submit(p)
        if not path:
            return {"ok": False, "error": f"未支持的视频服务商: {self.provider}"}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
                resp = await client.post(self._base() + path, headers=self._headers(), json=payload)
            if resp.status_code not in (200, 201):
                return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
            data = resp.json()
            remote_id = self._extract_task_id(data)
            if not remote_id:
                return {"ok": False, "error": f"提交未返回任务ID: {data}"}
            return {"ok": True, "remote_task_id": remote_id, "prompt_id": remote_id}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}

    # ---- status ----
    async def status(self, remote_task_id: str) -> dict[str, Any]:
        path = self._status_path(remote_task_id)
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
                resp = await client.get(self._base() + path, headers=self._headers())
            if resp.status_code != 200:
                return {"status": "running", "remote_task_id": remote_task_id}
            state = self._parse_status(resp.json())
            return {"status": state, "remote_task_id": remote_task_id}
        except Exception:  # noqa: BLE001
            return {"status": "running", "remote_task_id": remote_task_id}

    # ---- result ----
    async def result(self, remote_task_id: str) -> dict[str, Any]:
        path = self._result_path(remote_task_id)
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
                resp = await client.get(self._base() + path, headers=self._headers())
            if resp.status_code != 200:
                return {"ok": False, "remote_task_id": remote_task_id, "videos": [],
                        "error": f"HTTP {resp.status_code}"}
            data = resp.json()
            videos = self._extract_videos(data)
            if not videos:
                return {"ok": False, "remote_task_id": remote_task_id, "videos": [],
                        "error": "结果里没有视频链接"}
            return {"ok": True, "remote_task_id": remote_task_id, "prompt_id": remote_task_id,
                    "videos": videos, "images": [], "error": None}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "remote_task_id": remote_task_id, "videos": [],
                    "error": str(exc)}

    # ---- cancel（best-effort） ----
    async def cancel(self, remote_task_id: str) -> dict[str, Any]:
        return {"ok": False, "error": "云端视频任务通常不支持取消"}

    # ---- generate 便捷封装（提交→轮询→取结果） ----
    async def generate(self, workflow: dict[str, Any]) -> dict[str, Any]:
        submitted = await self.submit(workflow, task_id="")
        if not submitted.get("ok"):
            return {"ok": False, "videos": [], "images": [], "error": submitted.get("error")}
        rid = submitted["remote_task_id"]
        deadline = time.monotonic() + self.cfg.timeout
        while time.monotonic() < deadline:
            st = await self.status(rid)
            if st.get("status") == "completed":
                return await self.result(rid)
            if st.get("status") == "failed":
                return {"ok": False, "videos": [], "images": [], "error": "视频生成失败"}
            await self._sleep(5.0)
        return {"ok": False, "videos": [], "images": [], "error": "等待视频结果超时"}

    async def _sleep(self, sec: float) -> None:
        import asyncio
        await asyncio.sleep(sec)

    # ---- 各服务商差异 ----
    def _build_submit(self, p: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        prompt = str(p.get("prompt") or "").strip()
        model = str(p.get("model") or "")
        duration = int(p.get("duration") or p.get("duration_sec") or 6)
        ratio = str(p.get("ratio") or "16:9")
        image_url = str(p.get("image_url") or "")
        negative = str(p.get("negative_prompt") or "")
        # 多参考图：角色图/场景图/道具图等，全部作为参考（MiniMax subject_reference 支持多图）
        raw_refs = p.get("reference_images") or p.get("reference") or []
        if isinstance(raw_refs, str):
            raw_refs = [raw_refs]
        reference_images = [str(u).strip() for u in raw_refs if u and str(u).strip()] if isinstance(raw_refs, (list, tuple)) else []
        mode = str(p.get("mode") or ("image2video" if (image_url or reference_images) else "text2video"))

        if self.provider in ("minimax", "minimax_h3"):
            payload: dict[str, Any] = {
                "model": model or "Hailuo-02",
                "prompt": prompt,
                "duration": duration,
            }
            if negative:
                payload["negative_prompt"] = negative
            # subject_reference 支持多图：多个角色/场景/道具参考图合并
            refs = [{"type": "image", "url": u} for u in reference_images]
            if image_url and not refs:
                refs = [{"type": "image", "url": image_url}]
            if refs:
                payload["subject_reference"] = refs
            return "/v1/video_generation", payload

        if self.provider == "kling":
            payload = {
                "model_name": model or "kling-v1-5",
                "prompt": prompt,
                "duration": str(duration),
                "aspect_ratio": ratio,
                "mode": "std",
            }
            if negative:
                payload["negative_prompt"] = negative
            if image_url:
                payload["image"] = image_url
            return "/v1/videos/text2video", payload

        if self.provider == "siliconflow":
            payload = {
                "model": model or "Wan-AI/Wan2.1-T2V-14B",
                "prompt": prompt,
                "image_size": self._ratio_to_size(ratio),
                "num_frames": duration * 16,
            }
            if negative:
                payload["negative_prompt"] = negative
            if image_url:
                payload["image_url"] = image_url
            return "/v1/video/submit", payload

        # openai 兼容兜底
        payload = {
            "model": model or "video",
            "prompt": prompt,
            "duration": duration,
            "ratio": ratio,
            "mode": mode,
        }
        if negative:
            payload["negative_prompt"] = negative
        if image_url:
            payload["image_url"] = image_url
        return "/v1/video/generations", payload

    @staticmethod
    def _ratio_to_size(ratio: str) -> str:
        mapping = {"16:9": "1280x720", "9:16": "720x1280", "1:1": "960x960", "4:3": "1024x768", "3:4": "768x1024"}
        return mapping.get(ratio, "1280x720")

    def _extract_task_id(self, data: dict[str, Any]) -> str:
        if self.provider in ("minimax", "minimax_h3"):
            return str(data.get("task_id") or data.get("id") or "")
        if self.provider == "kling":
            d = data.get("data") or {}
            return str(d.get("task_id") or data.get("task_id") or "")
        if self.provider == "siliconflow":
            return str(data.get("taskId") or data.get("task_id") or data.get("id") or "")
        return str(data.get("id") or data.get("task_id") or "")

    def _status_path(self, rid: str) -> str:
        if self.provider in ("minimax", "minimax_h3"):
            return f"/v1/query/video_generation?task_id={rid}"
        if self.provider == "kling":
            return f"/v1/videos/text2video/{rid}"
        if self.provider == "siliconflow":
            return f"/v1/video/status?taskId={rid}"
        return f"/v1/video/generations/{rid}"

    def _result_path(self, rid: str) -> str:
        return self._status_path(rid)

    def _parse_status(self, data: dict[str, Any]) -> str:
        if self.provider in ("minimax", "minimax_h3"):
            st = str(data.get("status", "")).lower()
            if st in ("success", "succeed", "completed", "complete"):
                return "completed"
            if st in ("failed", "fail", "error"):
                return "failed"
            return "running"
        if self.provider == "kling":
            st = str((data.get("data") or {}).get("task_status", "")).lower()
            if st in ("succeed", "success"):
                return "completed"
            if st in ("failed", "fail"):
                return "failed"
            return "running"
        if self.provider == "siliconflow":
            st = str(data.get("status", "")).lower()
            if st in ("succeed", "success", "done", "completed"):
                return "completed"
            if st in ("failed", "fail"):
                return "failed"
            return "running"
        st = str(data.get("status", "")).lower()
        if st in ("succeeded", "success", "completed", "complete", "done"):
            return "completed"
        if st in ("failed", "fail", "error"):
            return "failed"
        return "running"

    def _extract_videos(self, data: dict[str, Any]) -> list[dict[str, str]]:
        out: list[dict[str, str]] = []
        if self.provider in ("minimax", "minimax_h3"):
            url = data.get("file") or data.get("video_url") or ""
            if url:
                out.append({"url": url, "type": "video/mp4"})
            return out
        if self.provider == "kling":
            videos = (data.get("data") or {}).get("task_result", {}).get("videos", []) or []
            for v in videos:
                if v.get("url"):
                    out.append({"url": v["url"], "type": "video/mp4"})
            return out
        if self.provider == "siliconflow":
            url = data.get("url") or data.get("video_url") or ""
            for v in (data.get("videos") or []):
                if v.get("url"):
                    out.append({"url": v["url"], "type": "video/mp4"})
            if url and not out:
                out.append({"url": url, "type": "video/mp4"})
            return out
        # openai 兼容
        for v in (data.get("videos") or data.get("data") or []):
            if isinstance(v, dict) and v.get("url"):
                out.append({"url": v["url"], "type": "video/mp4"})
        url = data.get("url") or data.get("video_url") or ""
        if url and not out:
            out.append({"url": url, "type": "video/mp4"})
        return out
