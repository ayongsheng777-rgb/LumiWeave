"""影视拆镜视觉分析（V2.5 深度增强 #1：专用 Vision Provider）。

优先探测 providers 表中带视觉能力的 LLM（模型名含 vl/vision/qwen 等），
走 OpenAI 兼容的 image_url 多模态消息；未配置时回退 chat_full 带图链接。
结果做二次清洗，只保留 7 个镜头语言字段。
"""
from __future__ import annotations

import json
import re
from typing import Any

from app import db

VISION_KEYS = ("shot_size", "camera_motion", "composition", "lighting",
               "color", "character", "emotion", "action")

PROMPT = (
    "你是影视拉片分析师。请看这张镜头关键帧，严格只输出 JSON："
    '{"shot_size":"景别(如特写/近景/中景/全景/远景)","camera_motion":"镜头运动(如固定/推/拉/摇/移/跟)",'
    '"composition":"构图(如居中/三分法/对称)","lighting":"光线(如自然光/硬光/逆光)","color":"色调(如冷调/暖调/高对比)",'
    '"character":"画面人物或主体","emotion":"情绪(如紧张/温馨/孤独)","action":"画面动作"}。'
    "只输出 JSON，不要解释。若无法判断该字段输出空字符串。"
)


async def _find_vision_provider() -> dict | None:
    """找模型名带视觉能力的 LLM provider。"""
    try:
        rows = await db.fetch(
            "SELECT * FROM providers WHERE type='llm' AND status='enabled' ORDER BY updated_at DESC"
        )
        for r in rows:
            d = dict(r)
            models = d.get("models") or []
            if isinstance(models, str):
                try:
                    models = json.loads(models)
                except Exception:  # noqa: BLE001
                    models = []
            hay = " ".join(str(m).lower() for m in models) + " " + str(d.get("name", "")).lower()
            if any(k in hay for k in ("vl", "vision", "qwen", "gpt-4o", "gemini")):
                return d
    except Exception:  # noqa: BLE001
        pass
    return None


async def _call_openai_vision(prov: dict, frame_url: str) -> dict:
    """OpenAI 兼容多模态调用（image_url）。"""
    import httpx
    endpoint = (prov.get("endpoint") or "").rstrip("/")
    if not endpoint:
        return {}
    models = prov.get("models") or []
    if isinstance(models, str):
        try:
            models = json.loads(models)
        except Exception:  # noqa: BLE001
            models = []
    model = str(models[0]) if models else "qwen-vl-max"
    headers = {"Authorization": f"Bearer {prov.get('api_key','')}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": frame_url}},
            ],
        }],
        "max_tokens": 600,
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as c:
            r = await c.post(f"{endpoint}/chat/completions", json=payload, headers=headers)
            if r.status_code != 200:
                return {}
            text = (r.json().get("choices") or [{}])[0].get("message", {}).get("content", "")
            m = re.search(r"\{.*\}", text or "", re.S)
            if m:
                return json.loads(m.group(0))
    except Exception:  # noqa: BLE001
        pass
    return {}


async def vision_analyze(frame_url: str, ctx: str) -> dict:
    """对外入口：返回 {7 个镜头字段} 的清洗结果。"""
    out: dict[str, Any] = {}
    prov = await _find_vision_provider()
    if prov:
        raw = await _call_openai_vision(prov, frame_url)
        if raw:
            out = raw
    if not out:
        # 回退：chat_full 带图链接（best-effort）
        try:
            from app.ai.client import chat_full
            r = await chat_full(PROMPT + f"\n上下文：{ctx}\n图片地址：{frame_url}", "",
                                temperature=0.3, max_tokens=600, scenario="film_analysis")
            if r.ok and r.content:
                m = re.search(r"\{.*\}", r.content, re.S)
                if m:
                    out = json.loads(m.group(0))
        except Exception:  # noqa: BLE001
            pass
    # 二次清洗：只保留镜头语言字段，值必须是字符串
    cleaned: dict[str, Any] = {}
    for k in VISION_KEYS:
        v = out.get(k)
        if isinstance(v, str):
            cleaned[k] = v
        elif isinstance(v, (int, float)):
            cleaned[k] = str(v)
        else:
            cleaned[k] = ""
    return cleaned
