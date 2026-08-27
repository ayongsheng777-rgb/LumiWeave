"""视频抽帧服务（V2.3：尾帧 -> 首帧 接龙生成）。

cv2 懒加载：依赖未安装时返回友好错误，不影响主服务启动。
支持 http(s) 远程视频与本地路径；统一下载/读取后抽帧，落盘 uploads/。
"""
from __future__ import annotations

import tempfile
import uuid
from pathlib import Path
from typing import Any

import httpx

from app.config import DATA_DIR

UPLOAD_DIR = DATA_DIR / "uploads"  # 兼容默认；实际以配置 assets_dir 为准（见 _assets_dir）


async def _assets_dir():
    """素材保存目录：可配置（app_kv assets_dir），默认 DATA_DIR/uploads。"""
    from app import db
    row = await db.fetchrow("SELECT value FROM app_kv WHERE key=$1", "assets_dir")
    if row and row["value"]:
        return Path(str(row["value"]))
    return DATA_DIR / "uploads"


def _err(msg: str) -> dict[str, Any]:
    return {"ok": False, "error": msg}


async def extract_frame(video_url: str, mode: str = "last", time_seconds: float | None = None) -> dict[str, Any]:
    """抽取视频首帧/尾帧/指定时间点帧，保存为 JPG 并返回 /uploads/ URL。

    mode: first | last | current
    time_seconds: 指定时间点（秒）。仅 mode=current 时生效，优先于 first/last。
    """
    video_url = (video_url or "").strip()
    if not video_url:
        return _err("缺少视频地址")
    if mode not in ("first", "last", "current"):
        mode = "last"

    try:
        import cv2  # noqa: 懒加载，见模块注释
    except ImportError:
        return _err("服务端未安装 opencv-python-headless，无法抽帧")

    tmp_path = ""
    try:
        if video_url.startswith(("http://", "https://")):
            # 远程视频先落地临时文件（比 cv2 直连 http 更稳）
            async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
                resp = await client.get(video_url)
                resp.raise_for_status()
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp.write(resp.content)
                tmp_path = tmp.name
            src: str | int = tmp_path
        else:
            src = video_url
            if not Path(src).exists():
                return _err("本地视频文件不存在")

        cap = cv2.VideoCapture(src)
        if not cap.isOpened():
            return _err("无法读取视频")

        try:
            if mode == "current" and time_seconds is not None and time_seconds > 0:
                cap.set(cv2.CAP_PROP_POS_MSEC, time_seconds * 1000)
            elif mode == "last":
                total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                # 尾帧定位留少量余量，部分编码器最后几帧读不出
                cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, total - 2))
            ret, frame = cap.read()
            if not ret or frame is None:
                return _err("提取帧失败")
        finally:
            cap.release()

        adir = await _assets_dir()
        adir.mkdir(parents=True, exist_ok=True)
        tag = "cur" if mode == "current" else mode
        fname = f"frame_{tag}_{uuid.uuid4().hex[:12]}.jpg"
        ok = cv2.imwrite(str(adir / fname), frame)
        if not ok:
            return _err("保存截帧图片失败")
        return {"ok": True, "image_url": f"/uploads/{fname}", "mode": mode}
    except Exception as exc:  # noqa: BLE001
        return _err(f"抽帧异常：{exc}")
    finally:
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except OSError:
                pass
