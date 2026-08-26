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

UPLOAD_DIR = DATA_DIR / "uploads"


def _err(msg: str) -> dict[str, Any]:
    return {"ok": False, "error": msg}


async def extract_frame(video_url: str, mode: str = "last") -> dict[str, Any]:
    """抽取视频首帧/尾帧，保存为 JPG 并返回 /uploads/ URL。"""
    video_url = (video_url or "").strip()
    if not video_url:
        return _err("缺少视频地址")
    mode = "first" if mode == "first" else "last"

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
            if mode == "last":
                total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                # 尾帧定位留少量余量，部分编码器最后几帧读不出
                cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, total - 2))
            ret, frame = cap.read()
            if not ret or frame is None:
                return _err("提取帧失败")
        finally:
            cap.release()

        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        fname = f"frame_{mode}_{uuid.uuid4().hex[:12]}.jpg"
        ok = cv2.imwrite(str(UPLOAD_DIR / fname), frame)
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
