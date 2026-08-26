"""影视拉片拆镜管线（规格书 §14/§15/§68）。

纯 ffmpeg/ffprobe 实现，不依赖外部服务；视觉分析走 AI 多模态 best-effort，
失败自动降级（仍产出带正确时码的镜头卡）。
"""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any

from app.config import DATA_DIR
from app.scene import service

UPLOAD_DIR = DATA_DIR / "uploads"
FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"


# ─────────────────────────────────────────────────────────────────────────────
# 工具
# ─────────────────────────────────────────────────────────────────────────────

def _run(cmd: list[str]) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except Exception:  # noqa: BLE001
        return None


def _resolve_video(video_url: str) -> str:
    """把 video_url（http(s) 或 /uploads/...）解析为本地文件路径。"""
    if video_url.startswith("http://") or video_url.startswith("https://"):
        import urllib.request
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        dst = UPLOAD_DIR / f"src_{uuid.uuid4().hex[:12]}.mp4"
        try:
            urllib.request.urlretrieve(video_url, dst)  # noqa: S310
            return str(dst)
        except Exception:  # noqa: BLE001
            return ""
    if video_url.startswith("/uploads/"):
        return str(DATA_DIR / "uploads" / video_url[len("/uploads/"):])
    return video_url


def _ffprobe(path: str) -> dict:
    r = _run([FFPROBE, "-v", "quiet", "-print_format", "json",
              "-show_format", "-show_streams", path])
    if not r or r.returncode != 0:
        return {}
    try:
        data = json.loads(r.stdout)
    except Exception:  # noqa: BLE001
        return {}
    fmt = data.get("format", {})
    dur = float(fmt.get("duration", 0) or 0)
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    w = int(v.get("width", 0) or 0)
    h = int(v.get("height", 0) or 0)
    fr = str(v.get("avg_frame_rate", "0/1"))
    try:
        a, b = fr.split("/")
        fps = float(a) / float(b) if float(b) else 0.0
    except Exception:  # noqa: BLE001
        fps = 0.0
    return {"duration": dur, "width": w, "height": h, "fps": round(fps, 3),
            "codec": v.get("codec_name", "")}


def _detect_shots(path: str, duration: float) -> list[tuple[float, float]]:
    """返回 [(start, end), ...] 镜头区间。优先 ffmpeg 场景切换检测，失败则等间隔分段。"""
    r = _run([FFMPEG, "-i", path, "-vf", "select='gt(scene,0.3)',showinfo",
              "-vsync", "vfr", "-f", "null", "-"])
    cuts = [0.0]
    if r and r.stderr:
        for line in r.stderr.splitlines():
            if "showinfo" in line and "pts_time:" in line:
                try:
                    t = float(line.split("pts_time:")[1].split()[0])
                    cuts.append(t)
                except Exception:  # noqa: BLE001
                    pass
    cuts = sorted({round(c, 3) for c in cuts})
    if len(cuts) <= 1:
        # 无镜头切换 → 等间隔分段（最多 12 段）
        interval = max(4.0, duration / 12.0)
        cuts = [round(i * interval, 3) for i in range(int(duration // interval) + 1)]
        if cuts and cuts[-1] < duration - 0.5:
            cuts.append(round(duration, 3))
    boundaries = []
    for i, s in enumerate(cuts):
        end = cuts[i + 1] if i + 1 < len(cuts) else duration
        boundaries.append((s, min(end, duration)))
    return boundaries


def _extract_frame(path: str, t: float, out_path: str) -> bool:
    r = _run([FFMPEG, "-y", "-ss", str(t), "-i", path, "-frames:v", "1",
              "-q:v", "2", out_path])
    return bool(r and r.returncode == 0 and Path(out_path).exists())


async def _vision_analyze(frame_url: str, ctx: str) -> dict:
    """best-effort 视觉分析：把帧链接放进提示词交给多模态模型，失败返回空。"""
    try:
        from app.ai.client import chat
        prompt = (
            "你是影视拉片分析师。请看这张镜头关键帧，严格只输出 JSON："
            '{"shot_size":"景别(如特写/近景/中景/全景/远景)","camera_motion":"镜头运动(如固定/推/拉/摇/移/跟)",'
            '"composition":"构图(如居中/三分法/对称)","lighting":"光线(如自然光/硬光/逆光)","color":"色调(如冷调/暖调/高对比)",'
            '"character":"画面人物或主体","emotion":"情绪(如紧张/温馨/孤独)","action":"画面动作"}。'
            f"只输出 JSON，不要解释。上下文：{ctx}"
        )
        text = await chat(prompt + f"\n图片地址：{frame_url}", "", temperature=0.3,
                          max_tokens=600, scenario="film_analysis")
        m = re.search(r"\{.*\}", text or "", re.S)
        if m:
            return json.loads(m.group(0))
    except Exception:  # noqa: BLE001
        pass
    return {}


# ─────────────────────────────────────────────────────────────────────────────
# 主流程
# ─────────────────────────────────────────────────────────────────────────────

async def run_film_analysis(scene_id: str, video_url: str) -> dict:
    path = _resolve_video(video_url)
    if not path or not Path(path).exists():
        return {"ok": False, "error": "视频文件不可访问（请先上传视频）"}
    meta = _ffprobe(path)
    duration = float(meta.get("duration") or 0)
    if duration <= 0:
        return {"ok": False, "error": "无法解析视频元数据（容器内可能未安装 ffmpeg/ffprobe）"}

    boundaries = _detect_shots(path, duration)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # 视频源对象
    await service.create_object(scene_id, "video", x=0, y=-320, width=320, height=220,
                                data={"url": video_url, "duration": round(duration, 2),
                                      "model": "", "prompt": ""})

    shots_created: list[str] = []
    frames_created: list[str] = []
    for i, (s, e) in enumerate(boundaries):
        mid = (s + e) / 2.0
        fname = f"film_{uuid.uuid4().hex[:12]}.jpg"
        fpath = UPLOAD_DIR / fname
        frame_url = ""
        if _extract_frame(path, mid, str(fpath)):
            frame_url = f"/uploads/{fname}"
        analysis = {}
        if frame_url:
            from app.film.vision import vision_analyze
            analysis = await vision_analyze(frame_url, f"镜头{i + 1}")
        shot_data = {
            "shot_no": i + 1,
            "start": round(s, 2), "end": round(e, 2), "duration": round(e - s, 2),
            "shot_size": analysis.get("shot_size", ""),
            "camera_motion": analysis.get("camera_motion", ""),
            "composition": analysis.get("composition", ""),
            "lighting": analysis.get("lighting", ""),
            "color": analysis.get("color", ""),
            "character": analysis.get("character", ""),
            "emotion": analysis.get("emotion", ""),
            "action": analysis.get("action", ""),
            "frame_url": frame_url,
        }
        # 视觉分析汇总成可读文本（§68 深度：AI 文字分析）
        if analysis:
            shot_data["analysis"] = "、".join(f"{k}：{v}" for k, v in analysis.items() if v)
        sid = await service.create_object(
            scene_id, "shot",
            x=(i % 4) * 340, y=(i // 4) * 320, width=300, height=240, data=shot_data,
        )
        shots_created.append(sid)
        if frame_url:
            fid = await service.create_object(
                scene_id, "frame",
                x=(i % 4) * 340 + 20, y=(i // 4) * 320 + 260, width=260, height=180,
                data={"url": frame_url, "shot_id": sid},
            )
            frames_created.append(fid)
            await service.add_asset_for_scene(scene_id, "image", frame_url,
                                             name=f"镜头{i + 1}关键帧", metadata={"shot_id": sid})

    return {
        "ok": bool(shots_created),
        "shots": len(shots_created),
        "frames": len(frames_created),
        "metadata": meta,
        "message": f"拆出 {len(shots_created)} 个镜头 / {len(frames_created)} 帧",
    }
