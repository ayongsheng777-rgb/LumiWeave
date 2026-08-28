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

# 批量分析：一张 prompt 带 N 张关键帧，一次请求返回全部镜头的分析（省 token 关键）
BATCH_PROMPT = (
    "你是影视拉片分析师。下面按顺序给出 {n} 张镜头关键帧（第1张=镜头1，第2张=镜头2，以此类推）。"
    "对每一张图，严格输出一个 JSON 对象："
    '{"shot_size":"景别(如特写/近景/中景/全景/远景)","camera_motion":"镜头运动(如固定/推/拉/摇/移/跟)",'
    '"composition":"构图(如居中/三分法/对称)","lighting":"光线(如自然光/硬光/逆光)","color":"色调(如冷调/暖调/高对比)",'
    '"character":"画面人物或主体","emotion":"情绪(如紧张/温馨/孤独)","action":"画面动作"}。'
    "最后严格只输出一个 JSON 数组，长度必须为 {n}，数组第 i 项是第 i 张图的分析（i 从 1 开始，与图片顺序一一对应）。"
    "不要解释，不要额外字段。无法判断的字段输出空字符串。"
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


# ─────────────────────────────────────────────────────────────────────────────
# 省 token 批量分析：N 张关键帧 → 1 次多模态请求 → N 份镜头分析
# ─────────────────────────────────────────────────────────────────────────────

async def _call_openai_vision_batch(prov: dict, frame_urls: list[str]) -> list[dict]:
    """OpenAI 兼容多模态批量调用（content 多张 image_url），返回按序的分析列表。"""
    import httpx
    endpoint = (prov.get("endpoint") or "").rstrip("/")
    if not endpoint or not frame_urls:
        return []
    models = prov.get("models") or []
    if isinstance(models, str):
        try:
            models = json.loads(models)
        except Exception:  # noqa: BLE001
            models = []
    model = str(models[0]) if models else "qwen-vl-max"
    content: list[dict] = [{"type": "text", "text": BATCH_PROMPT.format(n=len(frame_urls))}]
    for u in frame_urls:
        content.append({"type": "image_url", "image_url": {"url": u}})
    headers = {"Authorization": f"Bearer {prov.get('api_key','')}", "Content-Type": "application/json"}
    payload = {"model": model, "messages": [{"role": "user", "content": content}], "max_tokens": 2500}
    try:
        async with httpx.AsyncClient(timeout=120.0) as c:
            r = await c.post(f"{endpoint}/chat/completions", json=payload, headers=headers)
            if r.status_code != 200:
                return []
            text = (r.json().get("choices") or [{}])[0].get("message", {}).get("content", "")
            m = re.search(r"\[.*\]", text or "", re.S)
            if not m:
                return []
            arr = json.loads(m.group(0))
            return arr if isinstance(arr, list) else []
    except Exception:  # noqa: BLE001
        return []


async def vision_analyze_batch(frame_urls: list[str], ctx: str) -> list[dict]:
    """省 token 入口：批量分析 N 张镜头帧，返回按序 [{7 字段}] 列表。

    优先一次多模态请求；解析失败/无视觉 provider 时逐帧回退 vision_analyze。
    """
    urls = [u for u in (frame_urls or []) if u and str(u).strip()]
    if not urls:
        return []
    prov = await _find_vision_provider()
    raw_list: list[dict] = []
    if prov and len(urls) >= 2:
        raw_list = await _call_openai_vision_batch(prov, urls)
    out: list[dict] = []
    if len(raw_list) == len(urls):
        for raw in raw_list:
            if isinstance(raw, dict):
                cleaned: dict[str, Any] = {}
                for k in VISION_KEYS:
                    v = raw.get(k)
                    cleaned[k] = str(v) if isinstance(v, (str, int, float)) else ""
                out.append(cleaned)
    if len(out) != len(urls):
        # 降级：逐帧分析（结果不足时补齐）
        for i, u in enumerate(urls):
            if i < len(out):
                continue
            try:
                out.append(await vision_analyze(u, f"{ctx}·镜头{i + 1}"))
            except Exception:  # noqa: BLE001
                out.append({k: "" for k in VISION_KEYS})
    return out
