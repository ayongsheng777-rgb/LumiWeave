from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app import db
from app.ai import config as ai_config
from app.token_usage import pricing

router = APIRouter()


@router.get("/summary")
async def token_summary(days: int = 30):
    return {"days": days, "data": await pricing.summary(days)}


@router.get("/by-scenario")
async def token_by_scenario(days: int = 30):
    return {"days": days, "data": await pricing.by_scenario(days)}


@router.get("/today")
async def token_today():
    return await pricing.today_overview()


@router.get("/pricing")
async def token_pricing():
    models = [{"model": p.get("model", ""), "base_url": p.get("base_url", "")} for p in ai_config.model_profiles()]
    sync_result = await pricing.sync_pricing(models)
    rows = await pricing.fetch_pricing()
    return {"sync": sync_result, "pricing": rows}


@router.post("/pricing/sync")
async def token_pricing_sync(request: Request):
    models = [{"model": p.get("model", ""), "base_url": p.get("base_url", "")} for p in ai_config.model_profiles()]
    result = await pricing.sync_pricing(models)
    return result


@router.post("/pricing")
async def token_pricing_upsert(request: Request):
    data = await request.json()
    input_per = Decimal(data.get("input_price_yuan", 0)) / Decimal(data.get("input_tokens_million", 1))
    output_per = Decimal(data.get("output_price_yuan", 0)) / Decimal(data.get("output_tokens_million", 1))
    item = {
        "model": data.get("model", ""),
        "provider": data.get("provider", ""),
        "input_per_million": input_per,
        "output_per_million": output_per,
        "source": "manual",
        "note": data.get("note", ""),
    }
    await pricing.upsert_pricing(item)
    return {"ok": True}


@router.post("/pricing/refresh-official")
async def token_refresh_official():
    return await pricing.refresh_official_pricing()


@router.delete("/pricing/{pricing_id}")
async def token_delete_pricing(pricing_id: int):
    ok = await pricing.delete_pricing(pricing_id)
    if not ok:
        return JSONResponse(status_code=400, content={"error": "官方价不可删除或记录不存在"})
    return {"ok": True}


@router.get("/project-usage")
async def project_usage(days: int = 30):
    """项目用量（V2）：聚合 AI 调用 / 图片 / 视频 / 任务 / Token / 成本。"""
    ai = await db.fetchrow(
        """SELECT COUNT(*) AS calls,
                  COALESCE(SUM(CASE WHEN success THEN 0 ELSE 1 END),0) AS fails,
                  COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
                  COALESCE(SUM(completion_tokens),0) AS completion_tokens
           FROM token_usage_log WHERE ts >= now() - make_interval(days => $1)""",
        days,
    )
    media = await db.fetchrow(
        """SELECT
             COALESCE(SUM(CASE WHEN type='image' THEN 1 ELSE 0 END),0) AS images,
             COALESCE(SUM(CASE WHEN type='video' THEN 1 ELSE 0 END),0) AS videos
           FROM assets WHERE created_at >= now() - make_interval(days => $1)""",
        days,
    )
    tasks_row = await db.fetchrow(
        """SELECT COUNT(*) AS tasks, COALESCE(SUM(cost),0) AS task_cost
           FROM tasks WHERE created_at >= now() - make_interval(days => $1)""",
        days,
    )
    token_cost = Decimal("0")
    for r in await pricing.summary(days):
        token_cost += Decimal(str(r.get("cost_yuan") or 0))

    return {
        "days": days,
        "ai_calls": int((ai["calls"] if ai else 0) or 0),
        "ai_fails": int((ai["fails"] if ai else 0) or 0),
        "prompt_tokens": int((ai["prompt_tokens"] if ai else 0) or 0),
        "completion_tokens": int((ai["completion_tokens"] if ai else 0) or 0),
        "images": int((media["images"] if media else 0) or 0),
        "videos": int((media["videos"] if media else 0) or 0),
        "tasks": int((tasks_row["tasks"] if tasks_row else 0) or 0),
        "cost_yuan": str(
            token_cost + Decimal(str((tasks_row["task_cost"] if tasks_row else 0) or 0))
        ),
    }
