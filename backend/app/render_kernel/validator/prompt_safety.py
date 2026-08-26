"""PromptSafety — 提示词安全校验（规格书 §7 内容安全）。"""
from __future__ import annotations

from dataclasses import dataclass
import re


# 简单关键词黑名单（生产环境替换为商业审核 API）
_SENSITIVE_PATTERNS = [
    re.compile(r"\b(violence|vendetta|gore|blood)\b", re.I),
    re.compile(r"\b(nsfw|explicit|nude|naked)\b", re.I),
    re.compile(r"[^\w\s]{10,}", re.I),   # 连续标点
]
_SUSPICIOUS_CHARS = set("<script>svg:<>onerror")


@dataclass
class PromptSafetyResult:
    safe: bool
    blocked_terms: list[str] = []
    message: str = ""


def check_prompt_safety(positive: str, negative: str = "") -> PromptSafetyResult:
    """
    基础提示词安全校验。

    命中黑名单词或含危险字符 → safe=False。
    生产级部署应接入 Azure Content Safety / 阿里云内容审核等商业 API。
    """
    text = f"{positive} {negative}"
    blocked: list[str] = []

    for pat in _SENSITIVE_PATTERNS:
        hits = pat.findall(text)
        blocked.extend(hits)

    dangerous_chars = [c for c in _SUSPICIOUS_CHARS if c in text]
    if dangerous_chars:
        blocked.append(f"危险字符: {dangerous_chars}")

    if blocked:
        return PromptSafetyResult(
            safe=False,
            blocked_terms=blocked,
            message=f"内容安全校验未通过：{', '.join(blocked)}",
        )

    return PromptSafetyResult(safe=True)
