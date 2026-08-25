from __future__ import annotations

import json
import re
from typing import Any


def _extract_evolink_h3(html: str) -> list[dict[str, Any]]:
    """evolink.ai「MiniMax H3 提示词」页面专用提取器。

    该页面是 Next.js SSR，真正的内容藏在：
      1. JSON-LD 的 ItemList（40 个案例的中文名 + 锚点 url）
      2. 正文里 40 个 <article id="prompt-xxx">（每个案例的完整提示词/技巧/素材说明）

    把两者按锚点对起来，产出「中文标题 + 完整提示词正文」的知识块。
    """
    # 1. JSON-LD → { 锚点: 中文名 }
    name_map: dict[str, str] = {}
    for raw in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        try:
            data = json.loads(raw)
        except Exception:
            continue

        def walk(o: Any) -> None:
            if isinstance(o, dict):
                if o.get("@type") == "ItemList":
                    for it in o.get("itemListElement", []):
                        url = it.get("url", "")
                        frag = url.split("#")[-1] if "#" in url else ""
                        if frag and it.get("name"):
                            name_map[frag] = str(it["name"])
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)

        walk(data)

    # 2. article → 知识块
    blocks: list[dict[str, Any]] = []
    for pid, body in re.findall(r'<article id="(prompt-[^"]+)"[^>]*>(.*?)</article>', html, re.S):
        text = re.sub(r'<[^>]+>', '\n', body)
        text = re.sub(r'&[a-zA-Z#0-9]+;', ' ', text)
        lines = [ln.strip() for ln in text.split('\n') if ln.strip()]
        if not lines:
            continue
        title = name_map.get(pid, pid.replace('prompt-', '').replace('-', ' '))
        blocks.append({"title": title, "content": "\n".join(lines)[:4000]})
    return blocks


def extract_prompt_blocks(text: str) -> list[dict[str, Any]]:
    """把 Markdown/HTML/文本切成知识块。

    - 若是 evolink.ai H3 页面（含 <article id="prompt-">）→ 专用提取器
    - 否则按 Markdown 标题（#/##/###）切分
    """
    if not text:
        return []
    # HTML 页面（含 prompt article）优先走专用提取
    if '<article id="prompt-' in text:
        blocks = _extract_evolink_h3(text)
        if blocks:
            return blocks
    parts = re.split(r"(?m)^#{1,3}\s+(.+)$", text)
    blocks: list[dict[str, Any]] = []
    if parts[0].strip():
        blocks.append({"title": "intro", "content": parts[0].strip()[:2000]})
    for i in range(1, len(parts), 2):
        title = parts[i].strip()
        body = parts[i + 1].strip() if i + 1 < len(parts) else ""
        if body:
            blocks.append({"title": title, "content": body[:4000]})
    return blocks
