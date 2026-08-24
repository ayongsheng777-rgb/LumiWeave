from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app import db
from app.prompt_learning.embedder import embedder
from app.prompt_learning.source import sync_source
from app.prompt_learning.store import prompt_store

router = APIRouter()


@router.post("/sources")
async def add_source(request: Request):
    data = await request.json()
    kind = data.get("kind", "markdown")
    uri = data.get("uri", "")
    if not uri:
        return JSONResponse(status_code=400, content={"error": "uri 必填"})
    sid = await prompt_store.add_source(kind, uri, "syncing")
    n = await sync_source(sid, kind, uri)
    return {"ok": True, "source_id": sid, "blocks": n}


@router.post("/add")
async def add_manual(request: Request):
    data = await request.json()
    title = data.get("title", "manual")
    content = data.get("content", "")
    if not content:
        return JSONResponse(status_code=400, content={"error": "content 必填"})
    emb = await embedder.embed(content)
    kid = await prompt_store.add_knowledge("manual", title, content, emb)
    return {"ok": True, "id": kid}


@router.get("/list")
async def list_kb():
    return {"knowledge": await prompt_store.all(), "sources": await prompt_store.sources(),
            "count": await prompt_store.count()}


@router.get("/search")
async def search_kb(q: str = "", k: int = 5):
    if not q:
        return {"results": []}
    return {"results": await prompt_store.search(q, int(k))}


@router.post("/sync")
async def sync_all():
    rows = await db.fetch("SELECT id, kind, uri FROM prompt_sources WHERE status<>'syncing'")
    total = 0
    for r in rows:
        d = dict(r)
        total += await sync_source(d["id"], d["kind"], d["uri"])
    return {"ok": True, "synced_blocks": total}
