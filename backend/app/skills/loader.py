from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from app.skills.manifest import SkillManifest

APP_DIR = Path(__file__).resolve().parent.parent  # .../app
# skills/ 与 app/ 同级（backend 根下），故为 app 目录再上一级
SKILLS_ROOT = Path(os.environ.get("SKILLS_DIR", str(APP_DIR.parent / "skills")))


def discover_dirs() -> list[Path]:
    roots = [SKILLS_ROOT / "builtin", SKILLS_ROOT / "external", SKILLS_ROOT / "learned"]
    out: list[Path] = []
    for r in roots:
        if r.is_dir():
            for d in r.iterdir():
                if d.is_dir():
                    out.append(d)
    return out


def load_skill_from_dir(d: Path) -> Optional[tuple[SkillManifest, str]]:
    mfile = d / "manifest.json"
    if not mfile.exists():
        return None
    try:
        manifest = SkillManifest.from_dict(json.loads(mfile.read_text(encoding="utf-8")))
    except Exception:
        return None
    entry = d / (manifest.entry or "SKILL.md")
    content = entry.read_text(encoding="utf-8") if entry.exists() else ""
    return manifest, content
