"""云端 Provider 生成（图片/视频），供节点按钮与 engine 的 render_mode='cloud' 路由。

从 providers 表读商业接口（如硅基流动 image/video），直接调用生成：
  - image：OpenAI 兼容 /images/generations（同步，返回图片 URL）
  - video：硅基流动 /video/submit → /video/status → /video/result（异步轮询）

所有函数返回结构化结果，并附带 `logs`（过程日志），供前端日志面板展示
「走哪个 provider / 哪个模型 / 提交→轮询→取结果每一步 / 耗时 / 报错详情」。
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any

import httpx

from app import db
from app.token_usage.db import fire_and_forget

# V2.9f 渲染计费估算（¥，仅统计展示；官方价调整后改这里）
RENDER_COST = {
    "h3_2k_per_sec": 1.25,      # MiniMax H3 2K 视频 ¥/秒（实测 4 秒约 5 元）
    "h3_768p_per_sec": 0.6,     # MiniMax H3 768P 视频 ¥/秒（估算）
    "image_per_pic": 0.2,       # 云端出图 ¥/张（估算）
}

_SIZE_MAP = {"16:9": "1280x720", "9:16": "720x1280", "1:1": "960x960",
             "4:3": "1024x768", "3:4": "768x1024"}


def _ts() -> int:
    return int(time.monotonic() * 1000)


async def _get_provider(provider_id: str) -> dict[str, Any] | None:
    row = await db.fetchrow("SELECT * FROM providers WHERE id=$1", provider_id)
    return dict(row) if row else None


def _model(p: dict[str, Any] | None, default: str) -> str:
    if not p:
        return default
    models = p.get("models") or []
    if isinstance(models, str):
        try:
            models = json.loads(models)
        except Exception:
            models = []
    return models[0] if models else default


def _headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


# V2.8.2：模型能力兜底校验——明显是纯文本 LLM 的模型不允许走生图/生视频，避免调用失败
_IMG_MODEL_RE = re.compile(r"image|flux|sdxl|sd3|dall|qwen-image|kolors|wanx|midjourney|stable|wuniu|photo", re.I)
_VID_MODEL_RE = re.compile(r"video|wan[\d.]*|kling|runway|pika|hunyuan|sora|minimax|h3|hailuo|可灵|即梦", re.I)


def _check_model_capability(model: str, kind: str) -> str:
    """返回 '' 表示通过；否则返回错误提示。kind: 'image' | 'video'"""
    if not model:
        return ""
    if kind == "image" and not _IMG_MODEL_RE.search(model):
        return (f"所选模型「{model}」不是图像生成模型（疑似文本 LLM），无法出图。"
                "请在「设置-模型」中为该平台配置图像模型（如 qwen-image），或选择默认模型（系统自动优选）")
    if kind == "video" and not _VID_MODEL_RE.search(model):
        return (f"所选模型「{model}」不是视频生成模型（疑似文本 LLM），无法生成视频。"
                "请在「设置-模型」中为该平台配置视频模型，或选择默认模型（系统自动优选）")
    return ""


async def cloud_image_generate(
    provider_id: str,
    prompt: str,
    *,
    negative: str = "",
    size: str = "1024x1024",
    steps: int = 20,
    model: str = "",
    reference_images: list[str] | None = None,
    native: dict[str, Any] | None = None,
    profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """云端出图（同步）。带 reference_images 时走图生图/多图参考合成（Qwen-Image-Edit）。
    native 为模型专属字段（如 image_size/guidance_scale），直接合并进请求体。
    profile 传「模型库」配置（base_url/api_key/model）时直连，不再查 providers 表。
    返回 {ok, images:[{url,filename}], logs, error}。"""
    logs: list[dict[str, Any]] = []
    p = await _get_provider(provider_id)  # profile 直连时可为 None，仅用于模型兜底
    if profile:
        endpoint = (str(profile.get("base_url") or "")).rstrip("/")
        key = profile.get("api_key") or ""
        prov_name = str(profile.get("name") or profile.get("provider") or provider_id)
        if not model:
            sm = profile.get("scene_models") or {}
            model = str((sm.get("image") if isinstance(sm, dict) else None) or profile.get("model") or "")
    else:
        if not p:
            return {"ok": False, "error": "云端 Provider 不存在", "logs": logs}
        endpoint = (p.get("endpoint") or "").rstrip("/")
        key = p.get("api_key") or ""
        prov_name = p.get("name") or provider_id
    if not endpoint or not key:
        return {"ok": False, "error": "云端 Provider 未配置 endpoint/api_key", "logs": logs}
    # V2.8.2 模型能力兜底：显式选了疑似文本 LLM 的模型 → 明确报错（前端已按能力过滤，此处双保险）
    if model:
        cap_err = _check_model_capability(model, "image")
        if cap_err:
            return {"ok": False, "error": cap_err, "logs": logs + [{"step": "model", "message": cap_err}]}
    refs = [r for r in (reference_images or []) if r and str(r).strip()]

    # 图生图（多图参考合成）：走 Qwen-Image-Edit-2509，image 为数组
    if refs:
        model_name = model or "Qwen/Qwen-Image-Edit-2509"
        logs.append({"step": "provider", "message": f"云端图生图（参考合成）· {prov_name}", "provider_id": provider_id, "endpoint": endpoint})
        logs.append({"step": "model", "message": f"模型：{model_name}", "model": model_name})
        logs.append({"step": "refs", "message": f"参考图 {len(refs)} 张", "count": len(refs)})
        payload: dict[str, Any] = {
            "model": model_name, "prompt": prompt,
            "image": refs if len(refs) > 1 else refs[0],
        }
        if negative:
            payload["negative_prompt"] = negative
        if steps:
            payload["num_inference_steps"] = steps
        logs.append({"step": "submit", "message": f"提交到 {endpoint}/images/generations（图生图）", "prompt": prompt[:200]})
    else:
        model_name = model or _model(p, "Qwen/Qwen-Image")
        logs.append({"step": "provider", "message": f"云端出图 · {prov_name}", "provider_id": provider_id, "endpoint": endpoint})
        logs.append({"step": "model", "message": f"模型：{model_name}", "model": model_name})
        payload = {
            "model": model_name, "prompt": prompt,
            "image_size": size, "batch_size": 1,
        }
        if steps:
            payload["num_inference_steps"] = steps
        if negative:
            payload["negative_prompt"] = negative
        logs.append({"step": "submit", "message": f"提交到 {endpoint}/images/generations", "prompt": prompt[:200]})

    # 模型专属字段（native）覆盖：前端按模型能力算好的字段，直接合并
    if native:
        payload.update(native)

    t0 = _ts()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=15.0)) as client:
            resp = await client.post(f"{endpoint}/images/generations", headers=_headers(key), json=payload)
    except httpx.TimeoutException:
        return {"ok": False, "error": "云端出图超时（>180s），请检查网络或换模型", "logs": logs + [{"step": "error", "message": "请求超时"}]}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"云端请求异常：{exc}", "logs": logs + [{"step": "error", "message": str(exc)}]}

    latency = _ts() - t0
    if resp.status_code != 200:
        body = (resp.text or "")[:300]
        logs.append({"step": "error", "message": f"HTTP {resp.status_code} · {body}"})
        return {"ok": False, "error": f"HTTP {resp.status_code}: {body}", "logs": logs}
    data = resp.json()
    images = data.get("images") or data.get("data") or []
    urls = [i.get("url") or i.get("image_url") or "" for i in images if isinstance(i, dict)]
    urls = [u for u in urls if u]
    if not urls:
        logs.append({"step": "error", "message": f"云端未返回图片链接：{str(data)[:200]}"})
        return {"ok": False, "error": f"云端未返回图片链接: {str(data)[:200]}", "logs": logs}
    logs.append({"step": "done", "message": f"生成 {len(urls)} 张图，耗时 {latency}ms", "duration_ms": latency})
    # V2.9f 渲染计费：出图按张估算记入统计（currency=CNY）
    fire_and_forget(
        model_name, prov_name or provider_id, "image_render", 0, 0, True,
        latency_ms=latency,
        cost=round(len(urls) * RENDER_COST["image_per_pic"], 2), currency="CNY",
    )
    return {"ok": True, "images": [{"url": u, "filename": u.rsplit('/', 1)[-1]} for u in urls], "logs": logs}


async def _minimax_h3_generate(
    endpoint: str,
    key: str,
    prov_name: str,
    prompt: str,
    image_url: str,
    duration: int,
    ratio: str,
    model: str,
    logs: list[dict[str, Any]],
) -> dict[str, Any]:
    """MiniMax H3 视频生成（V2.9d）：/v2/video_generation 异步任务 → 轮询 → 成片 URL。

    H3 是多模态视频模型（文生/图生/首尾帧/参考），content[] 结构：
      [{"type":"text","text":...}, {"type":"image_url","image_url":{"url":...},"role":"first_frame"}]
    接口：POST {base}/v2/video_generation → task_id；GET {base}/v2/query/video_generation/{task_id} 轮询。
    """
    base = (endpoint or "").rstrip("/")
    if base.endswith("/v1"):
        base = base[: -len("/v1")]
    headers = _headers(key)
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    if image_url:
        content.append({"type": "image_url", "image_url": {"url": image_url}, "role": "first_frame"})
    payload: dict[str, Any] = {
        "model": model,
        "content": content,
        "duration": max(4, min(15, int(duration or 5))),
        "resolution": "2K",
    }
    # 文生视频 ratio 必填且不能为 adaptive；图生视频由输入图决定（恒 adaptive）
    if not image_url:
        payload["ratio"] = ratio or "16:9"
    logs.append({"step": "provider", "message": f"MiniMax H3 视频 · {prov_name}（{model}）", "provider_id": "minimax", "endpoint": base})
    logs.append({"step": "submit", "message": f"提交到 {base}/v2/video_generation", "prompt": prompt[:200]})
    t0 = _ts()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
            resp = await client.post(f"{base}/v2/video_generation", headers=headers, json=payload)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"MiniMax H3 提交异常：{exc}", "logs": logs + [{"step": "error", "message": str(exc)}]}
    if resp.status_code not in (200, 201):
        body = (resp.text or "")[:300]
        logs.append({"step": "error", "message": f"HTTP {resp.status_code} · {body}"})
        return {"ok": False, "error": f"HTTP {resp.status_code}: {body}", "logs": logs}
    data = resp.json()
    task_id = str(data.get("task_id") or "")
    if not task_id:
        logs.append({"step": "error", "message": f"提交未返回 task_id: {str(data)[:200]}"})
        return {"ok": False, "error": f"提交未返回 task_id: {data}", "logs": logs}
    logs.append({"step": "submit", "message": f"任务已提交，task_id={task_id}", "task_id": task_id})

    # 轮询（H3 推荐 10s 间隔；总超时 900s）
    deadline = time.monotonic() + 900.0
    poll_count = 0
    video_url = ""
    while time.monotonic() < deadline:
        poll_count += 1
        await asyncio.sleep(10.0)
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
                st = await client.get(f"{base}/v2/query/video_generation/{task_id}", headers=headers)
        except Exception as exc:  # noqa: BLE001
            logs.append({"step": "poll", "message": f"第 {poll_count} 次查询异常：{exc}"})
            continue
        if st.status_code != 200:
            logs.append({"step": "poll", "message": f"第 {poll_count} 次查询 HTTP {st.status_code}"})
            continue
        task = st.json().get("task", {})
        status = str(task.get("status") or "")
        logs.append({"step": "poll", "message": f"第 {poll_count} 次查询：{status}"})
        if status == "succeeded":
            content = task.get("content")
            video_url = str(content.get("url") or "") if isinstance(content, dict) else ""
            break
        if status in ("failed", "cancelled", "expired"):
            return {"ok": False, "error": f"MiniMax H3 生成{status}: {task.get('error') or ''}", "logs": logs}
    if not video_url:
        return {"ok": False, "error": "等待 MiniMax H3 结果超时（>900s）", "logs": logs}
    logs.append({"step": "done", "message": f"视频生成完成，耗时 {_ts() - t0}ms", "duration_ms": _ts() - t0})
    # V2.9f 渲染计费：H3 无 token，按 时长×单价 估算记入统计（currency=CNY）
    price = RENDER_COST["h3_768p_per_sec"] if "768P" in (payload.get("resolution") or "") else RENDER_COST["h3_2k_per_sec"]
    fire_and_forget(
        model, "minimax", "video_render", 0, 0, True,
        latency_ms=_ts() - t0, task_id=task_id,
        cost=round(int(payload.get("duration") or 4) * price, 2), currency="CNY",
    )
    return {"ok": True, "videos": [{"url": video_url, "filename": video_url.rsplit("/", 1)[-1]}], "logs": logs}


async def cloud_video_generate(
    provider_id: str,
    prompt: str,
    *,
    image_url: str = "",
    duration: int = 6,
    ratio: str = "16:9",
    negative: str = "",
    model: str = "",
    native: dict[str, Any] | None = None,
    profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """云端文生视频（异步：提交→轮询→取结果）。
    native 为模型专属字段（如 height/camera_control/camera_movement），直接合并进请求体。
    profile 传「模型库」配置（base_url/api_key/model）时直连，不再查 providers 表。
    返回 {ok, videos, logs, error}。"""
    logs: list[dict[str, Any]] = []
    p = await _get_provider(provider_id)
    if profile:
        endpoint = (str(profile.get("base_url") or "")).rstrip("/")
        key = profile.get("api_key") or ""
        prov_name = str(profile.get("name") or profile.get("provider") or provider_id)
        if not model:
            sm = profile.get("scene_models") or {}
            model = str((sm.get("video") if isinstance(sm, dict) else None) or profile.get("model") or "")
    else:
        if not p:
            return {"ok": False, "error": "云端 Provider 不存在", "logs": logs}
        endpoint = (p.get("endpoint") or "").rstrip("/")
        key = p.get("api_key") or ""
        prov_name = p.get("name") or provider_id
    if not endpoint or not key:
        return {"ok": False, "error": "云端 Provider 未配置 endpoint/api_key", "logs": logs}
    # V2.8.2 模型能力兜底：显式选了疑似文本 LLM 的模型 → 明确报错
    if model:
        cap_err = _check_model_capability(model, "video")
        if cap_err:
            return {"ok": False, "error": cap_err, "logs": logs + [{"step": "model", "message": cap_err}]}
    # V2.9d：MiniMax H3 专用流程（/v2/video_generation 异步 + content[] 多模态结构）
    if "minimax" in (str(provider_id) + " " + endpoint).lower():
        return await _minimax_h3_generate(
            endpoint, key, prov_name, prompt, image_url, duration, ratio,
            model or "MiniMax-H3", logs,
        )
    # 图生视频（有首帧图）走 I2V 模型，否则走 T2V
    if image_url:
        model_name = model or "Wan-AI/Wan2.2-I2V-A14B"
        logs.append({"step": "provider", "message": f"云端图生视频 · {prov_name}", "provider_id": provider_id, "endpoint": endpoint})
    else:
        model_name = model or _model(p, "Wan-AI/Wan2.2-T2V-A14B")
        logs.append({"step": "provider", "message": f"云端视频 · {prov_name}", "provider_id": provider_id, "endpoint": endpoint})
    logs.append({"step": "model", "message": f"模型：{model_name}", "model": model_name})

    payload: dict[str, Any] = {
        "model": model_name, "prompt": prompt,
        "image_size": _SIZE_MAP.get(ratio, "1280x720"),
        "num_frames": max(1, int(duration)) * 16,
    }
    if negative:
        payload["negative_prompt"] = negative
    if image_url:
        payload["image_url"] = image_url
    if native:
        payload.update(native)
    h = _headers(key)

    t0 = _ts()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
            resp = await client.post(f"{endpoint}/video/submit", headers=h, json=payload)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"提交视频任务异常：{exc}", "logs": logs + [{"step": "error", "message": str(exc)}]}

    if resp.status_code not in (200, 201):
        body = (resp.text or "")[:300]
        logs.append({"step": "error", "message": f"HTTP {resp.status_code} · {body}"})
        return {"ok": False, "error": f"HTTP {resp.status_code}: {body}", "logs": logs}
    data = resp.json()
    task_id = data.get("taskId") or data.get("task_id") or data.get("id") or ""
    if not task_id:
        logs.append({"step": "error", "message": f"提交未返回任务ID: {str(data)[:200]}"})
        return {"ok": False, "error": f"提交未返回任务ID: {data}", "logs": logs}
    logs.append({"step": "submit", "message": f"任务已提交，taskId={task_id}", "task_id": task_id})

    # 轮询状态
    deadline = time.monotonic() + 300.0
    poll_count = 0
    while time.monotonic() < deadline:
        poll_count += 1
        await asyncio.sleep(5.0)
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
                st = await client.get(f"{endpoint}/video/status?taskId={task_id}", headers=h)
        except Exception as exc:  # noqa: BLE001
            logs.append({"step": "poll", "message": f"第 {poll_count} 次查询异常：{exc}"})
            continue
        if st.status_code == 200:
            sj = st.json()
            state = str(sj.get("status") or sj.get("state") or "")
            logs.append({"step": "poll", "message": f"第 {poll_count} 次查询：{state}"})
            if state.lower() in ("succeed", "success", "completed", "done"):
                break
            if state.lower() in ("failed", "error"):
                return {"ok": False, "error": f"视频生成失败: {state}", "logs": logs}
        else:
            logs.append({"step": "poll", "message": f"第 {poll_count} 次查询 HTTP {st.status_code}"})
    else:
        return {"ok": False, "error": "等待视频结果超时（>300s）", "logs": logs}

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
            rr = await client.get(f"{endpoint}/video/result?taskId={task_id}", headers=h)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"取结果异常：{exc}", "logs": logs + [{"step": "error", "message": str(exc)}]}
    if rr.status_code != 200:
        body = (rr.text or "")[:200]
        logs.append({"step": "error", "message": f"取结果失败 HTTP {rr.status_code} · {body}"})
        return {"ok": False, "error": f"取结果失败 HTTP {rr.status_code}", "logs": logs}
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
        logs.append({"step": "error", "message": f"结果里没有视频链接: {str(rdata)[:200]}"})
        return {"ok": False, "error": f"结果里没有视频链接: {str(rdata)[:200]}", "logs": logs}
    logs.append({"step": "done", "message": f"视频生成完成，耗时 {_ts() - t0}ms", "duration_ms": _ts() - t0})
    return {"ok": True, "videos": [{"url": u, "filename": u.rsplit('/', 1)[-1]} for u in videos], "logs": logs}
