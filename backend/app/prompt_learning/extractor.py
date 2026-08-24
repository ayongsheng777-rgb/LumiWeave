from __future__ import annotations

import re
from typing import Any


def extract_prompt_blocks(text: str) -> list[dict[str, Any]]:
    """把 Markdown/文本按标题切分为知识块（spec #71 Fetcher→Parser→Extractor）。"""
    if not text:
        return []
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
