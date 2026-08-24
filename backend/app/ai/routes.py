from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.ai import auto_best, client, config, persist, registry
from app import config as app_config

router = APIRouter()


def _serialize_profile(p: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": p.get("id"),
        "name": p.get("name", ""),
        "model": p.get("model", ""),
        "base_url": p.get("base_url", ""),
        "api_key": config.mask_key(p.get("api_key", "")),
        "proxy": p.get("proxy", ""),
        "user_agent": p.get("user_agent", ""),
        "provider": p.get("provider", ""),
        "tags": p.get("tags") or registry.infer_tags(p.get("model", "")),
    }


@router.get("/profiles")
async def list_profiles():
    return {"profiles": [_serialize_profile(p) for p in config.model_profiles()], "active": config.settings.ai_active}


@router.post("/chat")
async def ai_chat(request: Request):
    data = await request.json()
    system = data.get("system", "")
    user = data.get("user", "")
    profile_id = data.get("profile_id")
    json_mode = data.get("json_mode", False)
    scenario = data.get("scenario", "general")
    profile = config.get_profile(profile_id)
    if json_mode:
        result = await client.chat_json(system, user, model_profile=profile, scenario=scenario)
    else:
        result = await client.chat(system, user, model_profile=profile, scenario=scenario)
    if result is None:
        return JSONResponse(status_code=503, content={"error": client.stats.get("last_error") or "AI 调用失败"})
    return {"result": result}


@router.get("/stats")
async def ai_stats():
    return dict(client.stats)


@router.post("/probe")
async def ai_probe(request: Request):
    data = await request.json() or {}
    result = await client.probe(data.get("profile_id"))
    return result


@router.post("/auto-best")
async def ai_auto_best(request: Request):
    data = await request.json() or {}
    profile_id = data.get("profile_id")
    result = await auto_best.auto_best(profile_id)
    if not result["ok"]:
        return JSONResponse(status_code=503, content=result)
    # 步骤④：把胜出模型写回配置并持久化（guide 04 §8.1）
    target_id = profile_id or config.settings.ai_active
    app_config.AI_OVERRIDES["models"][target_id] = result["model"]
    await persist.save_overrides()
    return {**result, "applied_to": target_id, "applied": True}


@router.post("/recommend")
async def ai_recommend(request: Request):
    data = await request.json() or {}
    scenario = data.get("scenario", "general")
    recommendations = registry.recommend(config.model_profiles(), scenario)
    return {"scenario": scenario, "recommendations": recommendations}


@router.get("/config")
async def ai_config_get():
    return {
        "profiles": [_serialize_profile(p) for p in config.model_profiles()],
        "active": config.settings.ai_active,
        "overrides": {
            "active": app_config.AI_OVERRIDES["active"],
            "models": app_config.AI_OVERRIDES["models"],
        },
    }


@router.post("/config")
async def ai_config_save(request: Request):
    data = await request.json() or {}
    active = data.get("active")
    models = data.get("models") or {}
    if active is not None:
        app_config.AI_OVERRIDES["active"] = active
    if isinstance(models, dict):
        for pid, model in models.items():
            if pid and model:
                app_config.AI_OVERRIDES["models"][pid] = model
    await persist.save_overrides()
    return {
        "ok": True,
        "profiles": [_serialize_profile(p) for p in config.model_profiles()],
        "active": config.settings.ai_active,
    }
