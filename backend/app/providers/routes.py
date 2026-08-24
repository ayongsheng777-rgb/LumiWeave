"""Provider REST API（V2 Issue #006）。"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.providers import service

router = APIRouter()


@router.get("")
async def list_providers():
    return {"providers": await service.list_providers()}


@router.post("")
async def upsert_provider(request: Request):
    data = await request.json()
    result = await service.upsert_provider(data)
    if "error" in result:
        return JSONResponse(status_code=400, content=result)
    return result


@router.delete("/{pid}")
async def delete_provider(pid: str):
    await service.delete_provider(pid)
    return {"ok": True}


@router.post("/route")
async def route_provider(request: Request):
    data = await request.json()
    chain = await service.route(
        str(data.get("task_type", "llm")),
        quality=float(data.get("quality", 1.0)),
        speed=float(data.get("speed", 1.0)),
        cost=float(data.get("cost", 1.0)),
        limit=int(data.get("limit", 3)),
    )
    return {"providers": chain}
