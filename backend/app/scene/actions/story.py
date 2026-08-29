"""场景动作·剧情与分镜（剧本生成 / 故事生成 / 全字段分镜 / AI 智能引入）。

从 actions.py 拆分而来（2026-08-29），函数实现原样未动。
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.scene import service
from app.scene.registry import OBJECT_LIBRARY

from app.scene.actions.shared import (
    _chat_full,
    _cn_num,
    _label,
    _llm_json,
    _parse_script,
    _rag_retrieve,
    _record_usage,
    _siliconflow_profile,
    _story_quality_context,
)


# ─────────────────────────────────────────────────────────────────────────────
# 剧本生成（剧本 Agent：格式约束 + 分镜/人物/道具/BGM/对白关键词，供节点索引）
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_FORMAT = """# 视频剧本：{片名}

# 项目设定
- 视频类型：（产品广告 / 剧情短剧 / 种草视频）
- 总时长：（秒）
- 目标受众：（人群画像）
- 情感基调：（贯穿全片的情绪，如 苍凉、震撼、充满希望的史诗感）
- 叙事结构：（如 三幕式 / 线性 / 反转）
- 假设/补全：（补齐角色设定、核心转折点、视觉风格等创作假设，如"设定主角为…；核心转折点设定为…；视觉风格设定为…"）

# 出场元素
- 人物：（姓名，一句话角色定位）
- 道具：（关键器物，逗号分隔）
- 场景：（场景名列表，用 / 分隔，如 死寂荒原 / 战舰废墟 / 曙光地平线）

# 故事大纲
（1-2 句话概括全片）

# 情绪曲线
（如 苍凉 → 震撼 → 坚定，用箭头串起各阶段情绪）

# 场景剧本
按总时长拆成 3-5 个场景，每个场景必须包含，关键画面可拆多条：
# 场景一：{场景名}（约 X 秒）
- 场景目标：（本场景要达成的叙事目标）
- 情绪基调：（本场景情绪）
- 背景音乐：（每个场景必须单独编排专属 BGM，按该场景的场景与情绪基调描述音乐类型/节奏/风格，如"低沉弦乐+风声采样"；禁止省略、禁止写"无"、禁止照抄上一场景）
- 画面正文：（2-4 句场景描述正文，交代环境与人物动作，供生成场景图/镜头参考）
- 关键画面（每行一条，直接列画面内容，无需编号）：
  - （画面描述，如 漫天黄沙中半埋在沙丘里的巨型战舰残骸全景）
  - （画面描述）
- 对白 / 旁白：
  - [旁白] "台词"（或 [角色名] "台词"，无则省略）

# 整体节奏与风格说明
（节奏/转场/BGM/色调/镜头语言）

# 核心信息点对应
（把核心卖点/信息点逐一对应到具体场景，如 "末日荒原的史诗感：在场景一通过巨型战舰残骸与漫天风沙的宏大画面传达"）"""


async def _act_llm_scene(scene_id: str, obj_ids: list[str], params: dict, action: str) -> dict:
    """通用 LLM 生成类动作（人物/场景/分镜/批量文案等；generate_story 已独立实现）。"""
    sys_map = {
        "generate_story": "你是短剧编剧。根据商品/主题生成 1 段带货短剧剧情梗概（200 字内），输出 JSON：{\"title\":\"\",\"summary\":\"\",\"text\":\"\"}。",
        "generate_characters": "你是角色设计师。根据剧情生成 2-3 个角色，输出 JSON：{\"characters\":[{\"name\":\"\",\"role\":\"\",\"appearance\":\"\"}]}。",
        "generate_scenes": "你是场景设计师。根据剧情生成 3-5 个拍摄场景，输出 JSON：{\"scenes\":[{\"scene_no\":1,\"location\":\"\",\"time\":\"\",\"lighting\":\"\",\"description\":\"\"}]}。",
        "generate_storyboard": "你是分镜师。根据场景生成分镜列表，输出 JSON：{\"storyboards\":[{\"scene\":1,\"shot\":1,\"duration\":4,\"description\":\"\",\"dialogue\":\"\",\"camera\":\"medium shot\",\"motion\":\"push\"}]}。",
    }
    sys = sys_map.get(action, "你是内容创作助手，按用户要求生成结构化 JSON。")
    # 取场景上下文（第一个 product / story 文本）
    ctx = ""
    for o in await service.list_objects(scene_id):
        dd = o["data"]
        if dd.get("text") or dd.get("summary") or dd.get("description") or dd.get("name"):
            ctx = dd.get("text") or dd.get("summary") or dd.get("description") or dd.get("name")
            break
    refs = await _rag_retrieve(str(ctx)[:40])
    prompt = f"主题/参考：{ctx}\n额外要求：{params.get('prompt','')}"
    if refs:
        prompt += "\n\n参考资料（RAG）：\n" + "\n".join(refs)
    r = await _llm_json(sys, prompt)
    if not r:
        return {"ok": False, "error": "AI 生成失败（检查 AI 配置）"}
    # 新对象自动错开排布，避免全部堆在 (0,0)
    existing = await service.list_objects(scene_id)
    base_y = max([float(o.get("y") or 0) + float(o.get("height") or 0) for o in existing] or [0]) + 80
    row_map = {"generate_story": ("story", [r] if r.get("text") else []),
               "generate_characters": ("character", r.get("characters", [])),
               "generate_scenes": ("scene", r.get("scenes", [])),
               "generate_storyboard": ("storyboard", r.get("storyboards", []))}
    obj_type, items = row_map.get(action, ("text", []))
    meta = OBJECT_LIBRARY.get(obj_type, {})
    created = []
    for idx, item in enumerate(items):
        payload = {**dict(meta.get("default_data") or {}), **(item if isinstance(item, dict) else {})}
        nid = await service.create_object(scene_id, obj_type,
                                         x=idx * 320, y=base_y,
                                         width=300, height=240, data=payload)
        created.append(nid)
    return {"ok": bool(created), "created": created,
            "message": f"生成 {len(created)} 个{_label(obj_type)}"}


async def _act_generate_story(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """围绕商品为主角生成规范化带货剧本（剧本 Agent：格式约束在系统提示词，
    模型用前端选中的 profile——任何模型都按 SCRIPT_FORMAT 输出）。

    商品上下文（链接/SKU/主图/信息）注入提示词 → AI 按链接/SKU/图片搜集并组织商品信息，
    以商品为主角编带货短剧。结果写回 story 的 script（全文）+ parsed（结构化，供节点索引）。
    """
    # 1) 商品上下文：场景内第一个商品（或用户选中对象是商品）
    product_ctx = ""
    for o in await service.list_objects(scene_id):
        if o["object_type"] == "product":
            d = o["data"]
            product_ctx = (f"商品名称：{d.get('name','')}\n商品链接：{d.get('product_url','')}\n"
                           f"SKU：{d.get('sku','')}\n主图：{d.get('main_image','')}\n"
                           f"商品信息：{d.get('info','') or d.get('marketing_plan','')}")
            break
    # 2) 剧情节点已有文本（用户想法）
    story_text = ""
    for oid in (obj_ids or []):
        obj = await service.get_object(oid)
        if obj and obj["object_type"] == "story":
            story_text = obj["data"].get("text", "") or obj["data"].get("summary", "")
            break
    sys = ("你是顶级带货短剧编剧。围绕商品作为主角创作完整剧本。"
           f"严格按以下 Markdown 结构输出（不要 JSON、不要开场白、不要额外解释）：\n\n{SCRIPT_FORMAT}"
           "\n\n【画面质量硬要求】画面正文与关键画面必须具体、电影级：明确景别、光线、色彩、材质、构图与氛围，"
           "每一句都要有画面感，可直接作为文生图/文生视频提示词使用；禁止空泛概括（如'展现氛围''体现情感'）。")
    user = f"商品信息（请结合链接/SKU/主图/信息组织商品背景）：\n{product_ctx or '（无商品，创作普通剧情短剧）'}"
    if story_text:
        user += f"\n\n用户已有剧情想法：\n{story_text}"
    # 总时长 / 分镜个数：从节点输入框取值，注入硬约束（前端 actionRoute 传 duration/shotCount）
    timing_ctx = ""
    try:
        dur = float(params.get("duration") or 0)
    except (TypeError, ValueError):
        dur = 0
    try:
        cnt = int(params.get("shotCount") or 0)
    except (TypeError, ValueError):
        cnt = 0
    if dur > 0 or cnt > 0:
        timing_ctx = "【时长与分镜硬约束（必须严格执行）】"
        if dur > 0:
            timing_ctx += (f" 总时长必须严格为 {dur:.0f} 秒，"
                           f"所有分镜时长之和必须等于 {dur:.0f} 秒（误差不超过 ±2 秒）")
        if cnt > 0:
            timing_ctx += f" 分镜个数必须严格为 {cnt} 个"
            if dur > 0:
                timing_ctx += f"，每段约 {dur / cnt:.1f} 秒"
            timing_ctx += "，禁止多拆或合并"
        if cnt > 0:
            timing_ctx += f"；每个分镜的时长都必须标注"
    if timing_ctx:
        user += f"\n\n{timing_ctx}"
    extra = str(params.get("prompt") or "").strip()
    if extra:
        user += f"\n\n额外要求：{extra}"
    # 技能库 + 知识库内容注入（V2.9l：提升画面描述/提示词质量）
    qctx = await _story_quality_context(user, params)
    if qctx:
        user += f"\n\n{qctx}"
    # 模型：用前端选中的 profile（剧本 Agent 的格式约束在系统提示词，任何模型按格式输出）
    prof = None
    pid = str(params.get("profile_id") or "").strip()
    if pid:
        try:
            from app.ai import config as ai_config
            prof = ai_config.get_profile(pid)
        except Exception:  # noqa: BLE001
            prof = None
    r = await _chat_full(sys, user, temperature=0.7, max_tokens=6000, model_profile=prof)
    await _record_usage("", r)
    if not r.ok or not r.content:
        return {"ok": False, "error": "剧本生成失败（请检查 AI 配置 / 所选模型）"}
    script = r.content.strip()
    # 2.5) 格式校验：分镜 <3、或用户给定分镜数/总时长而结果不匹配（DeepSeek 常见），
    #      判定"没按模版"→ 自动换「格式最稳的可用模型」（硅基流动非 deepseek）重试一次
    parsed = _parse_script(script)

    def _durations_total(shots: list[dict]) -> float:
        """分镜时长总和（解析失败/缺失计 0）。"""
        total = 0.0
        for sh in shots:
            try:
                total += float(sh.get("duration") or 0)
            except (TypeError, ValueError):
                pass
        return total

    def _timing_ok(shots: list[dict]) -> bool:
        if cnt > 0 and not (cnt - 1 <= len(shots) <= cnt + 1):
            return False
        if dur > 0:
            total = _durations_total(shots)
            # 各分镜都标了时长才校验总和（防止只缺一两个导致误判）
            marked = sum(1 for sh in shots if sh.get("duration"))
            if marked >= len(shots) and len(shots) > 0:
                if abs(total - dur) > max(4.0, dur * 0.2):
                    return False
        return True

    if len(parsed["shots"]) < 3 or not _timing_ok(parsed["shots"]):
        fb = await _siliconflow_profile()
        if fb and (prof is None or str(fb.get("model")) != str((prof or {}).get("model"))):
            r2 = await _chat_full(sys, user, temperature=0.4, max_tokens=6000, model_profile=fb)
            await _record_usage("", r2)
            if r2.ok and r2.content:
                script2 = r2.content.strip()
                parsed2 = _parse_script(script2)
                if (len(parsed2["shots"]) > len(parsed["shots"])
                        or (len(parsed2["shots"]) >= 3 and not _timing_ok(parsed["shots"])
                            and _timing_ok(parsed2["shots"]))):
                    script, parsed = script2, parsed2
    # 3) 提取标题/梗概（分镜/人物/道具/BGM/对白已由 _parse_script 解析）
    title = ""
    summary = ""
    m = re.search(r"# 故事大纲\s*\n(.*?)(?=\n# )", script, re.S)
    if m:
        summary = m.group(1).strip()
    m2 = re.search(r"# 项目设定\s*\n- 视频类型：(.+)", script)
    if m2:
        title = f"{m2.group(1).strip()}·商品短剧"
    # 4) 写回/创建 story 对象 —— 优先写回「当前触发生成的节点」（obj_ids 里第一个 story），
    #    而不是场景里第一个 story：并发多剧本同时生成时，若都写 targets[0] 会互相覆盖、
    #    导致结果莫名消失/内容被替换（阿勇 2026-08-27 反馈）
    write_oid = None
    for oid in (obj_ids or []):
        o0 = await service.get_object(oid)
        if o0 and o0["object_type"] == "story":
            write_oid = oid
            break
    if not write_oid:
        targets = [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] == "story"]
        write_oid = targets[0] if targets else None
    if write_oid:
        obj = await service.get_object(write_oid)
        await service.update_object(write_oid, data={**obj["data"], "script": script, "parsed": parsed,
                                                     "text": summary or script[:500],
                                                     "summary": summary, "title": title or obj["data"].get("title", "")})
        created = [write_oid]
    else:
        existing = await service.list_objects(scene_id)
        base_y = max([float(o.get("y") or 0) + float(o.get("height") or 0) for o in existing] or [0]) + 80
        nid = await service.create_object(scene_id, "story", x=320, y=base_y, width=420, height=520,
                                          data={"title": title, "summary": summary, "text": summary or script[:500],
                                                "script": script, "parsed": parsed})
        created = [nid]
    return {"ok": True, "created": created, "script": script,
            "summary": summary or "", "parsed": parsed,
            "message": f"剧本生成完成 · 解析出 {len(parsed['shots'])} 个分镜 / {len(parsed['characters'])} 个人物 / {len(parsed['props'])} 个道具"}


async def _act_generate_story_from_text(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """影视拉片（文案驱动）：从「文本」节点取原始故事/文案 → AI 生成三幕式故事结构。

    故事输入优先级：选中文本节点 > 场景内文本节点 > story 节点已有 text > 底部 AI 框 prompt。
    输出三幕结构 + 情绪曲线 + 人物/场景/道具资产，写回 story 节点 data。
    """
    # 1) 收集原始故事文本
    raw_parts: list[str] = []
    for oid in (obj_ids or []):
        obj = await service.get_object(oid)
        if not obj:
            continue
        if obj["object_type"] == "text":
            t = str(obj["data"].get("text") or "").strip()
            if t:
                raw_parts.append(f"【原始文本】\n{t}")
        elif obj["object_type"] == "story":
            t = str(obj["data"].get("text") or "").strip() or str(obj["data"].get("summary") or "").strip()
            if t:
                raw_parts.append(f"【故事草稿】\n{t}")
    if not raw_parts:
        for o in await service.list_objects(scene_id):
            if o["object_type"] == "text":
                t = str(o["data"].get("text") or "").strip()
                if t:
                    raw_parts.append(f"【原始文本】\n{t}")
                    break
    extra = str(params.get("prompt") or "").strip()
    if extra:
        raw_parts.append(f"【创作要求】\n{extra}")
    if not raw_parts:
        return {"ok": False, "error": "没有找到可用的原始故事文本——请先放一个「文本」节点并写入故事/文案，或选中文本节点后重试"}
    raw = "\n\n".join(raw_parts)

    # 时长/分镜数硬约束：params 优先（前端按钮传），其次 story 节点 data（InlineAiBar 配置）
    def _to_num(v, t=float) -> float:
        try:
            return t(v or 0)
        except (TypeError, ValueError):
            return 0
    dur_cfg = _to_num(params.get("duration"))
    cnt_cfg = int(_to_num(params.get("shotCount"), int))
    if not dur_cfg and not cnt_cfg:
        for oid in (obj_ids or []):
            o0 = await service.get_object(oid)
            if o0 and o0["object_type"] == "story":
                dur_cfg = _to_num(o0["data"].get("duration"))
                cnt_cfg = int(_to_num(o0["data"].get("shotCount"), int))
                break
    if not dur_cfg and not cnt_cfg:
        for o in await service.list_objects(scene_id):
            if o["object_type"] == "story":
                dur_cfg = _to_num(o["data"].get("duration"))
                cnt_cfg = int(_to_num(o["data"].get("shotCount"), int))
                break
    # 约束文本注入系统提示词（与 _act_generate_story 同款口径）
    timing_ctx = ""
    if dur_cfg > 0 or cnt_cfg > 0:
        timing_ctx = "【时长与场景硬约束（必须严格执行）】"
        if dur_cfg > 0:
            timing_ctx += (f" 总时长必须严格为 {dur_cfg:.0f} 秒，target_duration 填 {dur_cfg:.0f}；"
                           f"所有场景时长之和必须等于 {dur_cfg:.0f} 秒（误差不超过 ±2 秒）")
        if cnt_cfg > 0:
            timing_ctx += f" 场景个数必须严格为 {cnt_cfg} 个（一个不多一个不少，禁止多拆或合并）"
            if dur_cfg > 0:
                timing_ctx += f"，每段约 {dur_cfg / cnt_cfg:.1f} 秒"
    if timing_ctx:
        raw += f"\n\n{timing_ctx}"
    # 技能库 + 知识库内容注入（V2.9l：提升场景/画面描述质量）
    qctx = await _story_quality_context(raw, params)
    if qctx:
        raw += f"\n\n{qctx}"

    sys = (
        "你是资深影视编剧。根据给定的原始故事/文案，创作一部影视短片的故事方案。"
        "严格只输出 JSON，结构如下：\n"
        '{\n'
        '  "title": "片名",\n'
        '  "genre": "类型(如科幻/悬疑/情感)",\n'
        '  "theme": "核心主题",\n'
        '  "target_duration": "目标时长(秒)",\n'
        '  "audience": "目标受众(人群画像)",\n'
        '  "emotion_tone": "情感基调(如苍凉、震撼、充满希望的史诗感)",\n'
        '  "structure": "叙事结构(如三幕式)",\n'
        '  "assumptions": "假设/补全(角色设定、核心转折点、视觉风格等创作假设)",\n'
        '  "story_summary": "故事梗概(150字内)",\n'
        '  "emotion_curve": [{"phase": "阶段名", "emotion": "情绪(如苍凉/震撼/坚定)"}],\n'
        '  "characters": [{"name": "人物名", "appearance": "外貌", "personality": "性格", "description": "角色定位"}],\n'
        '  "scenes": [{"name": "场景氛围标题(如 霓虹追踪)", "location": "实际拍摄地点(必须是具体可拍摄的地点名，如 步行街/小巷；禁止用氛围词)", "duration": 15, "goal": "场景目标", "mood": "情绪基调", '
        '"bgm": "背景音乐(按场景与情绪描述音乐类型/节奏/风格)", "body": "画面正文(2-4句场景描述)", '
        '"key_frames": ["关键画面1", "关键画面2"], "dialogue": ["[旁白] \\"台词\\" 或 [角色名] \\"台词\\""]}],\n'
        '  "props": [{"name": "道具名(必须是可被拿起/使用的实体物品，如 奶茶/手机/钱包/雨伞；禁止把装饰性细节或材质状态如 口红印吸管/捏瘪的奶茶杯 当道具；无道具给空数组)", "description": "作用描述"}],\n'
        '  "rhythm": "整体节奏与风格说明(节奏/转场/BGM/色调/镜头语言)",\n'
        '  "info_points": [{"point": "核心信息点", "scene": "对应场景名"}]\n'
        "}\n"
        "要求：3-5 个场景、各场景时长之和≈总时长、场景目标/情绪基调/背景音乐/画面正文/关键画面/对白旁白完整；"
        "情绪曲线有起伏；人物/场景/道具贴合原始故事；全部用中文。"
        "\n\n【画面质量硬要求】画面正文(body)与关键画面(key_frames)必须具体、电影级："
        "明确景别、光线、色彩、材质、构图与氛围（如'逆光下灰蓝色荒漠，风沙在镜头前形成纱幕'），"
        "每一句都要有画面感，可直接作为文生图/文生视频提示词使用；禁止空泛概括（如'展现氛围''体现情感'）。"
    )
    # 新模板 schema 含场景级字段（目标/基调/BGM/正文/关键画面/对白/节奏/信息点），
    # 输出体量大，2000 tokens 会被截断导致 JSON 解析失败 → 放 6000
    r = await _llm_json(sys, raw, max_tokens=6000)
    if not r:
        return {"ok": False, "error": "故事生成失败（请检查 AI 配置）"}
    title = str(r.get("title") or "")
    summary = str(r.get("story_summary") or "")
    emotion_curve = r.get("emotion_curve") or []
    characters = r.get("characters") or []
    scenes = r.get("scenes") or []
    props = r.get("props") or []

    # 故事正文：按《荒原星火》模板渲染 markdown（供剧本编辑/场景索引/分镜链接）
    def _fmt_scenes() -> str:
        lines: list[str] = []
        for i, s in enumerate(scenes or []):
            if not isinstance(s, dict):
                continue
            dur = str(s.get("duration") or "")
            lines.append(f"# 场景{_cn_num(i + 1)}：{str(s.get('name') or s.get('location') or f'场景{i + 1}')}"
                         + (f"（约 {dur} 秒）" if dur else ""))
            lines.append(f"- 场景目标：{str(s.get('goal') or '')}")
            lines.append(f"- 情绪基调：{str(s.get('mood') or '')}")
            lines.append(f"- 背景音乐：{str(s.get('bgm') or '')}")
            body = str(s.get("body") or "")
            if body:
                lines.append(f"- 画面正文：{body}")
            frames = s.get("key_frames") or []
            lines.append("- 关键画面：")
            for f in frames:
                if str(f).strip():
                    lines.append(f"  - {f}")
            dlg = s.get("dialogue") or []
            lines.append("- 对白 / 旁白：")
            for d in dlg:
                if str(d).strip():
                    lines.append(f"  - {d}")
        return "\n".join(lines)

    def _fmt_list(items: list, template: str) -> str:
        out: list[str] = []
        for it in items or []:
            if not isinstance(it, dict):
                continue
            out.append(template.format_map({k: str(v or "") for k, v in it.items()}))
        return "、".join(out)

    chars_line = _fmt_list(characters, "{name}（{description}）") or ""
    props_line = _fmt_list(props, "{name}") or ""
    scenes_line = " / ".join(str(s.get("name") or s.get("location") or "") for s in (scenes or []) if isinstance(s, dict) and (s.get("name") or s.get("location")))
    curve_line = " → ".join(f"{c.get('phase') or ''}{c.get('emotion') or ''}" for c in (emotion_curve or []) if isinstance(c, dict) and (c.get("phase") or c.get("emotion")))
    if not curve_line:
        curve_line = " → ".join(f"{c.get('emotion') or ''}" for c in (emotion_curve or []) if isinstance(c, dict) and c.get("emotion"))
    info_lines = []
    for ip in (r.get("info_points") or []):
        if isinstance(ip, dict) and (ip.get("point") or ip.get("scene")):
            info_lines.append(f"- {str(ip.get('point') or '')}：在{str(ip.get('scene') or '')}通过场景画面传达")
    story = f"# 视频剧本：{title or '未命名'}\n\n"
    story += "# 项目设定\n"
    story += f"- 视频类型：{str(r.get('genre') or '')}\n"
    story += f"- 总时长：{str(r.get('target_duration') or '')} 秒\n"
    story += f"- 目标受众：{str(r.get('audience') or '')}\n"
    story += f"- 情感基调：{str(r.get('emotion_tone') or '')}\n"
    story += f"- 叙事结构：{str(r.get('structure') or '')}\n"
    story += f"- 假设/补全：{str(r.get('assumptions') or '')}\n\n"
    story += "# 出场元素\n"
    story += f"- 人物：{chars_line}\n"
    story += f"- 道具：{props_line}\n"
    story += f"- 场景：{scenes_line}\n\n"
    story += f"# 故事大纲\n{summary}\n\n"
    story += f"# 情绪曲线\n{curve_line}\n\n"
    story += "# 场景剧本\n" + _fmt_scenes() + "\n\n"
    story += f"# 整体节奏与风格说明\n{str(r.get('rhythm') or '')}\n\n"
    story += "# 核心信息点对应\n" + ("\n".join(info_lines) if info_lines else "- 无") + "\n"

    # 场景时长归一化：配置了总时长 → 各场景时长之和强制对齐配置值（AI 输出可能有偏差）
    if dur_cfg > 0 and isinstance(scenes, list) and scenes:
        try:
            total = sum(float(s.get("duration") or 0) for s in scenes if isinstance(s, dict))
            if total > 0 and abs(total - dur_cfg) > 0.5:
                scale = dur_cfg / total
                for s in scenes:
                    if isinstance(s, dict):
                        s["duration"] = max(1, round(float(s.get("duration") or 0) * scale))
                diff = dur_cfg - sum(float(s.get("duration") or 0) for s in scenes if isinstance(s, dict))
                for s in reversed(scenes):
                    if isinstance(s, dict) and diff:
                        s["duration"] = max(1, int(float(s["duration"])) + int(diff))
                        break
        except Exception:  # noqa: BLE001
            pass

    # 2) 写回 story 节点（优先当前触发的 story；没有则找场景内第一个；再没有则新建）
    write_oid = None
    for oid in (obj_ids or []):
        o0 = await service.get_object(oid)
        if o0 and o0["object_type"] == "story":
            write_oid = oid
            break
    if not write_oid:
        targets = [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] == "story"]
        write_oid = targets[0] if targets else None
    created: list[str] = []
    # 新模板无 three_act_structure，改存 narrative（叙事结构说明）+ 其余结构化字段
    narrative = str(r.get("structure") or r.get("theme") or "")
    if write_oid:
        obj = await service.get_object(write_oid)
        await service.update_object(write_oid, data={
            **obj["data"],
            "title": title, "summary": summary, "text": str(r.get("story_summary") or summary or raw)[:800],
            "script": story, "story": story,
            "narrative": narrative, "emotion_curve": emotion_curve,
            "characters": characters, "scenes": scenes, "props": props,
            "duration": dur_cfg or int(_to_num(obj["data"].get("duration"))),
            "shotCount": cnt_cfg or int(_to_num(obj["data"].get("shotCount"), int)),
        })
        created = [write_oid]
    else:
        existing = await service.list_objects(scene_id)
        base_y = max([float(o.get("y") or 0) + float(o.get("height") or 0) for o in existing] or [0]) + 80
        nid = await service.create_object(scene_id, "story", x=360, y=base_y, width=420, height=560,
                                          data={"title": title, "summary": summary,
                                                "text": summary or raw[:500], "script": story, "story": story,
                                                "narrative": narrative, "emotion_curve": emotion_curve,
                                                "characters": characters, "scenes": scenes, "props": props})
        created = [nid]
    return {"ok": True, "created": created, "title": title, "summary": summary,
            "narrative": narrative, "emotion_curve": emotion_curve,
            "characters": characters, "scenes": scenes, "props": props,
            "message": f"故事剧本生成完成 · 人物 {len(characters)} / 场景 {len(scenes)} / 道具 {len(props)}"}


async def _act_generate_storyboard(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """影视拉片（文案驱动）：从 story 节点取三幕式故事 → AI 生成全字段分镜表。

    每镜输出（对齐 D:/分镜.pdf 模板 13 列 + 生成字段）：
      镜号/时长/画面描述/景别/角色/场景/道具/光影/音效/对白/旁白/分镜提示词/镜头控制描述
      + 焦距/机位/构图/色调/动作/情绪（供视频生成）
    严格遵循 story 节点 data.duration（总时长）与 data.shotCount（分镜个数）约束。
    写回目标：优先当前编辑的 storyboard 节点（data.shots，前端读取键）；
    无 storyboard 节点时写回 story 节点（data.storyboard，兼容旧端）。
    """
    # 1) 取故事上下文 + 时长/分镜数约束；区分 上下文来源(story) 与 写回目标(storyboard)
    story_ctx = ""
    story_oid = None
    write_oid = None
    write_is_storyboard = False
    duration = 0
    shot_count = 0
    asset_hint = ""

    def _read_story(obj: dict) -> None:
        nonlocal story_ctx, duration, shot_count, asset_hint
        d = obj["data"]
        story_ctx = (str(d.get("script") or "") or str(d.get("story") or "")
                     or str(d.get("summary") or "") or str(d.get("text") or "")).strip()
        try:
            duration = int(float(d.get("duration") or 0))
        except Exception:  # noqa: BLE001
            duration = 0
        try:
            shot_count = int(float(d.get("shotCount") or 0))
        except Exception:  # noqa: BLE001
            shot_count = 0
        # V2.9g：构建「全局资产表」——人物/实际地点/道具清单，约束分镜的实体字段
        #   （LLM 常把 scene 填成镜头氛围词、把文学细节当道具，用资产表根治）
        def _names(v: Any) -> list[str]:
            out: list[str] = []
            for item in (v or []):
                if isinstance(item, dict):
                    nm = str(item.get("name") or "").strip()
                    if nm:
                        out.append(nm)
                elif isinstance(item, str):
                    nm = item.strip()
                    if nm:
                        out.append(nm)
            return out

        chars = _names(d.get("characters"))
        # 地点：scenes[].location 优先（真实拍摄地点），name 仅作氛围名不用于地点
        locs: list[str] = []
        for item in (d.get("scenes") or []):
            if isinstance(item, dict):
                loc = str(item.get("location") or "").strip()
                if loc and loc != "-" and loc not in locs:
                    locs.append(loc)
        props = _names(d.get("props"))
        parts = []
        if chars:
            parts.append(f"人物：{'、'.join(chars)}")
        if locs:
            parts.append(f"地点：{'、'.join(locs)}")
        if props:
            parts.append(f"道具：{'、'.join(props)}")
        if parts:
            asset_hint = "【故事已确定的资产清单（必须严格遵守）】\n" + "\n".join(parts)

    for oid in (obj_ids or []):
        obj = await service.get_object(oid)
        if not obj:
            continue
        ot = obj["object_type"]
        if ot == "story" and not story_ctx:
            story_oid = oid
            _read_story(obj)
        elif ot == "storyboard":
            # 当前编辑的分镜脚本节点 → 写回目标
            write_oid = oid
            write_is_storyboard = True
        if story_oid and write_oid:
            break
    if not story_ctx:
        for o in await service.list_objects(scene_id):
            if o["object_type"] == "story":
                story_oid = o["id"]
                _read_story(o)
                break
    if not story_ctx:
        return {"ok": False, "error": "没有可用的故事——请先「从文本生成故事」或填写剧情节点"}
    if not write_oid:
        # 无显式分镜节点：优先场景内已存在的 storyboard 节点，其次 story 节点（旧行为）
        for o in await service.list_objects(scene_id):
            if o["object_type"] == "storyboard":
                write_oid = o["id"]
                write_is_storyboard = True
                break
        if not write_oid and story_oid:
            write_oid = story_oid
    extra = str(params.get("prompt") or "").strip()
    if extra:
        story_ctx += f"\n\n【创作要求】{extra}"
    # V2.9g：全局资产表注入（人物/地点/道具强约束，杜绝氛围词当场景、细节当道具）
    if asset_hint:
        story_ctx += f"\n\n{asset_hint}\n"
    # 技能库 + 知识库内容注入（V2.9n：分镜生成同样支持技能/知识库增强画面描述）
    qctx = await _story_quality_context(story_ctx, params)
    if qctx:
        story_ctx += f"\n\n{qctx}"

    # 模型选择：params.model_profile 指定 → 第一轮直接用该模型；否则默认模型 + 失败走硅基流动兜底
    sel_profile = None
    mid = str(params.get("model_profile") or "").strip()
    if mid:
        from app.ai import config as ai_config
        sel_profile = ai_config.get_profile(mid)

    # 约束：duration/shot_count 优先用 story 节点设置，其次 params，都没有则默认
    if not shot_count:
        shot_count = int(params.get("shot_count") or 0)
    if not duration:
        duration = int(params.get("duration") or 0)
    if shot_count <= 0:
        shot_count = 6
    if duration <= 0:
        duration = shot_count * 5
    per_sec = round(duration / shot_count, 1)

    sys = (
        "你是影视分镜导演。基于给定故事方案生成完整分镜表，严格只输出 JSON：\n"
        '{\n'
        '  "shots": [\n'
        '    {\n'
        '      "shot_no": 1, "scene": "实际拍摄地点名(从资产清单的地点里选，如 步行街/小巷；禁止用镜头氛围词如 霓虹追踪/闪电得手)", "location": "与scene相同的实际地点", "duration": 5,\n'
        '      "shot_size": "景别(远景/全景/中景/近景/特写)", "lens": "焦距(如 24mm/50mm/85mm)",\n'
        '      "camera_angle": "机位角度(平视/俯拍/仰拍/过肩)", "camera_motion": "运镜(固定/推/拉/摇/移/跟/环绕)",\n'
        '      "composition": "构图(居中/三分法/对称/引导线)", "lighting": "光线(自然光/硬光/逆光/夜景)",\n'
        '      "color": "色调(冷调/暖调/高对比)", "character": "画面人物名(从资产清单的人物里选；多角色用顿号分隔)", "character_action": "人物动作",\n'
        '      "props": ["该镜头出现的道具名(必须是资产清单里的物理物品，如 奶茶；禁止把装饰性细节如 口红印/捏瘪的杯子 当道具，无则空数组)"],\n'
        '      "emotion": "情绪(紧张/温馨/孤独)", "dialogue": "对白(无则空)",\n'
        '      "voice_over": "旁白(无则空)", "sound_effect": "音效描述(如:玻璃碎裂声+低沉混响;无则空)",\n'
        '      "camera_control_description": "镜头控制描述(把机位/运镜/构图/光影合成一句可执行的拍摄指令)",\n'
        '      "description": "画面描述(40字内)", "prompt": "给视频生成模型的高质量中文提示词(含景别/运镜/光线/构图)"\n'
        '    }\n'
        "  ]\n"
        "}\n"
        "要求：\n"
        f"1. 分镜个数必须严格等于 {shot_count} 个，一个不多一个不少；\n"
        f"2. 每个分镜时长约 {per_sec} 秒，所有分镜 duration 之和必须等于 {duration} 秒；\n"
        "3. 镜头衔接有叙事逻辑、覆盖完整故事线；props 用数组、无道具给空数组；全部中文。"
        "4. 【实体一致性硬要求】scene/location 必须是资产清单里的实际地点名（禁氛围词）；"
        "character 必须是资产清单里的人物名；props 只能是资产清单里的物理物品（禁细节描写）。"
    )
    # 全字段分镜输出很长（每镜 13 字段 × 多镜头），默认 2000 tokens 会被截断导致解析失败 → 用 6000
    r2 = await _chat_full(sys, story_ctx, json_mode=True, temperature=0.5, max_tokens=6000,
                          model_profile=sel_profile)
    await _record_usage("", r2)
    r: dict | None = None
    if r2.ok and r2.content:
        m = re.search(r"\{.*\}", r2.content, re.S)
        if m:
            try:
                r = json.loads(m.group(0))
            except Exception:  # noqa: BLE001
                r = None
    # 兜底：解析失败/分镜太少 → 换格式最稳的可用模型（硅基流动）重试一次
    if not r or not isinstance(r.get("shots"), list) or not r["shots"]:
        fb = await _siliconflow_profile()
        if fb:
            r3 = await _chat_full(sys, story_ctx, json_mode=True, temperature=0.4,
                                  max_tokens=6000, model_profile=fb)
            await _record_usage("", r3)
            if r3.ok and r3.content:
                m3 = re.search(r"\{.*\}", r3.content, re.S)
                if m3:
                    try:
                        r = json.loads(m3.group(0))
                    except Exception:  # noqa: BLE001
                        r = None
    if not r:
        return {"ok": False, "error": "分镜生成失败（请检查 AI 配置）"}
    shots = r.get("shots") or []
    if not isinstance(shots, list) or not shots:
        return {"ok": False, "error": "分镜生成结果为空"}
    # 3) 数量裁剪/补足到 shot_count，并按时长归一化（保证骨架节点数 = 用户设定）
    if len(shots) > shot_count:
        shots = shots[:shot_count]
    elif len(shots) < shot_count and shot_count <= 30:
        # 数量不足：复制最后一个并改名补足（提示词已硬约束，此处兜底）
        last = dict(shots[-1]) if shots else {"shot_no": 1, "description": "", "duration": per_sec, "prompt": ""}
        while len(shots) < shot_count:
            fill = dict(last)
            fill["shot_no"] = len(shots) + 1
            shots.append(fill)
    # 时长归一化：所有分镜时长之和 → duration
    try:
        total = sum(float(s.get("duration") or 0) for s in shots if isinstance(s, dict))
        if total > 0 and duration > 0 and abs(total - duration) > 0.5:
            scale = duration / total
            for s in shots:
                if isinstance(s, dict):
                    s["duration"] = max(1, round(float(s.get("duration") or 0) * scale))
            # 修正取整误差：最后一镜补齐
            diff = duration - sum(float(s.get("duration") or 0) for s in shots)
            if shots and diff:
                shots[-1]["duration"] = max(1, int(float(shots[-1]["duration"])) + int(diff))
    except Exception:  # noqa: BLE001
        pass
    # 4) 写回：storyboard 节点 → data.shots（前端读取键）；story 节点 → data.storyboard（旧兼容）
    if write_oid:
        obj = await service.get_object(write_oid)
        if obj:
            if write_is_storyboard:
                await service.update_object(write_oid, data={**obj["data"], "shots": shots})
            else:
                await service.update_object(write_oid, data={**obj["data"], "storyboard": shots})
    return {"ok": True, "created": [write_oid] if write_oid else [],
            "storyboard": shots, "message": f"分镜生成完成 · {len(shots)} 个镜头（目标 {shot_count}）"}


async def _act_storyboard_import_ai(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """AI 智能引入（V2.9n）：把剧情剧本 + 物理解析结果交给 LLM，**只识别修正实体**、不做美化。

    解决的问题（物理引入的典型错误）：
      - 角色把 [环境音]/[旁白] 标签当角色
      - 道具把画面细节（口红印吸管、捏瘪的奶茶杯）当道具，漏掉关键道具（一杯奶茶）
      - 场景把「场景名」（霓虹追踪/闪电得手）当场景，漏掉实际地点（繁华的步行街/小巷子）

    输出对齐分镜表 13 列，写回 storyboard 节点 data.shots。
    模型可指定（params.model_profile），用于不同模型引入效果对比。
    """
    # 1) 取剧本 + 写回目标
    script = ""
    write_oid = None
    story_oid = None
    for oid in (obj_ids or []):
        obj = await service.get_object(oid)
        if not obj:
            continue
        ot = obj["object_type"]
        if ot == "story" and not script:
            story_oid = oid
            script = (str(obj["data"].get("script") or "") or str(obj["data"].get("story") or "")
                      or str(obj["data"].get("summary") or "") or str(obj["data"].get("text") or "")).strip()
        elif ot == "storyboard":
            write_oid = oid
    if not script:
        for o in await service.list_objects(scene_id):
            if o["object_type"] == "story":
                story_oid = o["id"]
                script = (str(o["data"].get("script") or "") or str(o["data"].get("story") or "")
                          or str(o["data"].get("summary") or "") or str(o["data"].get("text") or "")).strip()
                break
    if not script:
        return {"ok": False, "error": "没有可用的剧情剧本——请先在剧情节点生成故事"}
    if not write_oid:
        for o in await service.list_objects(scene_id):
            if o["object_type"] == "storyboard":
                write_oid = o["id"]
                break
        if not write_oid and story_oid:
            write_oid = story_oid

    # 2) 物理解析结果（前端可传 initial_shots，后端兜底自解析）
    initial = params.get("initial_shots") or []
    if not initial:
        parsed = _parse_script(script)
        initial = [{"shot_no": i + 1, "duration": sh.get("duration"), "description": "",
                    "character": "", "scene": sh.get("location"), "location": sh.get("location"),
                    "props": [], "lighting": "", "sound_effect": "、".join(sh.get("sfx") or []),
                    "dialogue": "", "voice_over": "", "prompt": "", "camera_control_description": "",
                    "_raw": {"goal": sh.get("goal"), "mood": sh.get("mood"), "bgm": sh.get("bgm"),
                             "body": "", "key_frames": [x.get("desc") for x in (sh.get("shots") or [])]}}
                   for i, sh in enumerate(parsed["shots"])]

    # 3) 模型选择
    sel_profile = None
    mid = str(params.get("model_profile") or "").strip()
    if mid:
        from app.ai import config as ai_config
        sel_profile = ai_config.get_profile(mid)

    # 剧本实体清单（帮助 LLM 识别真实角色/道具/地点）
    parsed_ctx = _parse_script(script)
    entity_hint = (
        f"【剧本人物名单】{'、'.join(parsed_ctx['characters']) or '（无）'}\n"
        f"【剧本关键道具】{'、'.join(parsed_ctx['props']) or '（无）'}\n"
        f"【剧本实际地点】{'、'.join(dict.fromkeys(sh['location'] for sh in parsed_ctx['shots'] if sh['location'])) or '（无）'}"
    )

    sys = (
        "你是影视分镜实体识别修正器。任务：根据【原始剧本】修正给定的【初始分镜表】中的实体识别错误。\n"
        "**只做识别修正，不做任何美化/扩写/润色**：不要改写画面描述、不要加镜头语言、不要改 prompt 原文（除非为空可留空）。\n"
        "修正规则：\n"
        "1. 角色(character)：必须是真实剧中人物；**强制排除 [环境音]/[旁白]/[画外音]/[音效]/[对白] 等标签**（这些是音效标注不是角色）；"
        "优先从【剧本人物名单】与对白说话人选取；该镜无人物可留空。\n"
        "2. 道具(props)：只保留**关键道具**（剧情核心物件，如'一杯奶茶'）；"
        "排除画面修饰细节（口红印吸管、捏瘪的杯子、衣服下摆等）；优先从【剧本关键道具】选取，去掉描述性短语。\n"
        "3. 场景(scene/location)：填**实际拍摄地点**（从【剧本实际地点】与场景正文提取，如'繁华的步行街''幽暗的小巷子'），"
        "**不要用场景名/分镜名**（如'霓虹追踪''闪电得手'）。\n"
        "4. 时长/描述/对白/旁白/音效：沿用初始值即可，明显为空可补，但不要改写。\n"
        "严格只输出 JSON：{\"shots\":[{\"shot_no\":1,\"duration\":5,\"description\":\"\",\"shot_size\":\"\","
        "\"character\":\"\",\"scene\":\"\",\"location\":\"\",\"props\":[\"\"],\"lighting\":\"\","
        "\"sound_effect\":\"\",\"dialogue\":\"\",\"voice_over\":\"\",\"prompt\":\"\","
        "\"camera_control_description\":\"\"}]}，镜头数与初始表一致。"
    )
    user = f"【原始剧本】\n{script[:6000]}\n\n{entity_hint}\n\n【初始分镜表】\n" + "\n".join(
        f"镜头{i + 1}: {json.dumps(s, ensure_ascii=False)[:400]}" for i, s in enumerate(initial[:40])
    )
    r = await _chat_full(sys, user, json_mode=True, temperature=0.2, max_tokens=6000,
                         model_profile=sel_profile)
    await _record_usage("", r)
    shots: list[dict] = []
    if r.ok and r.content:
        m = re.search(r"\{.*\}", r.content, re.S)
        if m:
            try:
                shots = (json.loads(m.group(0)) or {}).get("shots") or []
            except Exception:  # noqa: BLE001
                shots = []
    if not shots:
        return {"ok": False, "error": "AI 识别修正失败（请检查 AI 配置）"}

    # 4) 数量对齐 + 保留初始中没有被 LLM 覆盖的字段
    if len(shots) > len(initial):
        shots = shots[:len(initial)]
    # 角色后置清洗（防御性）：强制剔除音效/旁白标签
    _BAD_TAGS = ("[环境音]", "[旁白]", "[画外音]", "[音效]", "[对白]", "环境音", "旁白", "画外音", "音效", "对白")
    out: list[dict] = []
    for i, s in enumerate(shots):
        if not isinstance(s, dict):
            continue
        base = dict(initial[i]) if i < len(initial) and isinstance(initial[i], dict) else {}
        # props 数组化
        ps = s.get("props") or base.get("props") or []
        if isinstance(ps, str):
            ps = [x.strip() for x in ps.replace("，", "、").split("、") if x.strip()]
        # character 清洗
        character = str(s.get("character") or base.get("character") or "")
        for t in _BAD_TAGS:
            character = character.replace(t, "")
        character = character.strip("[] 【】、，,。")
        # 兜底：清洗后为空 → 从画面描述匹配剧本人物（LLM 输出 + 初始描述合并，长词优先）
        if not character:
            desc_txt = f"{str(s.get('description') or '')} {str(base.get('description') or '')}"
            for c in sorted(parsed_ctx["characters"], key=len, reverse=True):
                if len(c) >= 2 and c in desc_txt:
                    character = c
                    break
        # 场景/地点兜底：LLM 若给了场景名/空 → 回退初始值（物理引入的地点）
        scene_names = {sh["location"] for sh in parsed_ctx["shots"] if sh["location"]}
        scene_val = str(s.get("scene") or base.get("scene") or "")
        loc_val = str(s.get("location") or base.get("location") or "")
        if not scene_val or scene_val in scene_names:
            scene_val = loc_val or str(base.get("scene") or base.get("location") or "")
        if not loc_val:
            loc_val = scene_val
        out.append({
            "shot_no": int(s.get("shot_no") or base.get("shot_no") or i + 1),
            "duration": s.get("duration") or base.get("duration") or 0,
            "description": str(s.get("description") or base.get("description") or ""),
            "shot_size": str(s.get("shot_size") or base.get("shot_size") or ""),
            "character": character,
            "scene": scene_val,
            "location": loc_val,
            "props": ps,
            "lighting": str(s.get("lighting") or base.get("lighting") or ""),
            "sound_effect": str(s.get("sound_effect") or base.get("sound_effect") or ""),
            "dialogue": str(s.get("dialogue") or base.get("dialogue") or ""),
            "voice_over": str(s.get("voice_over") or base.get("voice_over") or ""),
            "prompt": str(s.get("prompt") or base.get("prompt") or ""),
            "camera_control_description": str(s.get("camera_control_description") or base.get("camera_control_description") or ""),
        })
    if write_oid:
        obj = await service.get_object(write_oid)
        if obj:
            if obj["object_type"] == "storyboard":
                await service.update_object(write_oid, data={**obj["data"], "shots": out})
            else:
                await service.update_object(write_oid, data={**obj["data"], "storyboard": out})
    return {"ok": True, "created": [write_oid] if write_oid else [],
            "storyboard": out, "message": f"AI 智能引入完成 · 修正 {len(out)} 个镜头（实体识别已校正）"}
