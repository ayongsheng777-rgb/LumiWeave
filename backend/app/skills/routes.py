from __future__ import annotations

import json
import re
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app import db
from app.skills import init_skills, skill_manager
from app.skills.loader import discover_dirs, load_skill_from_dir
from app.skills.manager import SkillEntry
from app.skills.manifest import SkillManifest
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


@router.post("")
async def upsert_skill(request: Request):
    """新增/编辑技能（写 skills 表 + 立即更新内存）。"""
    data = await request.json() or {}
    skill_id = str(data.get("id") or "").strip()
    if not skill_id:
        return JSONResponse(status_code=400, content={"error": "id 必填"})
    name = str(data.get("name") or skill_id)
    version = str(data.get("version") or "1.0.0")
    description = str(data.get("description") or "")
    runtime = str(data.get("runtime") or "prompt")
    entry = str(data.get("entry") or "SKILL.md")
    permissions = data.get("permissions") or []
    tags = data.get("tags") or []
    params = data.get("params") or []
    content = str(data.get("content") or "")
    source = str(data.get("source") or "builtin")
    await db.execute(
        """INSERT INTO skills (id, name, version, description, runtime, entry, permissions, tags, content, source, params)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             name=EXCLUDED.name, version=EXCLUDED.version, description=EXCLUDED.description,
             runtime=EXCLUDED.runtime, entry=EXCLUDED.entry, permissions=EXCLUDED.permissions,
             tags=EXCLUDED.tags, content=EXCLUDED.content, source=EXCLUDED.source,
             params=EXCLUDED.params, updated_at=NOW()""",
        skill_id, name, version, description, runtime, entry,
        json.dumps(permissions, ensure_ascii=False), json.dumps(tags, ensure_ascii=False),
        content, source, json.dumps(params, ensure_ascii=False),
    )
    manifest = SkillManifest.from_dict({
        "id": skill_id, "name": name, "version": version, "description": description,
        "runtime": runtime, "entry": entry, "permissions": permissions,
        "tags": tags, "source": source, "params": params,
    })
    skill_manager.register(SkillEntry(manifest=manifest, content=content))
    return {"ok": True, "id": skill_id}


@router.delete("/{skill_id}")
async def delete_skill(skill_id: str):
    await db.execute("DELETE FROM skills WHERE id=$1", skill_id)
    if skill_id in skill_manager._skills:
        del skill_manager._skills[skill_id]
    return {"ok": True}


def _slug_from_url(url: str) -> str:
    path = urlparse(url).path.rstrip("/")
    slug = path.split("/")[-1] if path else "imported-skill"
    slug = re.sub(r"[^a-zA-Z0-9_-]", "-", slug).strip("-")
    return slug or "imported-skill"


async def _fetch_url_text(url: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return ""
            text = resp.text
    except Exception:
        return ""
    low = text.lower()
    if "<html" in low or "<article" in low or "<body" in low:
        text = re.sub(r"<script.*?</script>", "", text, flags=re.S)
        text = re.sub(r"<style.*?</style>", "", text, flags=re.S)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"&[a-zA-Z#0-9]+;", " ", text)
        text = re.sub(r"\s+", " ", text)
    return text.strip()


@router.post("/import-from-url")
async def import_skill_from_url(request: Request):
    """从 URL 导入技能：抓取内容 → AI 识别生成配置（无 AI key 时启发式降级）。"""
    data = await request.json() or {}
    url = str(data.get("url") or "").strip()
    if not url:
        return JSONResponse(status_code=400, content={"error": "url 必填"})
    text = await _fetch_url_text(url)
    if not text:
        return JSONResponse(status_code=400, content={"error": "URL 抓取失败或内容为空"})
    text = text[:8000]

    from app.ai.client import chat_json
    cfg = await chat_json(
        system=(
            "你是技能配置助手。根据用户提供的网页/文档内容，提炼生成一个可用的技能(Skill)配置。"
            "输出严格 JSON，字段：id(英文短横线)、name(中文名)、description(中文描述)、"
            "content(技能正文/提示词规则，尽量完整保留原文要点)、tags(字符串数组)、"
            "params(参数数组，每项含 name/label/type/default/required)、runtime(固定 'prompt')。"
        ),
        user="网页内容：\n" + text,
        temperature=0.2,
        max_tokens=2048,
        scenario="skill",
    )
    ai_used = bool(cfg and isinstance(cfg, dict) and cfg.get("name"))
    if ai_used:
        skill_id = str(cfg.get("id") or "").strip() or _slug_from_url(url)
        name = str(cfg.get("name") or skill_id)
        description = str(cfg.get("description") or "")
        content = str(cfg.get("content") or text)
        tags = cfg.get("tags") or []
        params = cfg.get("params") or []
        runtime = str(cfg.get("runtime") or "prompt")
    else:
        skill_id = _slug_from_url(url)
        name = skill_id
        description = text[:100]
        content = text
        tags = ["imported"]
        params = []
        runtime = "prompt"

    await db.execute(
        """INSERT INTO skills (id, name, version, description, runtime, entry, permissions, tags, content, source, params)
           VALUES ($1,$2,'1.0.0',$3,$4,'SKILL.md','[]'::jsonb,$5::jsonb,$6,'external',$7::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             name=EXCLUDED.name, description=EXCLUDED.description, runtime=EXCLUDED.runtime,
             tags=EXCLUDED.tags, content=EXCLUDED.content, source=EXCLUDED.source,
             params=EXCLUDED.params, updated_at=NOW()""",
        skill_id, name, description, runtime,
        json.dumps(tags, ensure_ascii=False), content, json.dumps(params, ensure_ascii=False),
    )
    manifest = SkillManifest.from_dict({
        "id": skill_id, "name": name, "version": "1.0.0", "description": description,
        "runtime": runtime, "entry": "SKILL.md", "permissions": [], "tags": tags,
        "source": "external", "params": params,
    })
    skill_manager.register(SkillEntry(manifest=manifest, content=content))
    return {"ok": True, "id": skill_id, "name": name, "ai_used": ai_used}
