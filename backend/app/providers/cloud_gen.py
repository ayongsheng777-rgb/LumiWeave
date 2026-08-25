"""云端 Provider 生成（图片/视频），供 engine 的 render_mode='cloud' 路由。

从 providers 表读商业接口（如硅基流动 image/video），直接调用生成：
  - image：OpenAI 兼容 /images/generations（同步）
  - video：硅基流动 /video/submit → /video/status → /video/result（异步轮询）
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx

from app import db

_SIZE_MAP = {"16:9": "1280x720", "9:16": "720x1280", "1:1": "960x960",
             "4:3": "1024x768", "3:4": "768x1024"}


async def _get_provider(provider_id: str) -> dict[str, Any] | None:
    row = await db.fetchrow("SELECT * FROM providers WHERE id=$1", provider_id)
    return dict(row) if row else None


def _model(p: dict[str, Any], default: str) -> str:
    models = p.get("models") or []
    if isinstance(models, str):
        try:
            models = json.loads(models)
        except Exception:
            models = []
    return models[0] if models else default


def _headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


async def cloud_image_generate(
    provider_id: str,
    prompt: str,
    *,
    negative: str = "",
    size: str = "1024x1024",
    steps: int = 20,
) -> dict[str, Any]:
    p = await _get_provider(provider_id)
    if not p:
        return {"ok": False, "error": "云端 Provider 不存在"}
    endpoint = (p.get("endpoint") or "").rstrip("/")
    key = p.get("api_key") or ""
    if not endpoint or not key:
        return {"ok": False, "error": "云端 Provider 未配置 endpoint/api_key"}
    model = _model(p, "Qwen/Qwen-Image")
    payload: dict[str, Any] = {
        "model": model, "prompt": prompt,
        "image_size": size, "num_inference_steps": steps,
    }
    if negative:
        payload["negative_prompt"] = negative
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=15.0)) as client:
            resp = await client.post(f"{endpoint}/images/generations", headers=_headers(key), json=payload)
        if resp.status_code != 200:
            return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
        data = resp.json()
        images = data.get("images") or data.get("data") or []
        urls = [i.get("url") or i.get("image_url") or "" for i in images if isinstance(i, dict)]
        urls = [u for u in urls if u]
        if not urls:
            return {"ok": False, "error": f"云端未返回图片链接: {str(data)[:200]}"}
        return {"ok": True, "images": [{"url": u, "filename": u.rsplit('/', 1)[-1]} for u in urls]}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


async def cloud_video_generate(
    provider_id: str,
    prompt: str,
    *,
    image_url: str = "",
    duration: int = 6,
    ratio: str = "16:9",
    negative: str = "",
) -> dict[str, Any]:
    p = await _get_provider(provider_id)
    if not p:
        return {"ok": False, "error": "云端 Provider 不存在"}
    endpoint = (p.get("endpoint") or "").rstrip("/")
    key = p.get("api_key") or ""
    if not endpoint or not key:
        return {"ok": False, "error": "云端 Provider 未配置 endpoint/api_key"}
    model = _model(p, "Wan-AI/Wan2.2-T2V-A14B")
    payload: dict[str, Any] = {
        "model": model, "prompt": prompt,
        "image_size": _SIZE_MAP.get(ratio, "1280x720"),
        "num_frames": max(1, int(duration)) * 16,
    }
    if negative:
        payload["negative_prompt"] = negative
    if image_url:
        payload["image_url"] = image_url
    h = _headers(key)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
            resp = await client.post(f"{endpoint}/video/submit", headers=h, json=payload)
        if resp.status_code not in (200, 201):
            return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
        data = resp.json()
        task_id = data.get("taskId") or data.get("task_id") or data.get("id") or ""
        if not task_id:
            return {"ok": False, "error": f"提交未返回任务ID: {data}"}

        deadline = time.monotonic() + 300.0
        while time.monotonic() < deadline:
            await asyncio.sleep(5.0)
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
                st = await client.get(f"{endpoint}/video/status?taskId={task_id}", headers=h)
            if st.status_code == 200:
                sj = st.json()
                state = str(sj.get("status") or sj.get("state") or "")
                if state.lower() in ("succeed", "success", "completed", "done"):
                    break
                if state.lower() in ("failed", "error"):
                    return {"ok": False, "error": f"视频生成失败: {state}"}

        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
            rr = await client.get(f"{endpoint}/video/result?taskId={task_id}", headers=h)
        if rr.status_code != 200:
            return {"ok": False, "error": f"取结果失败 HTTP {rr.status_code}"}
        rdata = rr.json()
        videos: list[str] = []
        v = rdata.get("video") or rdata.get("videos") or rdata.get("data") or {}
        if isinstance(v, list):
            videos = [x.get("url") or x.get("video_url") or "" for x in v if isinstance(x, dict)]
        elif isinstance(v, dict):
            u = v.get("url") or v.get("video_url") or ""
            if u:
                videos = [u]
        elif isinstance(v, str) and v.startswith("http"):
            videos = [v]
        videos = [x for x in videos if x]
        if not videos:
            return {"ok": False, "error": f"结果里没有视频链接: {str(rdata)[:200]}"}
        return {"ok": True, "videos": [{"url": u, "filename": u.rsplit('/', 1)[-1]} for u in videos]}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
