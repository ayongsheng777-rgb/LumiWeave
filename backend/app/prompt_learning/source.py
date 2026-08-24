from __future__ import annotations

from pathlib import Path

import httpx

from app import db
from app.prompt_learning.embedder import embedder
from app.prompt_learning.extractor import extract_prompt_blocks
from app.prompt_learning.store import prompt_store


async def fetch_text(uri: str) -> str:
    if uri.startswith("http://") or uri.startswith("https://"):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True) as client:
                resp = await client.get(uri)
                return resp.text if resp.status_code == 200 else ""
        except Exception:
            return ""
    p = Path(uri)
    if p.exists():
        return p.read_text(encoding="utf-8", errors="ignore")
    return ""


async def fetch_github(repo: str) -> str:
    for branch in ("main", "master"):
        text = await fetch_text(f"https://raw.githubusercontent.com/{repo}/{branch}/README.md")
        if text:
            return text
    return ""


async def sync_source(sid: str, kind: str, uri: str) -> int:
    text = await fetch_github(uri) if kind == "github" else await fetch_text(uri)
    blocks = extract_prompt_blocks(text)
    n = 0
    for b in blocks:
        emb = await embedder.embed(b["content"])
        await prompt_store.add_knowledge(sid, b["title"], b["content"], emb)
        n += 1
    await db.execute("UPDATE prompt_sources SET status='synced', last_sync=NOW() WHERE id=$1", sid)
    return n
