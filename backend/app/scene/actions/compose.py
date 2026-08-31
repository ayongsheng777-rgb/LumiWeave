"""§69 成片合成管道（升级版，V2.9r）

骨架：
  1. 收集视频对象（按连线顺序）
  2. 收集字幕轨（从 storyboard 自动算时间戳）
  3. 收集音频轨（占位：来自 audio 节点的 url；TTS 接入后由 provider 填）
  4. ffmpeg concat 视频 → 烧字幕 → 混合音频 → 输出成片

TTS 接入点（等阿勇拍板 Provider 后实现）：
  - 当前 audio 节点的 url 字段承载配音/音乐（手工上传或外部服务已生成）
  - 若 url 为空且节点标记 voiceover=True/BGM，尝试调 _tts_provider 兜底
  - 详见 compose_with_tts 占位函数
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import uuid
from pathlib import Path
from typing import Any

from app.scene import service

from app.scene.actions.shared import (
    _register_asset,
)


# ─────────────────────────────────────────────────────────────────────────────
# 字幕时间轴对齐（§69 字幕骨架）
# ─────────────────────────────────────────────────────────────────────────────

def align_subtitles_from_storyboards(
    storyboards: list[dict[str, Any]],
    *,
    default_duration: float = 5.0,
    chars_per_second: float = 6.0,
) -> list[dict[str, Any]]:
    """从分镜列表算 SRT 风格字幕时间轴。

    规则：
      - 每个分镜时长优先读 shot['duration']，兜底 default_duration
      - 单条字幕 = 单个分镜 dialogue，按 chars_per_second 估算显示时长（截断 1~分镜时长）
      - 字幕项: {"start": 秒, "end": 秒, "text": "..."}
    返回按时间排序的列表。
    """
    timeline: list[dict[str, Any]] = []
    cursor = 0.0
    for s in storyboards:
        d = float(s.get("duration") or default_duration)
        dialogue = str(s.get("dialogue") or "").strip()
        if dialogue:
            speak_dur = min(d, max(1.0, len(dialogue) / max(1.0, chars_per_second)))
            timeline.append({"start": round(cursor, 2), "end": round(cursor + speak_dur, 2), "text": dialogue})
        cursor += d
    return timeline


def subtitles_to_srt(subs: list[dict[str, Any]]) -> str:
    """把对齐后的字幕列表转成标准 SRT 文本（ffmpeg subtitles= 兼容）。"""
    out = []
    for i, sub in enumerate(subs, 1):
        sh = int(sub["start"] // 3600)
        sm = int((sub["start"] % 3600) // 60)
        ss = int(sub["start"] % 60)
        sms = int((sub["start"] - int(sub["start"])) * 1000)
        eh = int(sub["end"] // 3600)
        em = int((sub["end"] % 3600) // 60)
        es = int(sub["end"] % 60)
        ems = int((sub["end"] - int(sub["end"])) * 1000)
        out.append(
            f"{i}\n"
            f"{sh:02d}:{sm:02d}:{ss:02d},{sms:03d} --> "
            f"{eh:02d}:{em:02d}:{es:02d},{ems:03d}\n"
            f"{sub['text']}\n"
        )
    return "\n".join(out)


def build_subtitle_file(subs: list[dict[str, Any]], data_dir: Path, *, scene_id: str) -> Path:
    """写 SRT 到 data_dir/uploads/{scene}_subs_{hash}.srt，返回路径。"""
    up = data_dir / "uploads"
    up.mkdir(parents=True, exist_ok=True)
    p = up / f"subs_{scene_id[-12:]}_{uuid.uuid4().hex[:8]}.srt"
    p.write_text(subtitles_to_srt(subs), encoding="utf-8")
    return p


# ─────────────────────────────────────────────────────────────────────────────
# TTS Provider 抽象（§69 Provider 拍板后填充）
# ─────────────────────────────────────────────────────────────────────────────

class TTSProvider:
    """TTS 提供商抽象基类。

    必须实现 text_to_audio(text, voice_id) 返回 .mp3/.wav 文件路径或 URL。
    若失败返回 None。
    """

    name: str = "base"

    async def text_to_audio(self, text: str, voice_id: str = "default") -> str | None:
        raise NotImplementedError


class StubTTSProvider(TTSProvider):
    """无 Provider 时的兜底：直接落占位空音频（保留时间轴），仅供联调。

    Provider 拍板后用真实实现替换此 Stub。
    """
    name = "stub"

    async def text_to_audio(self, text: str, voice_id: str = "default") -> str | None:
        # 用 ffmpeg 生成一段 1 秒静音（占位），文件名带 stub 标识便于排查
        from app.config import DATA_DIR
        up = DATA_DIR / "uploads" / "tts_stub"
        up.mkdir(parents=True, exist_ok=True)
        out = up / f"stub_{uuid.uuid4().hex[:12]}.wav"
        r = subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
             "-t", "1", str(out)],
            capture_output=True, text=True, timeout=30,
        )
        if r.returncode != 0 or not out.exists() or out.stat().st_size < 100:
            return None
        return str(out)


# ─────────────────────────────────────────────────────────────────────────────
# §69 TTS Provider 实现（主选火山 / 备选硅基）
# 配置（环境变量或 .env）：
#   VOLCANO_APPID / VOLCANO_ACCESS_TOKEN / VOLCANO_CLUSTER（默认 volcano_tts）
#   SILICONFLOW_API_KEY（与 LLM 共用 key）
# ─────────────────────────────────────────────────────────────────────────────


class VolcanoTTSProvider(TTSProvider):
    """火山引擎 TTS（字节跳动 · 主选）
    - 文档：https://www.volcengine.com/docs/6561/79817
    - 端点：https://openspeech.bytedance.com/api/v1/tts
    - 鉴权：Authorization: Bearer; {token} + X-APP-ID: {appid}
    - 免费：每月 30 万字符（适合测试 + 轻度生产）
    """
    name = "volcano"

    def __init__(self) -> None:
        import os
        self.appid = os.environ.get("VOLCANO_APPID", "").strip()
        self.token = os.environ.get("VOLCANO_ACCESS_TOKEN", "").strip()
        self.cluster = os.environ.get("VOLCANO_CLUSTER", "volcano_tts").strip()
        self.endpoint = "https://openspeech.bytedance.com/api/v1/tts"

    def is_configured(self) -> bool:
        return bool(self.appid and self.token)

    async def text_to_audio(self, text: str, voice_id: str = "BV001_streaming") -> str | None:
        if not self.is_configured():
            return None
        if not text or not text.strip():
            return None
        import base64
        import httpx

        # voice_id 默认 BV001_streaming（女声·普通话）；其它常用：BV002_streaming（男声）、BV005_streaming（儿童）
        payload = {
            "app": {"appid": self.appid, "token": "ignored", "cluster": self.cluster},
            "user": {"uid": "lumiweave"},
            "audio": {
                "voice_type": voice_id or "BV001_streaming",
                "encoding": "mp3",
                "speed_ratio": 1.0,
                "volume_ratio": 1.0,
                "pitch_ratio": 1.0,
            },
            "request": {
                "reqid": uuid.uuid4().hex,
                "text": text[:1000],  # 火山单次限制
                "text_type": "plain",
                "operation": "query",
                "with_frontend": 1,
                "frontend_type": "unitTson",
            },
        }
        headers = {
            "Authorization": f"Bearer; {self.token}",
            "X-APP-ID": self.appid,
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as c:
                r = await c.post(self.endpoint, json=payload, headers=headers)
        except Exception:  # noqa: BLE001
            return None
        if r.status_code != 200:
            return None
        try:
            data = r.json()
        except Exception:  # noqa: BLE001
            return None
        # 火山成功响应：{"code": 0, "message": "Success", "data": "<base64 audio>"}
        if str(data.get("code", "")) not in ("0", "10000", 0, 10000):
            return None
        audio_b64 = data.get("data")
        if not audio_b64:
            return None
        try:
            audio_bytes = base64.b64decode(audio_b64)
        except Exception:  # noqa: BLE001
            return None
        if len(audio_bytes) < 100:
            return None
        from app.config import DATA_DIR
        up = DATA_DIR / "uploads" / "tts_volcano"
        up.mkdir(parents=True, exist_ok=True)
        out = up / f"volcano_{uuid.uuid4().hex[:12]}.mp3"
        out.write_bytes(audio_bytes)
        return str(out)


class SiliconFlowTTSProvider(TTSProvider):
    """硅基流动 TTS（OpenAI 兼容 · 备选）
    - 文档：https://docs.siliconflow.cn/cn/api-reference/audio/create-speech
    - 端点：https://api.siliconflow.cn/v1/audio/speech
    - 鉴权：Authorization: Bearer {api_key}
    - 免费层：每月额度（与 LLM 共池）
    """
    name = "siliconflow"

    def __init__(self) -> None:
        import os
        # 与项目 LLM 共用 key（用户已有）
        self.api_key = os.environ.get("SILICONFLOW_API_KEY", "").strip()
        if not self.api_key:
            # 退到 AI_API_KEY（兼容旧配置）
            self.api_key = os.environ.get("AI_API_KEY", "").strip()
        self.endpoint = "https://api.siliconflow.cn/v1/audio/speech"
        self.model = os.environ.get("SILICONFLOW_TTS_MODEL", "FunAudioLLM/CosyVoice2-0.5B").strip()

    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def text_to_audio(self, text: str, voice_id: str = "FunAudioLLM/CosyVoice2-0.5B:alex") -> str | None:
        if not self.is_configured():
            return None
        if not text or not text.strip():
            return None
        import httpx

        # OpenAI Speech 兼容格式
        payload = {
            "model": self.model,
            "input": text[:2000],
            "voice": voice_id or "FunAudioLLM/CosyVoice2-0.5B:alex",
            "response_format": "mp3",
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as c:
                r = await c.post(self.endpoint, json=payload, headers=headers)
        except Exception:  # noqa: BLE001
            return None
        if r.status_code != 200 or len(r.content) < 100:
            return None
        from app.config import DATA_DIR
        up = DATA_DIR / "uploads" / "tts_siliconflow"
        up.mkdir(parents=True, exist_ok=True)
        out = up / f"silicon_{uuid.uuid4().hex[:12]}.mp3"
        out.write_bytes(r.content)
        return str(out)


_TTS_PROVIDERS: dict[str, TTSProvider] = {}


def register_tts_provider(name: str, provider: TTSProvider) -> None:
    _TTS_PROVIDERS[name] = provider


def get_tts_provider(name: str = "stub") -> TTSProvider | None:
    return _TTS_PROVIDERS.get(name)


# 默认注册 Stub（Provider 拍板后用真实实现注册同名覆盖即可）
register_tts_provider("stub", StubTTSProvider())
# §69 默认 Provider：主选火山 + 备选硅基（未配置 key 时 is_configured()=False 自动跳过）
register_tts_provider("volcano", VolcanoTTSProvider())
register_tts_provider("siliconflow", SiliconFlowTTSProvider())


async def synthesize_voiceover(text: str, voice_id: str = "default", *, provider: str = "auto") -> str | None:
    """对外 TTS 入口。

    provider="auto"（默认）：
      主选 volcano（火山，免费 30 万字/月） → 失败自动试 siliconflow（硅基，备选）→ 都失败 → stub 静音占位
    provider="stub"/"volcano"/"siliconflow"：走指定 provider；未配置时返回 None
    """
    if provider == "auto":
        chain = ["volcano", "siliconflow"]
        for name in chain:
            p = get_tts_provider(name)
            if p and getattr(p, "is_configured", lambda: True)():
                result = await p.text_to_audio(text, voice_id)
                if result:
                    return result
        # 主备都失败或未配置 → 落静音占位（不让用户卡死）
        p = get_tts_provider("stub")
        return await p.text_to_audio(text, voice_id) if p else None
    p = get_tts_provider(provider)
    if not p:
        return None
    return await p.text_to_audio(text, voice_id)


# ─────────────────────────────────────────────────────────────────────────────
# ffmpeg 工具
# ─────────────────────────────────────────────────────────────────────────────

async def _run_ffmpeg(args: list[str], *, timeout: int = 300, retries: int = 2) -> tuple[bool, str]:
    """跑 ffmpeg 子进程，失败自动重试（应对瞬时 IO 抖动）。"""
    last_err = ""
    for attempt in range(retries + 1):
        try:
            r = await asyncio.to_thread(
                subprocess.run, args, capture_output=True, text=True, timeout=timeout
            )
            if r.returncode == 0:
                return True, ""
            last_err = (r.stderr or "")[-300:]
        except subprocess.TimeoutExpired:
            last_err = f"ffmpeg 超时（>{timeout}s）"
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
        if attempt < retries:
            await asyncio.sleep(0.5 * (attempt + 1))
    return False, last_err


# ─────────────────────────────────────────────────────────────────────────────
# 主流程：成片合成（含字幕 + 音频轨）
# ─────────────────────────────────────────────────────────────────────────────

async def compose_final(
    scene_id: str,
    obj_ids: list[str] | None = None,
    *,
    with_subtitle: bool = True,
    with_audio: bool = False,  # 默认关，等 TTS 拍板后开
) -> dict:
    """成片合成：拼接视频 → 烧字幕 → 混音频 → 抽封面 → 注册 asset。

    返回：{"ok": True/False, "url": ..., "cover_url": ..., "duration": ..., "logs": [...]}
    """
    from app.config import DATA_DIR
    logs: list[str] = []

    # 1) 收集视频对象（按连线顺序）
    vids = [o for o in await service.list_objects(scene_id)
            if o["object_type"] == "video" and (o["data"] or {}).get("url")]
    if obj_ids:
        wanted = set(obj_ids)
        vids = [o for o in vids if o["id"] in wanted]
    if len(vids) < 2:
        return {"ok": False, "error": "成片合成需要至少 2 个带视频地址的对象", "logs": logs}

    edges = await service.list_edges(scene_id)
    ordered: list[str] = []
    for e in edges:
        s, t = e.get("source_id"), e.get("target_id")
        if s and s not in ordered and any(o["id"] == s for o in vids):
            ordered.append(str(s))
        if t and t not in ordered and any(o["id"] == t for o in vids):
            ordered.append(str(t))
    tail = [o["id"] for o in vids if o["id"] not in ordered]
    seq = [next(o for o in vids if o["id"] == i) for i in (ordered + tail)]

    # 2) 视频落本地（来自 audio.py 的下载器）
    from app.scene.actions.audio import _download_to_uploads
    local: list[str] = []
    for o in seq:
        u = (o["data"] or {}).get("url", "")
        p = await _download_to_uploads(u, DATA_DIR)
        if p:
            local.append(p)
            logs.append(f"下载 {o['id']} → {Path(p).name}")
    if len(local) < 2:
        return {"ok": False, "error": "成片合成需要至少 2 段可用的本地视频", "logs": logs}

    # 3) 视频拼接
    up = DATA_DIR / "uploads"
    up.mkdir(parents=True, exist_ok=True)
    name = f"final_{uuid.uuid4().hex[:12]}.mp4"
    tmp = up / name
    listfile = up / f"concat_{uuid.uuid4().hex[:8]}.txt"
    listfile.write_text("\n".join(f"file '{p}'" for p in local), encoding="utf-8")
    ok, err = await _run_ffmpeg(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listfile),
         "-c", "copy", str(tmp)],
        timeout=300,
    )
    if not ok or not tmp.exists() or tmp.stat().st_size < 1000:
        return {"ok": False, "error": f"ffmpeg 视频拼接失败：{err}", "logs": logs}
    logs.append(f"视频拼接完成 {tmp.stat().st_size // 1024} KB")

    # 3.5) TTS 配音占位：实际生成在 # 5 之前做（统一进 audio_locals）
    tts_audio_path: str | None = None

    # 4) 烧字幕（可选）
    if with_subtitle:
        boards = [o for o in await service.list_objects(scene_id) if o["object_type"] == "storyboard"]
        shots = []
        for b in boards:
            dd = b["data"] or {}
            shots.append({
                "duration": float(dd.get("duration") or 5.0),
                "dialogue": str(dd.get("dialogue") or "").strip(),
            })
        subs = align_subtitles_from_storyboards(shots)
        if subs:
            srt = build_subtitle_file(subs, DATA_DIR, scene_id=scene_id)
            burned = up / f"final_burn_{uuid.uuid4().hex[:12]}.mp4"
            # ffmpeg 用 subtitles= 滤镜烧硬字幕（force_style 控制外观）
            force = ("Fontsize=22,FontName=PingFang SC,PrimaryColour=&HFFFFFF&,"
                      "OutlineColour=&H000000&,Outline=2,Alignment=2")
            ok, err = await _run_ffmpeg(
                ["ffmpeg", "-y", "-i", str(tmp),
                 "-vf", f"subtitles={srt.as_posix()}:force_style='{force}'",
                 "-c:a", "copy", str(burned)],
                timeout=300,
            )
            if ok and burned.exists() and burned.stat().st_size > 1000:
                tmp = burned
                logs.append(f"字幕烧录完成 {len(subs)} 条")
            else:
                logs.append(f"字幕烧录失败（继续无字幕输出）：{err[-120:]}")

    # 5) 音频混合（可选，默认关等 TTS 拍板）
    if with_audio:
        # 5a) TTS 配音：每个分镜的 dialogue/description → 主选火山/备选硅基/stub
        boards_audio = [o for o in await service.list_objects(scene_id) if o["object_type"] == "storyboard"]
        edges_audio = await service.list_edges(scene_id)
        ordered_b_audio: list[str] = []
        for e in edges_audio:
            s, t = e.get("source_id"), e.get("target_id")
            if s and s not in ordered_b_audio and any(o["id"] == s for o in boards_audio):
                ordered_b_audio.append(str(s))
            if t and t not in ordered_b_audio and any(o["id"] == t for o in boards_audio):
                ordered_b_audio.append(str(t))
        tail_ba = [o["id"] for o in boards_audio if o["id"] not in ordered_b_audio]
        seq_ba = [next(o for o in boards_audio if o["id"] == i) for i in (ordered_b_audio + tail_ba)]
        tts_files: list[str] = []
        for b in seq_ba:
            txt = (b.get("data") or {}).get("dialogue") or (b.get("data") or {}).get("description") or ""
            if not txt.strip():
                continue
            af = await synthesize_voiceover(txt.strip()[:200], provider="auto")
            if af:
                tts_files.append(af)
                logs.append(f"TTS 配音 → {Path(af).name} 「{txt[:30]}…」")
        if tts_files:
            tts_audio_path = await _concat_audios(tts_files, DATA_DIR, prefix="tts_track")
            if tts_audio_path:
                logs.append(f"TTS 总轨 {Path(tts_audio_path).stat().st_size // 1024} KB")
        # 5b) 用户已有的音频对象（背景音乐/音效等）
        audios = [o for o in await service.list_objects(scene_id)
                  if o["object_type"] == "audio" and (o["data"] or {}).get("url")]
        audio_locals: list[str] = []
        if tts_audio_path:
            audio_locals.append(tts_audio_path)
        for a in audios:
            p = await _download_to_uploads((a["data"] or {}).get("url", ""), DATA_DIR)
            if p:
                audio_locals.append(p)
        if audio_locals:
            alist = up / f"alist_{uuid.uuid4().hex[:8]}.txt"
            alist.write_text("\n".join(f"file '{a}'" for a in audio_locals), encoding="utf-8")
            ok_a, err_a = await _run_ffmpeg(
                ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(alist),
                 "-c", "copy", str(up / f"merged_audio_{uuid.uuid4().hex[:8]}.m4a")],
                timeout=180,
            )
            merged_audio = up / f"merged_audio_{uuid.uuid4().hex[:8]}.m4a"
            if ok_a and merged_audio.exists() and merged_audio.stat().st_size > 1000:
                final_with_audio = up / f"final_audio_{uuid.uuid4().hex[:12]}.mp4"
                ok_mix, err_mix = await _run_ffmpeg(
                    ["ffmpeg", "-y", "-i", str(tmp), "-i", str(merged_audio),
                     "-c:v", "copy", "-c:a", "aac", "-shortest", str(final_with_audio)],
                    timeout=180,
                )
                if ok_mix and final_with_audio.exists():
                    tmp = final_with_audio
                    logs.append(f"音频混合完成 {len(audio_locals)} 段（含 TTS={bool(tts_audio_path)}）")
                else:
                    logs.append(f"音频混合失败（继续无音频输出）：{err_mix[-120:]}")

    # 6) 抽首帧做封面
    cover_url = ""
    cover_path = up / f"final_{uuid.uuid4().hex[:12]}.jpg"
    ok_c, _ = await _run_ffmpeg(
        ["ffmpeg", "-y", "-i", str(tmp), "-vframes", "1", "-q:v", "2", str(cover_path)],
        timeout=60,
    )
    if cover_path.exists() and cover_path.stat().st_size > 1000:
        cover_url = f"/uploads/{cover_path.name}"
        logs.append(f"封面抽取完成 {cover_path.stat().st_size // 1024} KB")

    # 7) 探测总时长
    duration = 0.0
    try:
        probe = await asyncio.to_thread(
            subprocess.run,
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "json", str(tmp)],
            capture_output=True, text=True, timeout=30,
        )
        if probe.returncode == 0:
            duration = float(json.loads(probe.stdout).get("format", {}).get("duration") or 0.0)
    except Exception:  # noqa: BLE001
        pass

    # 8) 落库 + 注册 asset
    url = f"/uploads/{tmp.name}"
    nid = await service.create_object(
        scene_id, "video", x=500, y=400, width=340, height=240,
        data={
            "url": url, "prompt": "", "model": "ffmpeg", "composed": True,
            "cover_url": cover_url, "duration": round(duration, 1),
            "with_subtitle": with_subtitle, "with_audio": with_audio,
        },
    )
    await _register_asset(scene_id, "video", url, name="成片", meta={"composed": True})
    logs.append(f"成片完成 url={url} duration={duration:.1f}s")
    return {"ok": True, "url": url, "cover_url": cover_url, "duration": duration,
            "created": [nid], "logs": logs, "message": f"合成成片 {duration:.1f}s（{len(local)} 段视频）"}
