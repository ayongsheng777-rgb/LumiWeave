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


async def auto_best(profile_id: str | None = None, scene: str | None = None) -> dict[str, Any]:
    """自动优选。scene 传入时：在「适用场景」勾选该场景（或未设场景=通用）的模型配置中，
    逐个测连通选最佳，返回 {ok, model, provider_id, scene} 供按场景一键优选。"""
    profiles = model_profiles()
    if scene:
        # 按场景过滤：勾选了该场景，或未设场景（通用）
        scene_profiles = []
        for p in profiles:
            scenes = p.get("scenes") or []
            if not scenes or "general" in scenes or scene in scenes:
                scene_profiles.append(p)
        if not scene_profiles:
            return {"ok": False, "reason": f"没有勾选「{scene}」场景的模型配置", "tested": []}
        # 逐个配置：测连通性（用配置里第一个/默认模型），挑可用且延迟最低的
        best_p, best_lat = None, float("inf")
        tested = []
        sem = asyncio.Semaphore(2)
        for p in scene_profiles:
            key = (p.get("api_key") or "").strip()
            if not key or _is_placeholder(key):
                continue
            try:
                r = await _test_one(p, p.get("model") or "", sem)
            except Exception:  # noqa: BLE001
                r = {"success": False, "model": p.get("model", ""), "error": "异常"}
            tested.append({"provider_id": p.get("id"), "provider": p.get("provider", ""),
                           "model": p.get("model", ""), "success": bool(r and r.get("success")),
                           "latency_ms": (r or {}).get("latency_ms", 0)})
            if r and r.get("success") and (r.get("latency_ms") or 0) < best_lat:
                best_p, best_lat = p, r.get("latency_ms") or 0
        if not best_p:
            return {"ok": False, "reason": f"「{scene}」场景候选模型全部实测失败，请检查 API Key/额度", "tested": tested}
        return {
            "ok": True,
            "model": best_p.get("model", ""),
            "provider_id": best_p.get("id", ""),
            "provider": best_p.get("provider", ""),
            "scene": scene,
            "latency_ms": best_lat,
            "tested": tested,
        }

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
