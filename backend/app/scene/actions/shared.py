"""场景动作·共享基础（Provider 路由 / LLM 封装 / 剧本解析 / RAG / 任务留痕）。

从 actions.py 拆分而来（2026-08-29），函数实现原样未动。
"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any

from app import db
from app.scene import service
from app.scene.registry import OBJECT_LIBRARY


async def _image_provider() -> dict | None:
    from app.providers.service import best_provider
    return await best_provider("image")


async def _video_provider() -> dict | None:
    from app.providers.service import best_provider
    return await best_provider("video")


async def _chat_full(system: str, user: str, *, json_mode: bool = False,
                     temperature: float = 0.4, max_tokens: int = 2000,
                     model_profile: dict | None = None) -> Any:
    from app.ai.client import chat_full
    return await chat_full(system, user, temperature=temperature, max_tokens=max_tokens,
                           json_mode=json_mode, scenario="scene_action", task_id="",
                           model_profile=model_profile)


async def _record_usage(scene_id: str, result: Any) -> None:
    """把 chat_full 的 usage 落 token_usage_log（P1-07 / §57）。"""
    try:
        usage = (result.usage or {}) if hasattr(result, "usage") else {}
        await db.execute(
            """INSERT INTO token_usage_log
               (model, provider, scenario, prompt_tokens, completion_tokens, task_id, workflow_id)
               VALUES ($1,$2,'scene_action',$3,$4,$5,$6)""",
            str(usage.get("model") or ""), str(usage.get("provider") or ""),
            int(usage.get("prompt_tokens", 0) or 0), int(usage.get("completion_tokens", 0) or 0),
            scene_id, scene_id,
        )
    except Exception:  # noqa: BLE001
        pass


async def _llm_json(system: str, user: str, *, model_profile: dict | None = None,
                    max_tokens: int = 2000) -> dict | None:
    r = await _chat_full(system, user, json_mode=True, model_profile=model_profile,
                         max_tokens=max_tokens)
    await _record_usage("", r)
    if not r.ok or not r.content:
        return None
    m = re.search(r"\{.*\}", r.content, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:  # noqa: BLE001
        return None


async def _llm_text(system: str, user: str, *, model_profile: dict | None = None) -> str | None:
    """注意：走 chat_full 拿 usage（P1-07），返回 content 字符串。"""
    r = await _chat_full(system, user, temperature=0.5, model_profile=model_profile)
    await _record_usage("", r)
    if not r.ok or not r.content:
        return None
    return r.content.strip() or None


async def _siliconflow_profile() -> dict | None:
    """强制取「硅基流动」LLM 配置（剧本格式生成必须用它，deepseek 输出不可控）。

    从 providers 表按名称匹配（硅基流动 / siliconflow），优先挑非 deepseek 的模型
    （Qwen 等格式遵循更好），避免 fallback 又撞回同一个 DeepSeek。
    返回明文 profile 供 chat_full 直连。
    """
    try:
        rows = await db.fetch(
            "SELECT id, name, endpoint, api_key, models FROM providers "
            "WHERE type='llm' AND status='enabled'"
        )
        for r in rows:
            name = str(r["name"] or "").lower()
            if "硅基" in name or "siliconflow" in name:
                models = r["models"]
                if isinstance(models, str):
                    try:
                        models = json.loads(models)
                    except Exception:  # noqa: BLE001
                        models = []
                if not models:
                    continue
                # 优先非 deepseek 模型（格式稳定），兜底用第一个
                pick = next((m for m in models if "deepseek" not in str(m).lower()), models[0])
                return {
                    "api_key": r["api_key"],
                    "base_url": str(r["endpoint"] or "").rstrip("/"),
                    "model": str(pick),
                    "provider": str(r["name"]),
                }
    except Exception:  # noqa: BLE001
        pass
    return None


def _label(obj_type: str) -> str:
    return OBJECT_LIBRARY.get(obj_type, {}).get("label", obj_type)


async def _register_asset(scene_id: str, asset_type: str, url: str, name: str = "", meta: dict | None = None) -> None:
    """生成结果自动进素材库（§37/§38：Asset 与 Canvas Object 解耦，可复用）。"""
    if not url:
        return
    try:
        await service.add_asset_for_scene(scene_id, asset_type, url, name, meta or {})
    except Exception:  # noqa: BLE001
        pass


def _cn_num(n: int) -> str:
    """阿拉伯数字 → 中文数字（1→一 … 10→十），超 10 用阿拉伯。"""
    cn = "一二三四五六七八九十"
    if 1 <= n <= 10:
        return cn[n - 1]
    return str(n)


def _parse_cn_num(s: str) -> int:
    """中文数字 → 阿拉伯（一→1 … 十→10；支持 十一/二十 等简单组合；失败返回 0）。"""
    t = (s or "").strip()
    if t.isdigit():
        return int(t)
    cn = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
    if t in cn:
        return cn[t]
    # 简单组合：十一~十九、二十~九十九（够用）
    if len(t) == 2 and t[0] in cn and t[1] in cn:
        a, b = cn[t[0]], cn[t[1]]
        if a == 10:
            return 10 + b
        return a * 10 + b
    return 0


def _parse_script(script: str) -> dict:
    """把规范剧本 markdown 解析为结构化数据（供前端高亮展示 + 图片/音频/视频节点索引）。

    返回：
      characters: 人物名列表（出场元素）
      props:      道具名列表
      shots:      分镜（原场景）列表，每项含 no/location/time/goal/mood/bgm/duration/
                  shots(镜头[{no,desc}])/dialogue([{speaker,line}])
    """
    parsed: dict = {"characters": [], "props": [], "shots": []}
    if not script:
        return parsed
    # 出场元素：人物 / 道具
    m = re.search(r"# 出场元素(.*?)(?=\n# )", script, re.S)
    if m:
        block = m.group(1)
        mc = re.search(r"-\s*人物[：:]\s*\n((?:\s+-\s*.*\n?)+)", block)
        if mc:
            for line in mc.group(1).splitlines():
                line = line.strip().lstrip("-").strip()
                if line:
                    name = re.split(r"[（(]", line)[0].strip()
                    if name and name not in parsed["characters"]:
                        parsed["characters"].append(name)
        # 同行格式兜底：- 人物：林晓（女，28岁）、陈默（子行列表匹配不到时用；括号内顿号不拆）
        if not parsed["characters"]:
            mp1 = re.search(r"-\s*人物[：:]\s*([^\n]+)", block)
            if mp1:
                pieces: list[str] = []
                cur, depth = "", 0
                for ch in mp1.group(1).strip():
                    if ch in "（(":
                        depth += 1
                    if ch in "）)":
                        depth -= 1
                    if ch in "、,，" and depth == 0:
                        if cur.strip():
                            pieces.append(cur.strip())
                        cur = ""
                    else:
                        cur += ch
                if cur.strip():
                    pieces.append(cur.strip())
                for piece in pieces:
                    name = re.split(r"[（(]", piece)[0].strip()
                    if name and name not in parsed["characters"]:
                        parsed["characters"].append(name)
        # 道具：多行区间（止于 场景/分镜 字段行），括号内顿号逗号不拆（与前端 parsePropsList 对齐）
        props_sec = re.search(r"-\s*道具[：:]\s*([^\n]*)([\s\S]*?)(?=\n\s*-\s*(?:场景|分镜|人物)[：:]|\Z)", block)
        if props_sec:
            raw_lines = props_sec.group(1) + "\n" + props_sec.group(2)
            for raw_line in raw_lines.splitlines():
                line = raw_line.strip().lstrip("-* ").strip()
                if not line:
                    continue
                cur, depth = "", 0
                pieces2: list[str] = []
                for ch in line:
                    if ch in "（(":
                        depth += 1
                    if ch in "）)":
                        depth -= 1
                    if ch in "、,，" and depth == 0:
                        if cur.strip():
                            pieces2.append(cur.strip())
                        cur = ""
                    else:
                        cur += ch
                if cur.strip():
                    pieces2.append(cur.strip())
                for piece in pieces2:
                    if piece and piece not in parsed["props"]:
                        parsed["props"].append(piece)
    # 场景/分镜块：兼容新模板「# 场景一：名称（约 X 秒）」与旧模板「## 分镜N：（地点，时间）」
    for m in re.finditer(r"^#{1,2}\s*(?:场景|分镜)\s*([一二三四五六七八九十\d]+)[：:]?\s*(.*)$", script, re.M):
        no = _parse_cn_num(m.group(1))
        head = m.group(2).strip()
        loc, tm, dur_title = "", "", ""
        mt = re.search(r"（约\s*([\d.]+)\s*秒）", head)
        if mt:
            dur_title = mt.group(1)
            head = head[:mt.start()].strip().rstrip("（（")
        mm = re.search(r"(.+?)[,，]\s*(.+)", head)
        if mm:
            loc, tm = mm.group(1).strip(), mm.group(2).strip()
        elif head:
            loc = head
        start = m.end()
        nxt = re.search(r"^#{1,2}\s*(?:场景|分镜)", script[start:], re.M)
        end = start + nxt.start() if nxt else len(script)
        block = script[start:end]
        shot: dict = {"no": no, "location": loc, "time": tm, "goal": "", "mood": "", "bgm": "",
                      "duration": "", "shots": [], "dialogue": []}
        # 场景目标 / 分镜目标（新旧字段名都认）
        g = re.search(r"-?\s*场景目标[：:]\s*(.+)", block) or re.search(r"-?\s*分镜目标[：:]\s*(.+)", block)
        if g:
            shot["goal"] = g.group(1).strip()
        g = re.search(r"-?\s*情绪基调[：:]\s*(.+)", block)
        if g:
            shot["mood"] = g.group(1).strip()
        g = re.search(r"-?\s*背景音乐[：:]\s*(.+)", block)
        if g:
            shot["bgm"] = g.group(1).strip()
        # 时长：标题（约X秒）优先，其次「- 时长：约X秒」行
        g = re.search(r"-?\s*时长[：:]\s*约?\s*([\d.]+)\s*秒", block)
        shot["duration"] = (g.group(1) if g else dur_title).strip()
        # 关键画面 → 画面列表（兼容无编号「- xxx」与「- 镜头X-1：xxx」；
        # 只取连续「-」行，遇字段行/空行即止，不会串到下一场景）
        gm = re.search(r"-?\s*关键画面[：:]?\s*\n((?:[ \t]*-[ \t]*[^\n]*\n?)*)", block)
        if gm:
            for line in gm.group(1).splitlines():
                d = line.strip().lstrip("-* ").strip()
                if not d:
                    continue
                # 对白区起点：关键画面区到此为止（不吞对白/下一字段）
                if d.startswith("对白"):
                    break
                if re.match(r"^(时长|背景音乐|场景目标|分镜目标|情绪基调|画面正文)[：:]", d):
                    continue
                mm2 = re.match(r"镜头([\d\-]+)[：:]\s*(.+)", d)
                shot["shots"].append({"no": mm2.group(1).strip() if mm2 else "", "desc": mm2.group(2).strip() if mm2 else d})
        # 对白 / 旁白：[旁白] "台词"、角色名（情绪）："台词"、角色名："台词"
        gd = re.search(r"-?\s*对白\s*/\s*旁白[：:]?\s*\n((?:[ \t]*-[ \t]*[^\n]*\n?)*)", block)
        if gd:
            for line in gd.group(1).splitlines():
                line = line.strip()
                if not line or line.startswith("（") or line.startswith("("):
                    continue
                line = line.lstrip("-* ").strip()
                mm4 = re.match(r"(.+?)[（(]([^）)]*)[）)]\s*[：:]\s*[\"“]?(.+?)[\"”]?\s*$", line)
                if mm4:
                    shot["dialogue"].append({"speaker": mm4.group(1).strip(), "emotion": mm4.group(2).strip(), "line": mm4.group(3).strip()})
                    continue
                # [旁白] "台词"（方括号标记 + 引号台词，无冒号）
                mm6 = re.match(r"^\[([^\[\]]+)\]\s*[\"“]?(.+?)[\"”]?\s*$", line)
                if mm6:
                    shot["dialogue"].append({"speaker": f"[{mm6.group(1).strip()}]", "emotion": "", "line": mm6.group(2).strip()})
                    continue
                mm5 = re.match(r"(.+?)[：:]\s*[\"“]?(.+?)[\"”]?\s*$", line)
                if mm5:
                    shot["dialogue"].append({"speaker": mm5.group(1).strip(), "emotion": "", "line": mm5.group(2).strip()})
        # 说话人归入人物（[旁白]/[对白] 等标记不算人物）
        for d in shot["dialogue"]:
            sp = d.get("speaker", "").strip().strip("[]【】")
            if sp and sp not in ("旁白", "画外音", "对白", "音效", "环境音") and sp not in parsed["characters"]:
                parsed["characters"].append(sp)
        parsed["shots"].append(shot)
    return parsed


async def _story_quality_context(query: str, params: dict) -> str:
    """剧本质量增强上下文（V2.9l）：技能库（skill_ref 指定 SKILL.md 指令）+ 知识库（RAG 语义检索）。

    注入后 LLM 会参考技能指令与知识库资料组织画面描述，避免提示词空泛简化。
    """
    parts: list[str] = []
    sid = str(params.get("skill_ref") or "").strip()
    if sid:
        try:
            from app.skills import skill_manager
            entry = skill_manager.get(sid)
            if entry and entry.content:
                body = entry.content
                if body.startswith("---"):
                    idx = body.find("---", 3)
                    if idx > 0:
                        body = body[idx + 3:].strip()
                if body.strip():
                    parts.append(f"【技能指令参考】\n{body[:1000]}")
        except Exception:  # noqa: BLE001
            pass
    try:
        refs = await _rag_retrieve(str(query)[:150], limit=4)
        if refs:
            parts.append("【知识库参考】\n" + "\n".join(refs))
    except Exception:  # noqa: BLE001
        pass
    return "\n\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# RAG 检索注入（P1-04 / §43）
# ─────────────────────────────────────────────────────────────────────────────

def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    import math
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


async def _embed(text: str) -> list[float] | None:
    """调用 embedding Provider 获取向量（深度增强 #2：RAG 真向量）。

    🔴 不走 best_provider：其 _row_to_provider 会把 api_key 脱敏（mask_key），
    拿到的 key 无效（401）。这里直接从 providers 表取明文 key 直连。
    """
    try:
        import httpx
        from app.db import get_pool
        pool = await get_pool()
        row = await pool.fetchrow(
            "SELECT endpoint, api_key, models FROM providers "
            "WHERE type='embedding' AND status='enabled' "
            "ORDER BY (health->>'quality_score')::float DESC NULLS LAST LIMIT 1"
        )
        if not row:
            return None
        endpoint = str(row["endpoint"] or "").rstrip("/")
        raw_key = str(row["api_key"] or "")
        if not endpoint or not raw_key:
            return None
        models = row["models"] or []
        if isinstance(models, str):
            try:
                models = json.loads(models)
            except Exception:  # noqa: BLE001
                models = []
        model = str(models[0]) if models else "text-embedding-v3"
        headers = {"Authorization": f"Bearer {raw_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(f"{endpoint}/embeddings",
                             json={"model": model, "input": text[:800]}, headers=headers)
            if r.status_code == 200:
                emb = (r.json().get("data") or [{}])[0].get("embedding")
                if isinstance(emb, list) and emb:
                    return [float(x) for x in emb]
    except Exception:  # noqa: BLE001
        pass
    return None


async def _rag_retrieve(query: str, limit: int = 3) -> list[str]:
    """语义检索优先（embedding 余弦），无向量则回退 ILIKE 关键词（§43 深度）。"""
    if not query:
        return []
    qv = await _embed(query)
    if qv:
        try:
            rows = await db.fetch(
                "SELECT title, content, embedding FROM prompt_knowledge WHERE embedding IS NOT NULL LIMIT 300"
            )
            scored = []
            for r in rows:
                ev = r.get("embedding")
                if not ev:
                    continue
                try:
                    ev = [float(x) for x in ev]
                except Exception:  # noqa: BLE001
                    continue
                sim = _cosine(qv, ev)
                if sim > 0.3:
                    scored.append((sim, r["title"], str(r["content"])))
            scored.sort(key=lambda x: -x[0])
            if scored:
                return [f"【{t}】{c[:200]}" for _, t, c in scored[:limit]]
        except Exception:  # noqa: BLE001
            pass
    # 2) 回退：关键词 ILIKE（拆词 OR 匹配，任意词命中即返回）
    try:
        words = [w for w in re.split(r"[\s,，。、;；:：]+", query) if len(w) >= 2][:8]
        conds: list[str] = []
        args: list[Any] = []
        for w in words:
            args.extend([f"%{w}%", f"%{w}%"])
            conds.append(f"(content ILIKE ${len(args) - 1} OR title ILIKE ${len(args)})")
        if not conds:
            return []
        args.append(limit)
        rows = await db.fetch(
            f"SELECT title, content FROM prompt_knowledge WHERE {' OR '.join(conds)} "
            f"ORDER BY created_at DESC LIMIT ${len(args)}",
            *args,
        )
        return [f"【{r['title']}】{str(r['content'])[:200]}" for r in rows]
    except Exception:  # noqa: BLE001
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Task 留痕（P1-05 / §53）
# ─────────────────────────────────────────────────────────────────────────────

async def _log_task(scene_id: str, action: str, status: str) -> None:
    try:
        tid = "task_" + uuid.uuid4().hex[:16]
        await db.execute(
            """INSERT INTO tasks (id, canvas_id, project_id, type, status)
               VALUES ($1,$2,'default',$3,$4)""",
            tid, scene_id, action, status,
        )
    except Exception:  # noqa: BLE001
        pass


# ─────────────────────────────────────────────────────────────────────────────
# 短剧补全（§69）：配音稿 / 字幕 / 成片合成
# ─────────────────────────────────────────────────────────────────────────────

def _shot_bgm(script: str, shot_no: int) -> str:
    """从剧本 script 提取指定分镜的背景音乐描述（按分镜标题切片，末行无需换行）。"""
    if not script:
        return ""
    m = re.search(rf"##\s*分镜{shot_no}[：:]?\s*[^\n]*\n", script)
    if not m:
        return ""
    start = m.end()
    nxt = re.search(r"\n##\s*分镜", script[start:])
    block = script[start:start + (nxt.start() if nxt else len(script))]
    g = re.search(r"-?\s*背景音乐[：:]\s*([^\n]+)", block)
    return g.group(1).strip() if g else ""
