from __future__ import annotations

import json

from app import db
from app.skills.loader import discover_dirs, load_skill_from_dir
from app.skills.manager import SkillEntry, SkillManager

def _parse_json_list(v) -> list:
    """asyncpg 的 jsonb 默认返回 str，这里统一转回 Python list。"""
    if v is None:
        return []
    if isinstance(v, list):
        return v
    try:
        parsed = json.loads(v)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


skill_manager = SkillManager()


async def init_skills() -> None:
    """扫描 builtin/external/learned 目录并同步到 skills 表，再从表加载到内存（DB 为权威源）。"""
    for d in discover_dirs():
        loaded = load_skill_from_dir(d)
        if not loaded:
            continue
        manifest, content = loaded
        source = d.parent.name if d.parent.name in ("builtin", "external", "learned") else "builtin"
        await db.execute(
            """INSERT INTO skills (id, name, version, description, runtime, entry, permissions, tags, content, source, params)
               VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb)
               ON CONFLICT (id) DO UPDATE SET
                 name=EXCLUDED.name, version=EXCLUDED.version, description=EXCLUDED.description,
                 runtime=EXCLUDED.runtime, entry=EXCLUDED.entry, permissions=EXCLUDED.permissions,
                 tags=EXCLUDED.tags, content=EXCLUDED.content, source=EXCLUDED.source, params=EXCLUDED.params""",
            manifest.id, manifest.name, manifest.version, manifest.description,
            manifest.runtime, manifest.entry, json.dumps(manifest.permissions),
            json.dumps(manifest.tags), content, source, json.dumps(manifest.params, ensure_ascii=False),
        )
    skill_manager._skills.clear()
    rows = await db.fetch("SELECT * FROM skills")
    for row in rows:
        d = dict(row)
        from app.skills.manifest import SkillManifest
        manifest = SkillManifest.from_dict({
            "id": d["id"], "name": d["name"], "version": d["version"],
            "description": d["description"], "runtime": d["runtime"],
            "entry": d["entry"], "permissions": _parse_json_list(d.get("permissions")),
            "tags": _parse_json_list(d.get("tags")), "source": d["source"],
            "params": _parse_json_list(d.get("params")),
        })
        skill_manager.register(SkillEntry(manifest=manifest, content=d.get("content", "")))
