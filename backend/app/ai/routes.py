from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.ai import auto_best, client, config, persist, registry
from app import config as app_config
from app.config import CUSTOM_MODELS

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
        "description": p.get("description", ""),
        "scenario": p.get("scenario", "general"),
        "tags": p.get("tags") or registry.infer_tags(p.get("model", "")),
    }


@router.get("/profiles")
async def list_profiles():
    active_id = app_config.AI_OVERRIDES["active"] or config.settings.ai_active
    return {"profiles": [_serialize_profile(p) for p in config.model_profiles()], "active": active_id}


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


@router.post("/prompt-optimize")
async def ai_prompt_optimize(request: Request):
    """提示词优化：先检索知识库+技能库，命中则参考优化，无匹配再 AI 自行理解生成。"""
    data = await request.json() or {}
    prompt = str(data.get("prompt") or "")
    kind = str(data.get("kind") or "image")
    model = str(data.get("model") or "")
    if not prompt:
        return JSONResponse(status_code=400, content={"error": "prompt 必填"})
    from app.ai.prompt_optimizer import optimize_prompt
    return await optimize_prompt(prompt, kind=kind, model=model)


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
    active_id = app_config.AI_OVERRIDES["active"] or config.settings.ai_active
    return {
        "profiles": [_serialize_profile(p) for p in config.model_profiles()],
        "active": active_id,
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


# ==================== 模型库 CRUD（界面增删改 key / base_url） ====================


def _mask_models() -> list[dict[str, Any]]:
    """返回脱敏后的自定义模型列表（api_key 掩码）。"""
    out = []
    for m in CUSTOM_MODELS:
        d = dict(m)
        d["api_key"] = config.mask_key(d.get("api_key", ""))
        d["has_api_key"] = bool(m.get("api_key"))
        out.append(d)
    return out


async def _sync_pricing_after_model_change() -> None:
    """模型库变更后自动同步计费定价，保证新模型费用能正确计算。"""
    try:
        from app.token_usage import pricing
        models = [{"model": p.get("model", ""), "base_url": p.get("base_url", "")}
                  for p in config.model_profiles()]
        await pricing.sync_pricing(models)
    except Exception:
        pass


@router.get("/models")
async def list_models():
    return {"models": _mask_models()}


@router.post("/models")
async def upsert_model(request: Request):
    data = await request.json() or {}
    mid = str(data.get("id") or "").strip()
    if not mid:
        return JSONResponse(status_code=400, content={"error": "id 不能为空"})
    model_name = str(data.get("model") or "").strip()
    if not model_name:
        return JSONResponse(status_code=400, content={"error": "model 不能为空"})
    incoming_key = str(data.get("api_key") or "")
    # 前端回传掩码（**** 开头）说明用户没改 key，保留原值
    if incoming_key.startswith("****"):
        existing = next((m for m in CUSTOM_MODELS if m.get("id") == mid), None)
        incoming_key = (existing or {}).get("api_key", "")

    entry = {
        "id": mid,
        "name": str(data.get("name") or mid),
        "model": model_name,
        "base_url": str(data.get("base_url") or ""),
        "api_key": incoming_key,
        "proxy": str(data.get("proxy") or ""),
        "user_agent": str(data.get("user_agent") or ""),
        "description": str(data.get("description") or ""),
        "scenario": str(data.get("scenario") or "general"),
    }
    hit = next((m for m in CUSTOM_MODELS if m.get("id") == mid), None)
    if hit:
        hit.update(entry)
    else:
        CUSTOM_MODELS.append(entry)
    await persist.save_custom_models()
    await _sync_pricing_after_model_change()
    return {"ok": True, "models": _mask_models()}


@router.delete("/models/{model_id}")
async def delete_model(model_id: str):
    before = len(CUSTOM_MODELS)
    # 原地切片赋值（不能重新绑定，否则跨模块引用失效）
    CUSTOM_MODELS[:] = [m for m in CUSTOM_MODELS if m.get("id") != model_id]
    if len(CUSTOM_MODELS) == before:
        return JSONResponse(status_code=404, content={"error": "模型不存在"})
    await persist.save_custom_models()
    await _sync_pricing_after_model_change()
    return {"ok": True, "models": _mask_models()}


@router.get("/models-list")
async def list_platform_models(profile_id: str = ""):
    """从指定模型（默认 active）的平台 API 拉取可用模型列表。"""
    profile = config.get_profile(profile_id or None)
    if not profile:
        return JSONResponse(status_code=404, content={"error": "模型配置不存在"})
    key = (profile.get("api_key") or "").strip()
    if not key or config._is_placeholder(key):
        return JSONResponse(status_code=400, content={"error": "该模型未配置有效 API Key"})
    from app.ai.auto_best import _list_models
    models = await _list_models(profile)
    return {"profile_id": profile.get("id"), "count": len(models), "models": models}
