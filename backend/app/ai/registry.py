from __future__ import annotations

from typing import Any

CAPABILITY_TAGS = {
    "reasoning",
    "long",
    "zh",
    "fast",
    "cheap",
    "vision",
    "general",
}

MODEL_RULES = [
    ("deepseek-reasoner", ["reasoning", "long", "zh"]),
    ("deepseek-v4-pro", ["reasoning", "long", "zh"]),
    ("deepseek-v4-flash", ["fast", "cheap", "zh"]),
    ("deepseek-v3.1-terminus", ["reasoning", "long"]),
    ("deepseek-v3.1", ["long", "zh"]),
    ("deepseek", ["zh", "general"]),
    ("qwen3.8-max", ["reasoning", "long", "zh"]),
    ("qwen3.7-max", ["reasoning", "long", "zh"]),
    ("qwen3.7-plus", ["long", "zh"]),
    ("qwen3.7-flash", ["fast", "cheap", "zh"]),
    ("qwen3-235b-a22b", ["reasoning", "long", "zh"]),
    ("qwen3-8b", ["zh", "general"]),    # Qwen3 8B（ComfyUI 内置 LLM 节点）
    ("qwen3-plus-8b", ["zh", "general"]),
    ("qwen", ["zh", "general"]),
    ("kimi-k3", ["reasoning", "long", "zh"]),
    ("kimi", ["zh", "long"]),
    ("glm", ["zh", "general"]),
    ("hy3", ["zh", "general"]),
    ("llama-3.3-70b", ["long", "general"]),
    ("llama-3.1-nemotron-70b", ["long", "general"]),
    ("llama-3.1-8b", ["fast", "cheap", "general"]),
    ("mixtral-8x22b", ["long", "general"]),
    ("mistral-7b", ["fast", "cheap", "general"]),
    ("phi-3-mini", ["fast", "cheap", "general"]),
    ("gpt-4o", ["vision", "long", "general"]),
    ("gpt-4", ["reasoning", "long", "general"]),
    ("gpt-3.5-turbo", ["fast", "cheap", "general"]),
    ("claude", ["long", "general"]),
    ("gemini", ["vision", "long", "general"]),
    ("grok", ["long", "general"]),
]

SCENARIOS: dict[str, list[str]] = {
    "chat": ["zh", "general"],
    "copywriting": ["zh", "long"],
    "video_prompt": ["zh", "general"],
    "image_prompt": ["zh", "general"],
    "kb": ["zh", "long"],
    "general": ["general"],
}


def infer_tags(model_id: str) -> list[str]:
    mid = model_id.lower()
    tags: set[str] = set()
    for rule_id, rule_tags in MODEL_RULES:
        if rule_id in mid:
            tags.update(rule_tags)
            break
    if not tags:
        tags.add("general")
    return sorted(tags)


def recommend(
    profiles: list[dict[str, Any]],
    scenario_id: str = "general",
    sector_hint: str = "",
) -> list[dict[str, Any]]:
    needed = set(SCENARIOS.get(scenario_id, SCENARIOS["general"]))
    results: list[dict[str, Any]] = []
    for p in profiles:
        model = p.get("model", "")
        tags = set(p.get("tags") or infer_tags(model))
        missing = sorted(needed - tags)
        score = len(needed & tags) / max(len(needed), 1)
        results.append(
            {
                "id": p.get("id"),
                "name": p.get("name", model),
                "model": model,
                "tags": sorted(tags),
                "score": round(score, 2),
                "missing": missing,
                "reason": _reason(score, missing),
            }
        )
    results.sort(key=lambda x: (-x["score"], x["model"]))
    return results


def _reason(score: float, missing: list[str]) -> str:
    if score >= 1.0:
        return "能力完全匹配"
    if score >= 0.5:
        return "基本匹配，缺少: " + ", ".join(missing) if missing else "基本匹配"
    return "能力欠缺: " + ", ".join(missing) if missing else "通用兜底"
