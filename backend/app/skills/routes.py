from __future__ import annotations

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app import db
from app.skills import init_skills, skill_manager
from app.skills.loader import discover_dirs, load_skill_from_dir
from app.skills.permissions import enabled_risky, set_enabled_risky

router = APIRouter()


@router.get("")
async def list_skills():
    return {"skills": skill_manager.list(), "risky_enabled": sorted(enabled_risky())}


@router.get("/{skill_id}")
async def skill_detail(skill_id: str):
    entry = skill_manager.get(skill_id)
    if not entry:
        return JSONResponse(status_code=404, content={"error": "Skill 不存在"})
    return {"manifest": entry.manifest.to_dict(), "content_preview": entry.content[:500]}


@router.post("/reload")
async def reload_skills():
    await init_skills()
    return {"ok": True, "count": len(skill_manager._skills)}


@router.post("/execute")
async def execute_skill(request: Request):
    data = await request.json()
    skill_id = data.get("skill_id")
    if not skill_id:
        return JSONResponse(status_code=400, content={"error": "skill_id 必填"})
    res = await skill_manager.execute(skill_id, data.get("args") or {}, data.get("context", {}))
    return {"ok": res.ok, "result": res.result, "error": res.error}


@router.post("/risky")
async def set_risky(request: Request):
    data = await request.json() or {}
    set_enabled_risky(data.get("permissions", []))
    return {"ok": True, "enabled": sorted(enabled_risky())}
