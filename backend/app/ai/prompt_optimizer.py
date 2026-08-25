"""提示词优化器（需求 #4）。

优先从「知识库（prompt_knowledge）+ 技能库（skills）」里检索匹配的专业写法，
命中则以其为参考优化；无匹配再让 AI 自行理解生成。

返回 {ok, optimized, source: 'kb'|'skill'|'ai', matched:[...], logs}。
"""
from __future__ import annotations

import re
from typing import Any

from app import db


def _tokens(text: str) -> set[str]:
    """中英混合分词：英文单词 + 中文字/二元组，用于重叠度打分。"""
    text = (text or "").lower()
    toks: set[str] = set(re.findall(r"[a-z0-9]+", text))
    for seg in re.findall(r"[\u4e00-\u9fff]+", text):
        for i, ch in enumerate(seg):
            toks.add(ch)
            if i + 1 < len(seg):
                toks.add(seg[i:i + 2])
    return toks


def _overlap(query: str, candidate: str) -> float:
    q, c = _tokens(query), _tokens(candidate)
    if not q or not c:
        return 0.0
    return len(q & c) / max(1, len(q))


_PROMPT_HINT_WORDS = ("提示词", "prompt", "绘图", "出图", "生图", "视频", "画面", "镜头", "写实",
                      "风格", "光照", "构图", "image", "video", "draw", "character", "角色", "场景")


def _skill_matches(prompt: str) -> list[dict[str, Any]]:
    """在技能库里找与提示词主题相关的技能（按名称/描述/标签/正文重叠打分）。"""
    from app.skills import skill_manager
    out: list[dict[str, Any]] = []
    for m in skill_manager.list():
        text = " ".join([
            str(m.get("name", "")), str(m.get("description", "")),
            " ".join(str(t) for t in (m.get("tags") or [])),
        ])
        # 内容命中提示词写作类技能才参与
        entry = skill_manager.get(m.get("id", ""))
        content = entry.content if entry else ""
        # 判定是否「提示词写作」相关
        relevance = any(w in (text + " " + content).lower() for w in _PROMPT_HINT_WORDS)
        if not relevance:
            continue
        score = _overlap(prompt, text + " " + content[:2000])
        if score >= 0.05:
            out.append({
                "title": str(m.get("name", "")),
                "source": "skill",
                "skill_id": m.get("id", ""),
                "score": round(score, 4),
                "content": content[:2000],
            })
    out.sort(key=lambda x: -x["score"])
    return out[:2]


async def _kb_matches(prompt: str) -> list[dict[str, Any]]:
    """在知识库里检索匹配的专业写法（语义向量 + 中文关键词重叠双路）。"""
    from app.prompt_learning.store import prompt_store
    try:
        rows = await prompt_store.all()
    except Exception:
        rows = []
    scored: list[tuple[float, dict[str, Any]]] = []
    for r in rows:
        title = str(r.get("title") or "")
        content = str(r.get("content") or "")
        score = _overlap(prompt, title + " " + content)
        if score > 0:
            scored.append((score, {"title": title, "source": "kb", "score": round(score, 4), "content": content[:2000]}))
    scored.sort(key=lambda x: -x[0])
    return [d for _, d in scored[:3]]


async def optimize_prompt(
    prompt: str,
    *,
    kind: str = "image",
    model: str = "",
) -> dict[str, Any]:
    """优化提示词。kind: image|video|character。"""
    prompt = (prompt or "").strip()
    if not prompt:
        return {"ok": False, "error": "提示词为空"}

    kind_label = {"video": "视频", "character": "角色图", "image": "图片"}.get(kind, "图片")
    model_hint = f"（目标模型：{model}）" if model else ""

    # 1) 检索知识库 + 技能库
    kb_hits = await _kb_matches(prompt)
    skill_hits = _skill_matches(prompt)
    refs = kb_hits + skill_hits
    refs.sort(key=lambda x: -x["score"])

    from app.ai import client

    if refs:
        best = refs[0]
        source = best["source"]
        reference_text = "\n\n".join(
            f"【{r['source']}】{r['title']}\n{r['content'][:800]}" for r in refs[:2]
        )
        system = (
            f"你是专业的 AI {kind_label}提示词优化师。"
            f"下面是从知识库/技能库检索到的专业写法与范例，请严格参考这些专业要点来优化用户的原始提示词，"
            f"补充必要的镜头、光照、风格、细节、构图等要素，并保持与原文语种一致（原文是中文就输出中文）。"
            f"只输出优化后的提示词正文，不要任何解释、不要引号包裹、不要前缀。{model_hint}"
        )
        user = f"检索到的专业参考：\n{reference_text}\n\n用户原始提示词：\n{prompt}"
        optimized = await client.chat(system, user, scenario="prompt_optimize", temperature=0.4, max_tokens=800)
    else:
        source = "ai"
        system = (
            f"你是专业的 AI {kind_label}提示词优化师。根据你的专业知识，把用户的原始提示词优化成更高质量的{kind_label}提示词，"
            f"补充镜头、光照、风格、细节、构图等要素，并保持与原文语种一致。"
            f"只输出优化后的提示词正文，不要任何解释、不要引号包裹、不要前缀。{model_hint}"
        )
        optimized = await client.chat(system, f"原始提示词：\n{prompt}", scenario="prompt_optimize", temperature=0.4, max_tokens=800)

    if not optimized or not optimized.strip():
        # AI 不可用：有检索命中就退回最佳命中内容，否则退回原文
        if refs:
            return {"ok": True, "optimized": refs[0]["content"], "source": refs[0]["source"],
                    "matched": refs, "logs": [{"step": "fallback", "message": "AI 不可用，退回检索结果"}]}
        return {"ok": False, "error": "AI 调用失败，且知识库/技能库无匹配"}

    return {
        "ok": True,
        "optimized": optimized.strip(),
        "source": source,
        "matched": [{"title": r["title"], "source": r["source"], "score": r["score"]} for r in refs],
        "logs": [
            {"step": "search", "message": f"知识库命中 {len(kb_hits)} 条、技能库命中 {len(skill_hits)} 条"},
            {"step": "optimize", "message": f"优化来源：{source}（kb=知识库 / skill=技能库 / ai=AI 自行理解）"},
        ],
    }
