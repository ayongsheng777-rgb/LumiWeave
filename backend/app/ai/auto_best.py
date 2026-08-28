from __future__ import annotations

import asyncio
from typing import Any

import httpx

from app.ai.client import _is_placeholder, chat
from app.ai.config import model_profiles

TIER_ORDER = {
    "deepseek-reasoner": 1,
    "deepseek-v4-pro": 1,
    "deepseek-v3.1-terminus": 1,
    "qwen3-235b-a22b": 1,
    "qwen3.8-max": 1,
    "kimi-k3": 1,
    "gpt-4o": 1,
    "claude-3-5-sonnet": 1,
    "deepseek-chat": 2,
    "deepseek-v3.1": 2,
    "qwen3.7-max": 2,
    "qwen3.7-plus": 2,
    "kimi": 2,
    "qwen3.7-flash": 3,
    "deepseek-v4-flash": 3,
    "llama-3.1-8b": 3,
    "mistral-7b": 3,
    "phi-3-mini": 3,
}


def _tier_of(model_id: str) -> int:
    mid = model_id.lower()
    for prefix, tier in sorted(TIER_ORDER.items(), key=lambda x: -len(x[0])):
        if prefix in mid:
            return tier
    return 9


async def _list_models(profile: dict[str, Any]) -> list[str]:
    base_url = profile.get("base_url", "").rstrip("/")
    key = (profile.get("api_key") or "").strip()
    if not base_url or not key:
        return []
    url = f"{base_url}/models"
    headers = {"Authorization": f"Bearer {key}"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=10.0)) as client:
            response = await client.get(url, headers=headers)
            if response.status_code != 200:
                return []
            data = response.json()
            models = data.get("data", data) if isinstance(data, dict) else data
            return [m.get("id", m.get("model", "")) for m in models if isinstance(m, dict)]
    except Exception:
        return []


async def _test_one(profile: dict[str, Any], model_id: str, sem: asyncio.Semaphore) -> dict[str, Any]:
    async with sem:
        test_profile = {**profile, "model": model_id}
        t0 = asyncio.get_event_loop().time()
        reply = await chat(
            system="你只回复两个字：正常",
            user="Reply with OK",
            model_profile=test_profile,
            max_tokens=10,
            cache_ttl=0,
            scenario="auto_best",
        )
        latency_ms = int((asyncio.get_event_loop().time() - t0) * 1000)
        if reply is None:
            from app.ai.client import stats
            return {
                "model": model_id,
                "success": False,
                "latency_ms": latency_ms,
                "error": stats.get("last_error") or "未知错误",
            }
        return {"model": model_id, "success": True, "latency_ms": latency_ms, "error": ""}


async def auto_best(profile_id: str | None = None) -> dict[str, Any]:
    profiles = model_profiles()
    profile = None
    if profile_id:
        profile = next((p for p in profiles if p.get("id") == profile_id), None)
    if not profile:
        profile = profiles[0] if profiles else None
    if not profile:
        return {"ok": False, "reason": "没有可用模型配置", "tested": []}

    key = (profile.get("api_key") or "").strip()
    if not key or _is_placeholder(key):
        return {"ok": False, "reason": "API Key 无效", "tested": []}

    available_models = await _list_models(profile)
    candidates = []
    for m in available_models:
        tier = _tier_of(m)
        candidates.append({"model": m, "tier": tier})

    if not candidates:
        for m in available_models[:5]:
            candidates.append({"model": m, "tier": 9})

    if not candidates:
        return {"ok": False, "reason": "无法获取模型列表", "tested": []}

    candidates.sort(key=lambda x: (x["tier"], x["model"]))
    # 限制候选数量，避免全量测试过慢（按 tier 排序后只测高质量的前若干）
    candidates = candidates[:15]
    sem = asyncio.Semaphore(4)
    tasks = [_test_one(profile, c["model"], sem) for c in candidates]
    tested = await asyncio.gather(*tasks)

    ok_list = [r for r in tested if r["success"]]
    if not ok_list:
        return {
            "ok": False,
            "reason": "候选模型全部实测失败，请检查 API Key 额度或网络",
            "tested": tested,
        }

    ok_list.sort(key=lambda x: (x["latency_ms"], _tier_of(x["model"])))
    best = ok_list[0]

    return {
        "ok": True,
        "model": best["model"],
        "latency_ms": best["latency_ms"],
        "provider": profile.get("provider", ""),
        "tested": tested,
    }


# 场景 → 模型名关键词（V2.8 按场景优选：image 只优选生图模型、video 只优选视频模型，避免选出无关 LLM）
_SCENE_KEYWORDS: dict[str, list[str]] = {
    "image": ["image", "flux", "stable-diffusion", "stable_diffusion", "sd3", "sdxl", "qwen-image", "wanx", "dall-e", "dall-e", "kolors", "illustrious", "playground", "t2i", "sd-"],
    "text2image": ["t2i", "text-to-image", "text2image", "image", "flux", "sdxl", "sd3", "qwen-image", "wanx", "dall-e", "kolors"],
    "image2image": ["image2image", "i2i", "img2img", "image-edit", "image_edit", "edit", "qwen-image-edit", "inpaint", "control"],
    "video": ["video", "wan", "wanx", "hailuo", "kling", "minimax-video", "runway", "ltx", "cogvideo", "veo", "doubao-video", "t2v", "sora"],
    "audio": ["audio", "tts", "music", "voice", "sing", "speech", "cosyvoice", "minimax-audio", "spark-tts", "gpt-4o-audio"],
    "prompt": ["deepseek", "qwen", "glm", "gpt", "kimi", "moonshot", "gemini", "grok", "hunyuan", "ernie", "doubao", "minimax-text", "llama", "mistral"],
    "kb": ["deepseek", "qwen", "glm", "gpt", "kimi", "gemini", "grok", "hunyuan", "doubao", "llama", "embedding", "bge"],
    "skills": ["deepseek", "qwen", "glm", "gpt", "kimi", "gemini", "grok", "hunyuan", "doubao", "llama"],
    "video_understand": ["video-llm", "video understanding", "video-understanding", "qwen2.5-vl", "qwen-vl", "gemini", "gpt-4o", "internvl", "vl"],
    "image_understand": ["vl", "vision", "qwen-vl", "qwen2.5-vl", "gpt-4o", "gemini", "glm-4v", "internvl", "image-understanding", "image understanding"],
}


async def auto_best_scene(profile_id: str, scene: str) -> dict[str, Any]:
    """单模型配置内按场景一键优选（V2.8）：拉该平台模型列表 → 按场景匹配候选 → 实测连通 → 返回最佳模型名。

    实测方式（保证可用，列表拉出来不一定能用）：
      - prompt/kb/skills（文本）：chat 实测（不花钱）
      - image：极简 128x128 出图实测（极小额度，HTTP 200 即可用）
      - video：/video/submit 提交实测（创建任务即认为可用，不轮询）
    候选按「场景关键词」优先匹配（image 场景只优选生图模型，video 只优选视频模型，避免选出无关 LLM），
    无匹配时才兜底全测平台列表前 8 个。已手动填过 scene_models[scene] 的模型优先验证。
    """
    profiles = model_profiles()
    profile = next((p for p in profiles if p.get("id") == profile_id), None)
    if not profile:
        return {"ok": False, "reason": "模型配置不存在", "tested": []}
    key = (profile.get("api_key") or "").strip()
    if not key or _is_placeholder(key):
        return {"ok": False, "reason": "API Key 无效", "tested": []}
    available_models = await _list_models(profile)
    if not available_models:
        return {"ok": False, "reason": "无法获取模型列表（检查 Base URL / API Key 与平台兼容性）", "tested": []}
    # 候选 = 已设过的模型(优先验证) + 场景关键词匹配（无匹配兜底平台前 8），去重保序
    # V2.9d：排除非本场景的无关模型（tts/stt/embedding/rerank/voice 等），避免误混入
    EXCLUDE_KW = ("tts", "stt", "embedding", "rerank", "voice", "speech", "audio", "music", "sing")
    sm = profile.get("scene_models") or {}
    preset = str(sm.get(scene) or "") if isinstance(sm, dict) else ""
    kws = _SCENE_KEYWORDS.get(scene, [])
    matched = [
        m for m in available_models
        if kws and any(kw in m.lower() for kw in kws)
        and not any(x in m.lower() for x in EXCLUDE_KW)
    ]
    candidates = [m for m in dict.fromkeys([preset] + (matched[:8] if matched else available_models[:8])) if m]

    tested: list[dict[str, Any]] = []
    for m in candidates:
        r = await _test_scene_model(profile, m, scene)
        tested.append({"model": m, "tier": _tier_of(m), **r})
    # 实测通过 → 按等级降序（1 级最高在前）+ 同级延迟升序；不锁定单一模型，返回全列表供下拉选择
    ok_list = [t for t in tested if t["success"]]
    ok_list.sort(key=lambda x: (x["tier"], x["latency_ms"]))
    if not ok_list:
        return {"ok": False, "reason": f"「{scene}」场景候选模型全部实测失败，请检查 API Key / 额度 / 模型权限", "tested": tested}
    return {
        "ok": True,
        "scene": scene,
        "models": [{"model": t["model"], "tier": t["tier"], "latency_ms": t["latency_ms"]} for t in ok_list],
        "model": ok_list[0]["model"],  # 兼容旧字段：默认推荐等级最高的
        "latency_ms": ok_list[0]["latency_ms"],
        "tested": tested,
    }


async def _test_scene_model(profile: dict[str, Any], model: str, scene: str) -> dict[str, Any]:
    """按场景实测单模型连通性。返回 {success, latency_ms, error}。"""
    t0 = asyncio.get_event_loop().time()
    base_url = str(profile.get("base_url") or "").rstrip("/")
    key = (profile.get("api_key") or "").strip()
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    # 文本类 / 多模态理解类（视频解析理解、图片理解）：chat 实测（与全局优选同款，不额外花钱）
    if scene in ("prompt", "kb", "skills", "chat", "general", "copywriting", "video_understand", "image_understand"):
        # 文本类：chat 实测（与全局优选同款，不额外花钱）
        r = await _test_one(profile, model, asyncio.Semaphore(1))
        return {"success": bool(r.get("success")), "latency_ms": int(r.get("latency_ms") or 0),
                "error": str(r.get("error") or "")[:160]}
    # 文生图 / 图生图：走图像实测
    if scene in ("image", "text2image", "image2image"):
        mid = model.lower()
        # 图生图/编辑类模型：必须传 image 参数，文生图实测无意义 → 直接标记可用（scene_models 显式配置才进候选）
        if "edit" in mid:
            return {"success": True, "latency_ms": 0, "error": ""}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(40.0, connect=10.0)) as c:
                # V2.9d：尺寸 128x128 → 512x512（多数图像模型要求宽高 ≥256，128 会误判失败）
                resp = await c.post(f"{base_url}/images/generations", headers=headers,
                                    json={"model": model, "prompt": "test", "image_size": "512x512", "batch_size": 1})
            ok = resp.status_code == 200
            return {"success": ok, "latency_ms": int((asyncio.get_event_loop().time() - t0) * 1000),
                    "error": "" if ok else f"HTTP {resp.status_code}: {resp.text[:140]}"}
        except Exception as exc:  # noqa: BLE001
            return {"success": False, "latency_ms": 0, "error": str(exc)[:140]}
    if scene == "video":
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(40.0, connect=10.0)) as c:
                resp = await c.post(f"{base_url}/video/submit", headers=headers,
                                    json={"model": model, "prompt": "test", "image_size": "1280x720", "num_frames": 16})
            ok = resp.status_code == 200
            return {"success": ok, "latency_ms": int((asyncio.get_event_loop().time() - t0) * 1000),
                    "error": "" if ok else f"HTTP {resp.status_code}: {resp.text[:140]}"}
        except Exception as exc:  # noqa: BLE001
            return {"success": False, "latency_ms": 0, "error": str(exc)[:140]}
    return {"success": False, "latency_ms": 0, "error": "不支持的场景"}
