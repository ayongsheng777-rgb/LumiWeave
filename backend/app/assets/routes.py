"""素材库 REST API（V2 Issue #009）。"""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse

from app.assets import service
from app.config import DATA_DIR
from app.services import video_service

router = APIRouter()

# 图片一等公民（V2.3）：本地上传图片，落盘 DATA_DIR/uploads/ 并入素材库
UPLOAD_DIR = DATA_DIR / "uploads"
ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20MB


@router.post("/upload")
async def upload_asset(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTS:
        return JSONResponse(status_code=400, content={"error": f"不支持的图片格式：{ext or '未知'}"})
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        return JSONResponse(status_code=400, content={"error": "图片超过 20MB 上限"})
    if not data:
        return JSONResponse(status_code=400, content={"error": "空文件"})

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex[:16]}{ext}"
    (UPLOAD_DIR / fname).write_bytes(data)

    url = f"/uploads/{fname}"
    aid = await service.add_asset(
        task_id="",
        asset_type="image",
        url=url,
        metadata={"source": "upload", "filename": file.filename or "", "size": len(data)},
        name=Path(file.filename or "").stem,
    )
    return {"id": aid, "url": url}


@router.post("/video/extract-frame")
async def extract_video_frame(request: Request):
    """视频抽帧（V2.3 尾帧->首帧接龙）：body {video_url, mode: first|last}"""
    data = await request.json()
    return await video_service.extract_frame(
        str(data.get("video_url", "")),
        str(data.get("mode", "last")),
    )


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
        name=str(data.get("name", "")),
    )
    return {"id": aid}


@router.patch("/{aid}")
async def rename_asset(aid: str, request: Request):
    data = await request.json()
    name = str(data.get("name", "")).strip()
    result = await service.rename_asset(aid, name)
    if result is None:
        return JSONResponse(status_code=404, content={"error": "素材不存在"})
    return result


@router.delete("/{aid}")
async def delete_asset(aid: str):
    ok = await service.delete_asset(aid)
    if not ok:
        return JSONResponse(status_code=404, content={"error": "素材不存在"})
    return {"ok": True}
