"""场景动作·音频与成片（BGM 提示词 / 配音稿 / 字幕 / ffmpeg 成片合成）。

从 actions.py 拆分而来（2026-08-29），函数实现原样未动。
"""
from __future__ import annotations

import subprocess
import uuid
from pathlib import Path

import httpx

from app.scene import service

from app.scene.actions.shared import (
    _llm_json,
    _llm_text,
    _register_asset,
    _shot_bgm,
)


async def _download_to_uploads(url: str, data_dir: Path) -> str | None:
    """云端 http(s) 视频下载到本地 /uploads（供 ffmpeg 拼接）。

    相对 /uploads/ 路径直接拼接；远程 URL 用 httpx 流式落盘。失败返回 None。
    """
    url = str(url or "").strip()
    if not url:
        return None
    if url.startswith("/uploads/"):
        p = data_dir / "uploads" / url[len("/uploads/"):]
        return str(p) if p.exists() else None
    up = data_dir / "uploads"
    up.mkdir(parents=True, exist_ok=True)
    name = f"dl_{uuid.uuid4().hex[:12]}.mp4"
    dst = up / name
    try:
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            async with client.stream("GET", url) as resp:
                if resp.status_code != 200:
                    return None
                with open(dst, "wb") as f:
                    async for chunk in resp.aiter_bytes():
                        f.write(chunk)
        if dst.exists() and dst.stat().st_size >= 1000:
            return str(dst)
        return None
    except Exception:  # noqa: BLE001
        return None


async def _concat_audios(audio_files: list[str], data_dir: Path, *, prefix: str = "concat") -> str | None:
    """§69 把多段 TTS 片段拼成一条音频轨（ffmpeg concat demuxer）。

    输入可以是 wav/mp3/m4a 不同格式——concat demuxer 要求格式一致，
    不一致时先用 lavfi 强制统一为 wav 再拼，最后输出 m4a 给视频混音用。
    """
    import asyncio

    files = [p for p in (audio_files or []) if p and Path(p).exists()]
    if not files:
        return None
    up = data_dir / "uploads"
    up.mkdir(parents=True, exist_ok=True)
    out = up / f"{prefix}_{uuid.uuid4().hex[:12]}.m4a"
    # 先把所有片段统一转 wav 到临时文件，避免 demuxer 格式不一致
    tmpdir = up / f"audnorm_{uuid.uuid4().hex[:8]}"
    tmpdir.mkdir(parents=True, exist_ok=True)
    normed: list[str] = []
    for i, src in enumerate(files):
        dst = tmpdir / f"seg_{i:03d}.wav"
        r = await asyncio.to_thread(
            subprocess.run,
            ["ffmpeg", "-y", "-i", src, "-ar", "24000", "-ac", "1", "-f", "wav", str(dst)],
            capture_output=True, text=True, timeout=60,
        )
        if r.returncode == 0 and dst.exists() and dst.stat().st_size > 100:
            normed.append(str(dst))
    if not normed:
        return None
    # concat
    listfile = up / f"{prefix}_list_{uuid.uuid4().hex[:8]}.txt"
    listfile.write_text("\n".join(f"file '{p}'" for p in normed), encoding="utf-8")
    r = await asyncio.to_thread(
        subprocess.run,
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listfile),
         "-c", "aac", "-b:a", "128k", str(out)],
        capture_output=True, text=True, timeout=180,
    )
    # 清理临时
    try:
        for p in normed:
            Path(p).unlink(missing_ok=True)
        tmpdir.rmdir()
        listfile.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass
    if r.returncode == 0 and out.exists() and out.stat().st_size > 1000:
        return str(out)
    return None


async def _act_generate_music(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """音频节点（BGM）：AI 识别分镜背景音乐 → 生成音乐风格/乐器/完整提示词，写回节点。

    仅做「音乐提示词生成」（后端暂无音乐合成 API，真实音频需外部 Suno 类服务）。
    自动连线剧情节点读取剧本，按节点选择的 shot_no 提取对应分镜 BGM 描述。
    """
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id)
                          if o["object_type"] == "audio"]
    if not targets:
        return {"ok": False, "error": "请先选择音频节点"}
    objs = {o["id"]: o for o in await service.list_objects(scene_id)}
    edges = await service.list_edges(scene_id)

    def _linked_story(o_id: str) -> dict | None:
        for e in edges:
            other = e["target_id"] if e["source_id"] == o_id else (e["source_id"] if e["target_id"] == o_id else None)
            if other and objs.get(other, {}).get("object_type") == "story":
                return objs[other]
        return None

    updated = []
    for oid in targets:
        obj = objs.get(oid)
        if not obj:
            continue
        d = obj["data"]
        shot_no = int(params.get("shot_no") or d.get("shot_no") or 0) or 0
        script = ""
        story = _linked_story(oid)
        if story:
            script = str((story.get("data") or {}).get("script") or "")
        bgm = str(params.get("desc") or d.get("desc") or "").strip()
        if not bgm and script and shot_no > 0:
            bgm = _shot_bgm(script, shot_no)
        if not bgm:
            updated.append(oid)
            continue
        sys = ("你是影视配乐师。根据分镜的背景音乐描述，输出 JSON："
               "{\"style\":\"音乐风格（如 轻松俏皮/悬疑紧张/温情治愈，给出具体风格名）\","
               "\"instruments\":\"乐器设定（如 尤克里里+轻快鼓点+环境采样）\","
               "\"prompt\":\"可直接用于音乐生成模型的完整中文提示词（含情绪/节奏/BPM/乐器/风格）\"}。"
               "只输出 JSON，不要多余文字。")
        r = await _llm_json(sys, f"分镜{shot_no}背景音乐描述：{bgm}")
        if not r:
            return {"ok": False, "error": "AI 生成音乐建议失败（检查 AI 配置）"}
        style = str(r.get("style") or "").strip()
        instruments = str(r.get("instruments") or "").strip()
        prompt = str(r.get("prompt") or "").strip()
        await service.update_object(oid, data={
            **d, "prompt": prompt, "style": style, "instruments": instruments,
            "desc": bgm, "shot_no": str(shot_no) if shot_no else d.get("shot_no", ""),
        })
        updated.append(oid)
    return {"ok": bool(updated), "updated": updated,
            "message": f"生成 {len(updated)} 段音乐提示词（风格/乐器建议已写回节点）"}


async def _act_generate_voiceover(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id)
                          if o["object_type"] in ("product", "story")]
    created = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        ctx = d.get("text") or d.get("summary") or d.get("name") or d.get("description") or ""
        sys = ("你是带货短剧配音导演。基于剧情/商品写一段 30-60 秒的配音稿"
               "（中文、口语化、有节奏、突出卖点），直接输出配音稿文本。")
        text = await _llm_text(sys, ctx)
        if not text:
            continue
        nid = await service.create_object(scene_id, "audio", x=400, y=float(obj.get("y") or 0) + 300,
                                          width=360, height=200,
                                          data={"text": text, "voiceover": True, "audio_type": "配音",
                                                "source_object_id": oid})
        created.append(nid)
    return {"ok": bool(created), "created": created, "message": f"生成 {len(created)} 段配音稿"}


async def _act_generate_subtitle(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    boards = [o for o in await service.list_objects(scene_id) if o["object_type"] == "storyboard"]
    if not boards:
        return {"ok": False, "error": "需要先有分镜对象"}
    lines = []
    for b in boards:
        dd = b["data"]
        if dd.get("dialogue"):
            lines.append(f"[{dd.get('scene', 1)}-{dd.get('shot', 1)}] {dd['dialogue']}")
    sys = ("你是短剧字幕师。把分镜台词整理成标准字幕 JSON，输出："
           '{"subtitles":[{"start":0,"end":3,"text":"..."}]}，每句 3-6 秒，只输出 JSON。')
    r = await _llm_json(sys, "\n".join(lines) if lines else "分镜台词为空，请按常见带货短剧编 5 句台词")
    payload = r or {"subtitles": [{"start": 0, "end": 3, "text": "（无台词）"}]}
    nid = await service.create_object(scene_id, "text", x=400, y=300, width=420, height=280,
                                      data={"name": "字幕", "subtitles": payload.get("subtitles", []),
                                            "subtitle": True})
    return {"ok": True, "created": [nid], "message": f"生成 {len(payload.get('subtitles', []))} 条字幕"}


async def _act_compose_final(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """§69 成片合成入口：转发到 compose.py 的新管道（含字幕烧录 + 失败重试）。

    向后兼容：保持原签名，返回结构兼容旧调用方。
    """
    from app.scene.actions.compose import compose_final
    with_subtitle = bool(params.get("with_subtitle", True))
    with_audio = bool(params.get("with_audio", True))  # §69 TTS Provider 接入后默认开（未配 key 时自动落静音占位）
    return await compose_final(scene_id, obj_ids, with_subtitle=with_subtitle, with_audio=with_audio)
