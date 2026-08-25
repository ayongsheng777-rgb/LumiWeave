"""影视创作 MCP 工具（film.*）：故事解析、角色生成、场景生成、分镜、字幕、导出。"""
from __future__ import annotations

import uuid
from typing import Any

from app.mcp.registry import tool_registry


def register(server: Any) -> None:

    # ── 1. 故事解析 ────────────────────────────────────────────────────────

    @server.tool(
        name="film.story_parse",
        description=(
            "AI 解析故事文本，提取角色、场景、道具、分镜结构。"
            "输入故事/小说/广告需求，输出角色列表、场景列表、道具列表、分镜列表。"
        ),
    )
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

    # ── 2. 角色生成 ──────────────────────────────────────────────────────

    @server.tool(
        name="film.character_generate",
        description="根据角色定义生成角色图片，支持角色一致性种子、参考图。",
    )
    async def film_character_generate(
        name: str = "",
        description: str = "",
        prompt: str = "",
        style: str = "电影感",
        pose: str = "",
        expression: str = "",
        reference_urls: list[str] | None = None,
        seed: str = "",
    ) -> dict[str, Any]:
        # 复用现有的 render 路由，走 ComfyUI 优先
        from app.renderers.dispatcher import dispatch_render_task

        full_prompt = f"{style}, {description}, {pose}, {expression}, cinematic lighting, high detail"
        if reference_urls:
            full_prompt = f"[reference image] {full_prompt}"

        workflow = {
            "prompt": full_prompt,
            "negative_prompt": "blurry, low quality, deformed",
            "seed": seed or str(uuid.uuid4().int)[:10],
            "steps": 30,
            "cfg_scale": 7.5,
        }
        try:
            result = await dispatch_render_task(f"char_{uuid.uuid4().hex[:8]}", workflow, wait=True)
            if isinstance(result, dict) and result.get("ok") is not False:
                images = result.get("images") or []
                url = images[0].get("url") if images else ""
                return {
                    "ok": True,
                    "data": {
                        "name": name,
                        "seed": workflow["seed"],
                        "prompt": full_prompt,
                        "url": url,
                        "images": images,
                    },
                }
            return {"ok": False, "error": result.get("error") if isinstance(result, dict) else "生成失败"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── 3. 场景生成 ──────────────────────────────────────────────────────

    @server.tool(
        name="film.scene_generate",
        description="根据场景定义生成场景图片，支持参考图、天气/时间/镜头参数。",
    )
    async def film_scene_generate(
        name: str = "",
        location: str = "",
        time: str = "白天",
        weather: str = "晴",
        camera: str = "wide shot",
        description: str = "",
        style: str = "电影感",
        reference_urls: list[str] | None = None,
    ) -> dict[str, Any]:
        from app.renderers.dispatcher import dispatch_render_task

        full_prompt = f"{style}, {location}, {time}, {weather}, {camera}, {description}, cinematic atmosphere"
        if reference_urls:
            full_prompt = f"[reference image] {full_prompt}"

        workflow = {
            "prompt": full_prompt,
            "negative_prompt": "blurry, low quality, deformed, text, watermark",
            "seed": str(uuid.uuid4().int)[:10],
            "steps": 30,
            "cfg_scale": 7.5,
        }
        try:
            result = await dispatch_render_task(f"scene_{uuid.uuid4().hex[:8]}", workflow, wait=True)
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
                    },
                }
            return {"ok": False, "error": result.get("error") if isinstance(result, dict) else "生成失败"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── 4. 分镜生成 ──────────────────────────────────────────────────────

    @server.tool(
        name="film.storyboard_generate",
        description="根据角色/场景/时长生成分镜表（Shot-by-Shot），输出镜头列表含 camera/duration/description。",
    )
    async def film_storyboard_generate(
        characters_json: str = "[]",
        scenes_json: str = "[]",
        genre: str = "科幻",
        style: str = "电影感",
        ratio: str = "16:9",
        total_duration: int = 30,
    ) -> dict[str, Any]:
        import json
        from app.ai.client import chat_json

        try:
            chars = json.loads(characters_json) if characters_json else []
            scenes = json.loads(scenes_json) if scenes_json else []
        except Exception:
            chars, scenes = [], []

        char_names = ", ".join(c.get("name", "") for c in chars) or "主角"
        scene_names = ", ".join(s.get("name", "") for s in scenes) or "主场景"

        prompt = f"""为一部{genre}风格的{style}短片设计分镜。

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

    # ── 5. 字幕生成 ──────────────────────────────────────────────────────

    @server.tool(
        name="film.subtitle_generate",
        description="根据视频/音频生成字幕文件（SRT/ASS 格式）。",
    )
    async def film_subtitle_generate(
        video_url: str = "",
        audio_url: str = "",
        subtitle_content: str = "",
        format: str = "srt",
    ) -> dict[str, Any]:
        # 若有字幕内容，直接格式化；否则提示需语音识别
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
                    "subtitle_url": "",  # 存 DB 后返回
                    "format": format,
                    "segments": len(lines),
                    "content": content,
                },
            }
        return {
            "ok": False,
            "error": "暂无字幕内容，请先通过 StoryNode 解析故事获取字幕，或传入 subtitle_content 参数",
        }

    # ── 6. 项目导出 ──────────────────────────────────────────────────────

    @server.tool(
        name="film.export",
        description="导出项目为 MP4/MOV/PNG/PDF 分镜脚本。",
    )
    async def film_export(
        format: str = "mp4",
        video_url: str = "",
        subtitle_url: str = "",
        include_storyboard: bool = True,
        include_subtitles: bool = True,
    ) -> dict[str, Any]:
        # 导出为结构化 JSON 包（真实视频编码需外部服务）
        export_meta = {
            "format": format,
            "video_url": video_url,
            "subtitle_url": subtitle_url,
            "include_storyboard": include_storyboard,
            "include_subtitles": include_subtitles,
            "exported_at": str(uuid.uuid4()),  # 占位，DB 持久化后替换
        }
        return {
            "ok": True,
            "data": {
                "message": f"导出格式：{format}，已记录导出请求",
                "meta": export_meta,
            },
        }
