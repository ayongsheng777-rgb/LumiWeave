"""画布对象 REST API（V2 Issue #002）。"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.canvas import service

router = APIRouter()


@router.post("/object")
async def create_object(request: Request):
    data = await request.json()
    obj_type = str(data.get("type", "text"))
    if obj_type not in service.OBJECT_TYPES:
        return JSONResponse(status_code=400, content={"error": f"不支持的对象类型: {obj_type}"})
    oid = await service.create_object(
        project_id=str(data.get("project_id", "")),
        obj_type=obj_type,
        content=data.get("content") or {},
        position=data.get("position") or {},
        size=data.get("size") or {},
        layer=int(data.get("layer", 0)),
        metadata=data.get("metadata") or {},
    )
    return {"id": oid}


@router.post("/object/batch")
async def batch_create(request: Request):
    data = await request.json()
    objects = data.get("objects")
    if not isinstance(objects, list):
        return JSONResponse(status_code=400, content={"error": "objects 必须是数组"})
    ids = await service.batch_create(objects, str(data.get("project_id", "")))
    return {"ids": ids}


@router.get("/{project_id}")
async def list_objects(project_id: str):
    objects = await service.list_objects(project_id)
    return {"objects": objects}


@router.put("/object/{oid}")
async def update_object(oid: str, request: Request):
    data = await request.json()
    obj = await service.update_object(oid, **data)
    if not obj:
        return JSONResponse(status_code=404, content={"error": "对象不存在"})
    return obj


@router.delete("/object/{oid}")
async def delete_object(oid: str):
    await service.delete_object(oid)
    return {"ok": True}
