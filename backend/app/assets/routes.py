"""素材库 REST API（V2 Issue #009）。"""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse

from app import db
from app.assets import service
from app.config import DATA_DIR
from app.services import video_service

router = APIRouter()

ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20MB


async def _assets_dir() -> Path:
    """素材保存目录：可配置（app_kv assets_dir），默认 DATA_DIR/uploads。"""
    row = await db.fetchrow("SELECT value FROM app_kv WHERE key=$1", "assets_dir")
    if row and row["value"]:
        return Path(str(row["value"]))
    return DATA_DIR / "uploads"


@router.get("/dir")
async def get_assets_dir():
    d = await _assets_dir()
    return {"dir": str(d), "exists": d.exists()}


@router.post("/dir")
async def set_assets_dir(request: Request):
    """设置素材保存目录（本地路径；也可配置后把旧目录文件迁移）。"""
    data = await request.json() or {}
    d = str(data.get("dir") or "").strip()
    if not d:
        return JSONResponse(status_code=400, content={"error": "目录不能为空"})
    p = Path(d)
    try:
        p.mkdir(parents=True, exist_ok=True)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=400, content={"error": f"无法创建目录：{exc}"})
    await db.execute(
        "INSERT INTO app_kv (key, value, updated_at) VALUES ('assets_dir', $1, NOW()) "
        "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()",
        d,
    )
    return {"ok": True, "dir": d}


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

    upload_dir = await _assets_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex[:16]}{ext}"
    (upload_dir / fname).write_bytes(data)

    url = f"/uploads/{fname}"
    aid = await service.add_asset(
        task_id="",
        asset_type="image",
        url=url,
        metadata={"source": "upload", "filename": file.filename or "", "size": len(data)},
        name=Path(file.filename or "").stem,
    )
    return {"id": aid, "url": url, "file_path": str(upload_dir / fname)}


@router.post("/video/extract-frame")
async def extract_video_frame(request: Request):
    """视频抽帧：body {video_url, mode: first|last|current, time_seconds?}"""
    data = await request.json()
    ts = data.get("time_seconds")
    return await video_service.extract_frame(
        str(data.get("video_url", "")),
        str(data.get("mode", "last")),
        float(ts) if ts is not None else None,
    )


@router.get("")
async def list_assets(request: Request):
    asset_type = request.query_params.get("type", "")
    limit = int(request.query_params.get("limit", 100))
    assets = await service.list_assets(asset_type, limit)
    adir = await _assets_dir()
    # 本地素材补磁盘路径（V2.8：素材面板显示保存路径）
    for a in assets:
        u = str(a.get("url") or "")
        if u.startswith("/uploads/"):
            a["file_path"] = str(adir / u[len("/uploads/"):])
        else:
            a["file_path"] = ""
    return {"assets": assets, "dir": str(adir)}


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
