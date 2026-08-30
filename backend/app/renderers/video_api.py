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

import base64
import os
import time
import uuid
from typing import Any, Optional

import httpx

from app.renderers.registry import BaseRenderer, RendererConfig


def _mime_of(url: str) -> str:
    """按 URL/文件扩展名推断图片 MIME（默认 png）。"""
    low = url.lower().split("?")[0]
    if ".jpg" in low or ".jpeg" in low:
        return "image/jpeg"
    if ".webp" in low:
        return "image/webp"
    return "image/png"


async def _to_data_uri(url: str, data_dir: str | None = None) -> str:
    """把图片 URL 转成 base64 data URI，供 MiniMax H3 直接内联（绕开公网 URL 约束）。

    处理三类输入：
      - data: 开头 → 原样返回
      - http(s):// → 下载后内联（临时链接过期/内网不可达都能规避，本地兜底最稳）
      - 相对路径（/uploads/...）→ 读本地文件内联
    转换失败返回原 URL（让上层按原样重试，不阻断）。
    """
    url = str(url or "").strip()
    if not url:
        return url
    if url.startswith("data:"):
        return url
    raw: bytes | None = None
    try:
        if url.startswith("http://") or url.startswith("https://"):
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    raw = resp.content
        elif data_dir and url.startswith("/"):
            p = os.path.join(data_dir, url.lstrip("/"))
            if os.path.exists(p):
                with open(p, "rb") as f:
                    raw = f.read()
    except Exception:  # noqa: BLE001
        raw = None
    if not raw:
        return url
    # MiniMax 单图上限 20MB；超限不内联（回退原 URL，避免请求体过大）
    if len(raw) > 20 * 1024 * 1024:
        return url
    return f"data:{_mime_of(url)};base64,{base64.b64encode(raw).decode()}"


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
        return ["text_to_video", "image_to_video", "start_end_to_video", "reference_to_video"]

    # ---- submit ----
    async def submit(self, workflow: dict[str, Any], *, task_id: str) -> dict[str, Any]:
        p = self._params(workflow)
        path, payload = self._build_submit(p)
        if not path:
            return {"ok": False, "error": f"未支持的视频服务商: {self.provider}"}
        # MiniMax：参考图/首帧图转 base64 内联（绕开公网 URL 约束 + 临时链接过期）
        if self.provider in ("minimax", "minimax_h3") and isinstance(payload.get("content"), list):
            from app.config import DATA_DIR
            for item in payload["content"]:
                if not isinstance(item, dict) or item.get("type") != "image_url":
                    continue
                iu = item.get("image_url")
                if isinstance(iu, dict) and iu.get("url"):
                    iu["url"] = await _to_data_uri(str(iu["url"]), str(DATA_DIR))
        # 模型专属字段（native：camera_control/camera_movement/height 等）直接合并
        native = p.get("native")
        if isinstance(native, dict):
            payload.update(native)
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
            out: dict[str, Any] = {"status": state, "remote_task_id": remote_task_id}
            if self.provider in ("minimax", "minimax_h3") and state == "failed":
                err = self._task_of(resp.json()).get("error")
                if err:
                    out["error"] = str(err)
            return out
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
                return {"ok": False, "videos": [], "images": [],
                        "error": f"视频生成失败{('：' + st['error']) if st.get('error') else ''}"}
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
            # MiniMax-H3 V2 多模态协议：content[] 结构 + role 标注用途
            #   text / image_url(first_frame|last_frame|reference_image) / video_url(reference_video)
            # 异步：POST 返回 task_id，GET /v2/query/video_generation/{task_id} 轮询
            resolution = str(p.get("resolution") or "2K")
            # MiniMax H3 仅接受 768P / 2K 两档，其余统一映射（≤720→768P，>720→2K）
            from app.providers.cloud_gen import normalize_h3_resolution
            resolution = normalize_h3_resolution(resolution)
            last_frame = str(p.get("last_frame_url") or p.get("last_frame") or "")
            content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]

            if image_url:
                # 首帧生视频（i2va）：宽高比由输入图决定，不传 ratio
                content.append({"type": "image_url", "image_url": {"url": image_url}, "role": "first_frame"})
                if last_frame:
                    # 首尾帧模式
                    content.append({"type": "image_url", "image_url": {"url": last_frame}, "role": "last_frame"})
            else:
                # 多参考生视频（r2va）：角色图/场景图/道具图全部作为 reference_image
                for u in reference_images:
                    content.append({"type": "image_url", "image_url": {"url": u}, "role": "reference_image"})

            payload: dict[str, Any] = {
                "model": model or "MiniMax-H3",
                "content": content,
                "duration": duration,
                "resolution": resolution,
            }
            # t2va 场景 ratio 必填且不能为 adaptive；有输入图时由图片决定，省略
            if not image_url:
                payload["ratio"] = ratio if ratio and ratio != "adaptive" else "16:9"
            return "/v2/video_generation", payload

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
            # V2：路径参数形式
            return f"/v2/query/video_generation/{rid}"
        if self.provider == "kling":
            return f"/v1/videos/text2video/{rid}"
        if self.provider == "siliconflow":
            return f"/v1/video/status?taskId={rid}"
        return f"/v1/video/generations/{rid}"

    def _result_path(self, rid: str) -> str:
        return self._status_path(rid)

    @staticmethod
    def _task_of(data: dict[str, Any]) -> dict[str, Any]:
        """MiniMax V2 响应形如 {"task": {...}}；兼容旧平铺结构。"""
        t = data.get("task")
        return t if isinstance(t, dict) else data

    def _parse_status(self, data: dict[str, Any]) -> str:
        if self.provider in ("minimax", "minimax_h3"):
            st = str(self._task_of(data).get("status", "")).lower()
            if st in ("succeeded", "success", "successed", "completed", "complete"):
                return "completed"
            if st in ("failed", "fail", "cancelled", "canceled", "error"):
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
            # V2：task.content.url 即成片下载地址（无需再换 file_id）
            task = self._task_of(data)
            content = task.get("content") or {}
            url = ""
            if isinstance(content, dict):
                url = str(content.get("url") or "")
            # 兼容旧结构
            url = url or str(task.get("file") or task.get("video_url") or data.get("file") or data.get("video_url") or "")
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
