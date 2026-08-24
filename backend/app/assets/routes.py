"""素材库 REST API（V2 Issue #009）。"""
from __future__ import annotations

from fastapi import APIRouter, Request

from app.assets import service

router = APIRouter()


@router.get("")
async def list_assets(request: Request):
    asset_type = request.query_params.get("type", "")
    limit = int(request.query_params.get("limit", 100))
    return {"assets": await service.list_assets(asset_type, limit)}


@router.post("")
async def add_asset(request: Request):
    data = await request.json()
    aid = await service.add_asset(
        task_id=str(data.get("task_id", "")),
        asset_type=str(data.get("type", "image")),
        url=str(data.get("url", "")),
        metadata=data.get("metadata") or {},
    )
    return {"id": aid}
