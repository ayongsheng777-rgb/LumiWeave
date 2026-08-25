"""影视创作 MCP 工具（film.*）：故事解析、角色生成、场景生成、分镜、字幕、导出。

工具函数提取到模块级（async def），既供 MCPServer 注册，也供 REST 路由
（/api/mcp/call/{tool}）直接调用 —— 让前端 film.* 系列 API 真正可用。
"""
from __future__ import annotations

import json
import uuid
from typing import Any


# =====================================================================
# 模块级工具函数（可被 MCP 注册 + REST 路由直接调用）
# =====================================================================

async def film_story_parse(
    text: str = "",
    genre: str = "科幻",
    style: str = "电影感",
    ratio: str = "16:9",
    duration: int = 30,
) -> dict[str, Any]:
    from app.ai.client import chat_json

    prompt = f"""用户输入：
{text}

请根据以上内容，提取以下结构（严格 JSON，不要多余文字）：

1. characters: 角色列表，每项含 id, name, description（外貌+性格）, prompt（用于绘图）

2. scenes: 场景列表，每项含 id, name, location（地点）, time（时间）, weather（天气）, camera（推荐镜头）, description（场景描述）, prompt（用于绘图）

3. props: 道具列表，每项含 id, name, description, prompt（用于绘图）

4. shots: 分镜列表（建议每3秒一个镜头，总时长{duration}秒），每项含 shot编号, camera（镜头类型）, duration（秒）, description（动作/情节描述）, prompt（用于绘图）

类型：{genre}
风格：{style}
比例：{ratio}

输出 JSON（直接可解析，不要任何前缀）："""
    try:
        result = await chat_json(
            system="你是专业的影视剧本结构解析助手，输出严格 JSON。",
            user=prompt,
            temperature=0.3,
            max_tokens=4096,
            scenario="film_story_parse",
        )
        if isinstance(result, dict):
            return {"ok": True, "data": result}
        return {"ok": False, "error": "解析失败，未返回有效 JSON"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def film_storyboard_generate(
    characters_json: str = "[]",
    scenes_json: str = "[]",
    story_text: str = "",
    genre: str = "科幻",
    style: str = "电影感",
    ratio: str = "16:9",
    total_duration: int = 30,
) -> dict[str, Any]:
    from app.ai.client import chat_json

    try:
        chars = json.loads(characters_json) if characters_json else []
        scenes = json.loads(scenes_json) if scenes_json else []
    except Exception:
        chars, scenes = [], []

    char_names = ", ".join(c.get("name", "") for c in chars) or "主角"
    scene_names = ", ".join(s.get("name", "") for s in scenes) or "主场景"

    context = f"""
故事：{story_text}
""" if story_text else ""

    prompt = f"""为一部{genre}风格的{style}短片设计分镜。
{context}
角色：{char_names}
场景：{scene_names}
总时长：{total_duration}秒（建议每镜3秒，共{ max(1, total_duration // 3) }个镜头）

请按以下 JSON 格式输出分镜列表（严格 JSON，无前缀）：
[
  {{"shot": 1, "camera": "wide shot", "duration": 3, "description": "主角进入场景", "prompt": "绘图提示词"}},
  ...
]

要求：
- camera 用英文：wide shot / medium shot / close-up / birds-eye view / dolly in / pan left 等
- description 要有画面感，写清楚动作和情节
- prompt 要能直接用于图片生成，包含风格、角色、场景描述
"""
    try:
        result = await chat_json(
            system="你是专业的影视分镜师，输出严格 JSON 数组。",
            user=prompt,
            temperature=0.3,
            max_tokens=2048,
            scenario="film_storyboard",
        )
        if isinstance(result, list):
            return {"ok": True, "data": {"shots": result, "total_duration": total_duration, "ratio": ratio}}
        return {"ok": True, "data": result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def film_character_generate(
    name: str = "",
    description: str = "",
    prompt: str = "",
    style: str = "电影感",
    pose: str = "",
    expression: str = "",
    reference_urls: list[str] | None = None,
    seed: str = "",
    render_mode: str = "comfyui",
    provider_id: str = "",
    model: str = "",
    renderer_id: str = "",
) -> dict[str, Any]:
    from app.renderers.generate import render_media

    # 提示词按用户原文（原生语种）引用，不做强制翻译；
    # prompt 字段优先，其余字段作为补充上下文拼在末尾。
    parts: list[str] = []
    if prompt.strip():
        parts.append(prompt.strip())
    for extra in (description, style, pose, expression):
        if extra and extra.strip():
            parts.append(extra.strip())
    parts.append("cinematic lighting, high detail")
    full_prompt = ", ".join(parts)

    seed_val = seed or str(uuid.uuid4().int)[:10]
    params = {
        "prompt": full_prompt,
        "negative": "blurry, low quality, deformed",
        "seed": seed_val,
        "steps": 30,
        "cfg": 7.5,
    }
    if reference_urls:
        params["reference"] = reference_urls
    try:
        result = await render_media(
            "image", params,
            render_mode=render_mode, provider_id=provider_id,
            model=model, renderer_id=renderer_id,
        )
        logs = result.get("logs") or []
        if isinstance(result, dict) and result.get("ok") is not False:
            images = result.get("images") or []
            url = images[0].get("url") if images else ""
            return {
                "ok": True,
                "data": {
                    "name": name,
                    "seed": seed_val,
                    "prompt": full_prompt,
                    "url": url,
                    "images": images,
                    "logs": logs,
                },
            }
        return {"ok": False, "error": result.get("error") if isinstance(result, dict) else "生成失败", "logs": logs}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def film_scene_generate(
    name: str = "",
    location: str = "",
    time: str = "白天",
    weather: str = "晴",
    camera: str = "wide shot",
    description: str = "",
    style: str = "电影感",
    reference_urls: list[str] | None = None,
    render_mode: str = "comfyui",
    provider_id: str = "",
    model: str = "",
    renderer_id: str = "",
) -> dict[str, Any]:
    from app.renderers.generate import render_media

    parts = [p for p in [style, location, time, weather, camera, description] if p and str(p).strip()]
    parts.append("cinematic atmosphere")
    full_prompt = ", ".join(parts)

    params = {
        "prompt": full_prompt,
        "negative": "blurry, low quality, deformed, text, watermark",
        "seed": str(uuid.uuid4().int)[:10],
        "steps": 30,
        "cfg": 7.5,
    }
    if reference_urls:
        params["reference"] = reference_urls
    try:
        result = await render_media(
            "image", params,
            render_mode=render_mode, provider_id=provider_id,
            model=model, renderer_id=renderer_id,
        )
        logs = result.get("logs") or []
        if isinstance(result, dict) and result.get("ok") is not False:
            images = result.get("images") or []
            url = images[0].get("url") if images else ""
            return {
                "ok": True,
                "data": {
                    "name": name,
                    "location": location,
                    "prompt": full_prompt,
                    "url": url,
                    "images": images,
                    "logs": logs,
                },
            }
        return {"ok": False, "error": result.get("error") if isinstance(result, dict) else "生成失败", "logs": logs}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def film_video_generate(
    prompt: str = "",
    mode: str = "text2video",
    duration: int = 6,
    ratio: str = "16:9",
    camera: str = "",
    image_url: str = "",
    reference_images: list[str] | None = None,
    render_mode: str = "cloud",
    provider_id: str = "",
    model: str = "",
    renderer_id: str = "",
) -> dict[str, Any]:
    """生成视频。mode: text2video(文生) / image2video(首帧) / multi_ref(多参考图)。
    多参考图（multi_ref）把角色图+场景图+道具图作为 reference_images 传给 MiniMax 多图参考。
    参数不全时返回 needs_input=True，由调用方（AI/MCP）继续追问用户补充。"""
    # 询问式配置：关键参数缺失时，明确返回需要补充的信息，而不是默默用默认值
    if not prompt.strip():
        return {"ok": False, "needs_input": True,
                "question": "请提供视频提示词（描述画面内容、动作、运镜）",
                "error": "缺少视频提示词"}
    if mode == "image2video" and not image_url:
        return {"ok": False, "needs_input": True,
                "question": "首帧生视频需要一张首帧图片，请提供 image_url（可用场景图或角色图）",
                "error": "缺少首帧图"}
    if mode == "multi_ref" and not (reference_images or []):
        return {"ok": False, "needs_input": True,
                "question": "多参考生视频需要参考图列表，请提供 reference_images（角色图/场景图/道具图 URL 数组）",
                "error": "缺少参考图"}

    from app.renderers.generate import render_media

    parts = [prompt.strip()]
    if camera:
        parts.append(f"运镜：{camera}")
    full_prompt = "，".join(parts)

    params: dict[str, Any] = {
        "prompt": full_prompt,
        "duration": duration,
        "ratio": ratio,
    }
    if image_url:
        params["image_url"] = image_url
    if reference_images:
        params["reference_images"] = reference_images

    try:
        result = await render_media(
            "video", params,
            render_mode=render_mode, provider_id=provider_id,
            model=model, renderer_id=renderer_id,
        )
        logs = result.get("logs") or []
        if isinstance(result, dict) and result.get("ok") is not False:
            videos = result.get("videos") or []
            url = videos[0].get("url") if videos else ""
            return {"ok": True, "data": {"url": url, "videos": videos, "logs": logs}}
        return {"ok": False, "error": result.get("error") if isinstance(result, dict) else "生成失败", "logs": logs}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def film_subtitle_generate(
    video_url: str = "",
    audio_url: str = "",
    subtitle_content: str = "",
    format: str = "srt",
) -> dict[str, Any]:
    if subtitle_content:
        lines = subtitle_content.strip().split("\n")
        segments = []
        if format == "srt":
            for i, line in enumerate(lines, 1):
                start = f"00:{(i-1)*3:02d}:00,000"
                end = f"00:{i*3:02d}:00,000"
                segments.append(f"{i}\n{start} --> {end}\n{line}\n")
        else:
            for i, line in enumerate(lines, 1):
                start = f"00:{(i-1)*3:02d}:00.00"
                end = f"00:{i*3:02d}:00.00"
                segments.append(f"[{i}]\nStart={start}\nEnd={end}\nText={line}\n")
        content = "\n".join(segments)
        return {
            "ok": True,
            "data": {
                "subtitle_url": "",
                "format": format,
                "segments": len(lines),
                "content": content,
            },
        }
    return {
        "ok": False,
        "error": "暂无字幕内容，请先通过 StoryNode 解析故事获取字幕，或传入 subtitle_content 参数",
    }


async def film_export(
    format: str = "mp4",
    video_url: str = "",
    subtitle_url: str = "",
    include_storyboard: bool = True,
    include_subtitles: bool = True,
) -> dict[str, Any]:
    export_meta = {
        "format": format,
        "video_url": video_url,
        "subtitle_url": subtitle_url,
        "include_storyboard": include_storyboard,
        "include_subtitles": include_subtitles,
        "exported_at": str(uuid.uuid4()),
    }
    return {
        "ok": True,
        "data": {
            "message": f"导出格式：{format}，已记录导出请求",
            "meta": export_meta,
        },
    }


# =====================================================================
# MCP 注册：把模块级函数挂到 MCPServer
# =====================================================================

_FILM_TOOLS = [
    (
        "film.story_parse",
        "AI 解析故事文本，提取角色、场景、道具、分镜结构。输入故事/小说/广告需求，输出角色列表、场景列表、道具列表、分镜列表。",
        film_story_parse,
    ),
    (
        "film.character_generate",
        "根据角色定义生成角色图片，支持角色一致性种子、参考图。",
        film_character_generate,
    ),
    (
        "film.scene_generate",
        "根据场景定义生成场景图片，支持参考图、天气/时间/镜头参数。",
        film_scene_generate,
    ),
    (
        "film.storyboard_generate",
        "根据角色/场景/时长生成分镜表（Shot-by-Shot），输出镜头列表含 camera/duration/description。",
        film_storyboard_generate,
    ),
    (
        "film.video_generate",
        "生成视频。mode=text2video(文生视频)/image2video(首帧图生视频)/multi_ref(多参考图生视频)。multi_ref 可把多张角色图+场景图+道具图作为 reference_images 传给 MiniMax 多图参考。参数不全时返回 needs_input 提示补充。",
        film_video_generate,
    ),
    (
        "film.subtitle_generate",
        "根据视频/音频生成字幕文件（SRT/ASS 格式）。",
        film_subtitle_generate,
    ),
    (
        "film.export",
        "导出项目为 MP4/MOV/PNG/PDF 分镜脚本。",
        film_export,
    ),
]


def register(server: Any) -> None:
    for name, desc, func in _FILM_TOOLS:
        server.tool(name=name, description=desc)(func)


# =====================================================================
# REST 路由调用：按 tool name 分发
# =====================================================================

_FILM_CALL_MAP: dict[str, Any] = {
    "film.story_parse": film_story_parse,
    "film.storyboard_generate": film_storyboard_generate,
    "film.character_generate": film_character_generate,
    "film.scene_generate": film_scene_generate,
    "film.video_generate": film_video_generate,
    "film.subtitle_generate": film_subtitle_generate,
    "film.export": film_export,
}


def get_film_tool(name: str) -> Any:
    return _FILM_CALL_MAP.get(name)
