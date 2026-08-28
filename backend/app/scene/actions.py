"""场景动作执行器（V2.5 规格书 §19 / §42 / §45-§46）。

Scene Action 可由 Skill / Workflow / Renderer 实现。这里用现有基础设施做真实落地：
- 文本类（分析/卖点/剧情/分镜/Prompt）：app.ai.client.chat_json
- 图像类（主图/场景图/海报/参考图）：app.providers.cloud_gen.cloud_image_generate
- 视频类（成片/镜头视频）：app.providers.cloud_gen.cloud_video_generate

所有动作均 try/except 兜底，绝不阻塞主流程；失败返回 {ok:False,error} 由前端展示。
"""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
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


# ─────────────────────────────────────────────────────────────────────────────
# 动作实现
# ─────────────────────────────────────────────────────────────────────────────

async def _act_analyze_product(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] == "product"]
    made = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        desc = (f"商品名：{d.get('name','')}；商品链接：{d.get('product_url','')}；SKU：{d.get('sku','')}；"
                f"主图：{d.get('main_image','')}；已有信息：{d.get('info','')}")
        sys = ("你是电商商品分析师。根据商品名称/链接/SKU/主图推断商品信息并提炼卖点，直接输出 JSON："
               '{"info":"一段商品信息摘要（品类/材质/卖点/适合人群，80 字内）","selling_points":["3-5 条中文卖点，每条≤20字"],"marketing_plan":"一段话带货营销方案"}。')
        r = await _llm_json(sys, desc)
        if r:
            patch = {"selling_points": r.get("selling_points", []), "marketing_plan": r.get("marketing_plan", ""),
                     "info": r.get("info", "")}
            await service.update_object(oid, data={**d, **patch})
            made.append(oid)
    return {"ok": bool(made), "updated": made, "message": f"已分析 {len(made)} 个商品"}


async def _act_generate_strategy(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """营销策略生成（电商物料）：卖点分级/目标人群/投放渠道/内容策略/文案基调 → 写回商品节点 strategy。"""
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] == "product"]
    made = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        ctx = (f"商品名：{d.get('name','')}；品类：{d.get('category','')}；"
               f"卖点：{'，'.join(d.get('selling_points', []) or [])}；营销方案：{d.get('marketing_plan','')}；"
               f"已有信息：{d.get('info','')}")
        sys = ("你是电商营销策划总监。基于商品信息制定完整营销策略，直接输出 JSON："
               '{"core_selling_points":["3 条核心卖点，每条≤12字"],"aux_selling_points":["2-3 条辅助卖点"],'
               '"target_audience":"目标人群画像（含年龄/场景/痛点）",'
               '"channels":["投放渠道，每个渠道一句话内容方向（如 淘宝-详情页主推核心卖点；抖音-3秒钩子短视频；小红书-场景种草图文）"],'
               '"content_strategy":{"短视频脚本方向":"...","详情页结构":"...","图文笔记方向":"..."},'
               '"copy_tone":"整体文案基调（如 年轻活力/专业可信/温情种草）"}')
        r = await _llm_json(sys, ctx)
        if r:
            await service.update_object(oid, data={**d, "strategy": r})
            made.append(oid)
    return {"ok": bool(made), "updated": made, "message": f"已生成 {len(made)} 份营销策略"}


# ── 结构化商品广告片制作板（Visual Production Board）System Prompt ──
# 原则：JSON 是数据源（可检索/引用/联动），图片只是视觉参考；前端 MarketingBoard 渲染制作板。
VISUAL_BOARD_SYSTEM = """你是顶级商业广告导演、视觉总监、摄影指导、分镜导演、电商视觉策划师和AI影视制作统筹。
你的任务是为电商商品生成一个【结构化商品广告片制作板 Visual Production Board】。

硬性要求：
1. 所有内容必须结构化 JSON；图片只是视觉参考，不得把重要信息只写在图片里。
2. 每个实体必须有唯一 ID（PRODUCT_001/CHAR_001/SCENE_001/SHOT_001/PROP_001/LIGHT_001/MOOD_001/AUDIO_001）。
3. 所有实体必须带 keywords 关键词，至少分 PRODUCT/SCENE/CHARACTER/CAMERA/MOOD/STYLE/PLATFORM 类别。
4. 镜头是独立对象：shot_id/shot_number/title/story_role/scene_id/character_ids/product_id/composition/shot_size/camera_angle/camera_movement/lens/lighting/color/mood/action/dialogue/voice_over/subtitle/sound_effect/music/transition/duration/image_prompt/video_prompt/negative_prompt/keywords。
5. 镜头类型用标准词库：WIDE/ESTABLISHING/MEDIUM/MEDIUM_CLOSE/CLOSE_UP/EXTREME_CLOSE_UP/MACRO/LOW_ANGLE/HIGH_ANGLE/OVER_SHOULDER/POV/HERO_SHOT。
6. 镜头运动用标准词库：STATIC/PAN/TILT/DOLLY_IN/DOLLY_OUT/TRACKING/ORBIT/PUSH_IN/PULL_OUT/FOLLOW/CRANE/DRONE/SLOW_RISE/HANDHELD。
7. 每个镜头带 references 引用其它实体 ID（product_id/character_ids/scene_id/prop_ids/lighting_id/mood_id/audio_id）。
8. 每个镜头生成 render_tasks：{render_task_id, source_shot_id, type:IMAGE, model, aspect_ratio, prompt_source:[实体ID列表], prompt}。
9. 角色结构化：character_id/name/type/age_range/appearance/hair/outfit/accessories/personality/keywords。
10. 场景结构化：scene_id/name/type/time/weather/season/environment/lighting/mood/keywords。
11. 商品结构化：product_id/name/category/appearance/material/color/features/brand_style/keywords。
12. 音效结构化：audio_id/music_style/music_tempo/music_mood/ambient_sound/sound_effects/foley/voice_over/dialogue/keywords。
13. 灯光结构化：lighting_id/lighting_type/key_light/fill_light/rim_light/color_temperature/direction/intensity/shadow/keywords。
14. 情绪结构化：mood_id/name/emotion/visual_keywords/color_keywords。
15. 顶部 campaign：{brand, product, theme, visual_direction, aspect_ratio, platform}。

最终只输出一个完整 JSON（不要 Markdown 代码块包裹，不要解释）：
{"board":{"campaign":{},"key_features":[],"benefits":[],"storyboard_title":""},
 "campaign":{},"product":{},"characters":[],"scenes":[],"props":[],"lighting":[],"moods":[],
 "audio":[],"shots":[],"keywords":{},"relationships":[],"render_tasks":[]}"""


async def _act_generate_visual_board(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """生成结构化商品广告片制作板（Visual Production Board）→ 写回剧情节点 payload.board。
    board 是结构化 JSON（可被图片/视频/音频节点按字段 ID/关键词检索引用），script 保留原剧本。"""
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] == "story"]
    if not targets:
        return {"ok": False, "error": "请先创建剧情(story)节点（视觉规划板生成在其上）"}
    # 商品上下文
    ctx = ""
    for o in await service.list_objects(scene_id):
        if o["object_type"] == "product":
            dd = o["data"]
            ctx += (f"商品：{dd.get('name','')}；品类：{dd.get('category','')}；"
                    f"卖点：{'，'.join(dd.get('selling_points', []) or [])}；营销方案：{dd.get('marketing_plan','')}；"
                    f"信息：{dd.get('info','')}；主图：{dd.get('main_image','')}\n")
    if not ctx:
        return {"ok": False, "error": "请先创建商品(product)节点并填写商品信息（可用「识别商品」自动分析）"}
    made = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        story_txt = str(d.get("script") or d.get("text") or d.get("summary") or "").strip()
        # 视觉规划板输出很大（13 组实体 × ID/keywords），实测成功输出可达 15K 字符 ≈ 6000 tokens，
        # 8000 留足余量；解析失败/空结果时换硅基流动重试一次（2026-08-28 两场景链路检查发现）
        r = await _llm_json(VISUAL_BOARD_SYSTEM,
                            f"【商品信息】\n{ctx}\n【剧情/分镜参考（可为空）】\n{story_txt}",
                            max_tokens=8000)
        if not r:
            fb = await _siliconflow_profile()
            if fb:
                r = await _llm_json(VISUAL_BOARD_SYSTEM,
                                    f"【商品信息】\n{ctx}\n【剧情/分镜参考（可为空）】\n{story_txt}",
                                    model_profile=fb, max_tokens=8000)
        if not r:
            continue
        board = r.get("board") if isinstance(r.get("board"), dict) else r
        await service.update_object(oid, data={**d, "board": board})
        made.append(oid)
    if not made:
        return {"ok": False, "error": "视觉规划板生成失败（AI 输出解析失败，请检查 AI 配置后重试）"}
    return {"ok": bool(made), "updated": made,
            "message": f"已生成 {len(made)} 份视觉规划板（结构化，可被各节点按 ID/关键词引用）"}


async def _gen_image(scene_id: str, obj_ids: list[str], params: dict, kind: str) -> dict:
    prov = await _image_provider()
    if not prov:
        return {"ok": False, "error": "未配置可用图像 Provider（请在「接口配置」添加硅基流动等云端出图）"}
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] in ("product", "shot", "storyboard", "scene")]
    created = []
    prompt = params.get("prompt", "")
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        # 自动拼提示词：用户给的优先，否则从对象数据生成
        p = prompt or d.get("prompt") or _auto_prompt(kind, obj["object_type"], d)
        if not p:
            continue
        from app.providers.cloud_gen import cloud_image_generate
        res = await cloud_image_generate(prov["id"], p, size=params.get("size", "1024x1024"))
        if not res.get("ok"):
            return {"ok": False, "error": res.get("error", "出图失败"), "logs": res.get("logs")}
        urls = [i["url"] for i in res.get("images", []) if i.get("url")]
        # 创建图片对象并回写引用。x/y 是表列（不在 data 里），从 obj 顶层取。
        base_x, base_y = float(obj.get("x") or 0), float(obj.get("y") or 0)
        for idx, u in enumerate(urls):
            nid = await service.create_object(scene_id, "image",
                                              x=base_x + 340, y=base_y + idx * 300,
                                              width=280, height=280,
                                              data={"prompt": p, "url": u, "model": prov.get("name"), "source_object_id": oid})
            created.append(nid)
            await _register_asset(scene_id, "image", u, name=f"{_label(obj['object_type'])}·{kind}", meta={"kind": kind, "source_object_id": oid})
        # 回写原对象
        await service.update_object(oid, data={**d, f"{kind}_image": urls[0] if urls else d.get(f"{kind}_image")})
    return {"ok": bool(created), "created": created, "message": f"生成 {len(created)} 张图"}


def _auto_prompt(kind: str, obj_type: str, d: dict) -> str:
    if obj_type == "product":
        sp = "，".join(d.get("selling_points", []) or [])
        base = f"电商{ '主图' if kind=='main' else '场景图' }，商品：{d.get('name','')}，卖点：{sp}"
        return base + "，商业摄影，高级质感，干净背景" if kind == "main" else base + "，生活化使用场景，自然光"
    if obj_type == "shot":
        return f"电影感画面，{d.get('shot_size','')}，{d.get('camera_motion','')}，{d.get('lighting','')}，{d.get('description','')}"
    if obj_type == "storyboard":
        return f"分镜插图：{d.get('description','')}，{d.get('camera','')}，{d.get('motion','')}"
    if obj_type == "scene":
        return f"影视场景：{d.get('location','')}，{d.get('time','')}，{d.get('lighting','')}，{d.get('description','')}"
    return d.get("prompt", "")


async def _act_generate_prompt(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """影视拉片：根据镜头数据生成可复用的 cinematic prompt（§44 变量渲染）。"""
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] == "shot"]
    updated = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        user = (f"景别={d.get('shot_size','')}；镜头={d.get('lens','')}；机位={d.get('camera_position','')}；"
                f"运动={d.get('camera_motion','')}；构图={d.get('composition','')}；光线={d.get('lighting','')}；"
                f"色调={d.get('color','')}；人物={d.get('character','')}；情绪={d.get('emotion','')}；"
                f"动作={d.get('action','')}；风格={params.get('style','电影感写实')}")
        sys = "你是电影摄影指导。根据镜头参数生成一段英文 image/video 生成提示词（不超过 120 词），突出镜头语言。只输出提示词本身。"
        p = await _llm_text(sys, user)
        if p:
            await service.update_object(oid, data={**d, "prompt": p})
            updated.append(oid)
    return {"ok": bool(updated), "updated": updated, "message": f"生成 {len(updated)} 条 Prompt"}


async def _act_analyze_shot(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] == "shot"]
    updated = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        user = (f"镜号={d.get('shot_no','')}；景别={d.get('shot_size','')}；镜头={d.get('lens','')}；"
                f"运动={d.get('camera_motion','')}；光线={d.get('lighting','')}；人物={d.get('character','')}；"
                f"情绪={d.get('emotion','')}；动作={d.get('action','')}")
        sys = "你是影视拉片分析师。基于镜头元数据做镜头语言分析（景别/构图/运动/情绪意图），输出 2-4 句中文。只输出分析文本。"
        a = await _llm_text(sys, user)
        if a:
            await service.update_object(oid, data={**d, "analysis": a})
            updated.append(oid)
    return {"ok": bool(updated), "updated": updated, "message": f"分析 {len(updated)} 个镜头"}


async def _act_generate_video(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    prov = await _video_provider()
    if not prov:
        return {"ok": False, "error": "未配置可用视频 Provider"}
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id)
                          if o["object_type"] in ("shot", "storyboard", "image", "video")]
    created = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        p = params.get("prompt") or d.get("prompt") or d.get("desc") or d.get("description") or ""
        if not p:
            continue
        # 分镜视频配置（V2.7）：风格/运镜/清晰度拼进提示词，非默认运镜透传相机控制
        style = str(params.get("style") or d.get("style") or "").strip()
        motion = str(params.get("camera_motion") or d.get("camera_motion") or "").strip()
        reso = str(params.get("resolution") or d.get("resolution") or "").strip()
        extra = []
        if style:
            extra.append(f"【画面风格】{style}")
        if motion:
            extra.append(f"【运镜】{motion}")
        if reso:
            extra.append(f"【清晰度】{reso}")
        if extra:
            p = f"{p}\n" + "\n".join(extra)
        native: dict[str, Any] = {}
        if motion and motion != "固定镜头":
            native["camera_movement"] = motion
        from app.providers.cloud_gen import cloud_video_generate
        res = await cloud_video_generate(prov["id"], p,
                                         image_url=d.get("url") or params.get("image_url", ""),
                                         duration=int(params.get("duration") or d.get("duration") or 5),
                                         ratio=str(params.get("ratio") or d.get("aspect_ratio") or "16:9"),
                                         native=native or None)
        if not res.get("ok"):
            return {"ok": False, "error": res.get("error", "生视频失败"), "logs": res.get("logs")}
        urls = [i.get("url") for i in res.get("videos", []) if i.get("url")]
        base_x, base_y = float(obj.get("x") or 0), float(obj.get("y") or 0)
        for idx, u in enumerate(urls):
            nid = await service.create_object(scene_id, "video",
                                              x=base_x + 340, y=base_y + idx * 320,
                                              width=320, height=260,
                                              data={"prompt": p, "url": u, "model": prov.get("name"),
                                                    "source_object_id": oid,
                                                    "shot_no": d.get("shot_no", ""),
                                                    "style": style, "camera_motion": motion,
                                                    "resolution": reso, "aspect_ratio": d.get("aspect_ratio", "16:9")})
            created.append(nid)
            await _register_asset(scene_id, "video", u, name=f"{_label(obj['object_type'])}视频", meta={"source_object_id": oid})
    return {"ok": bool(created), "created": created, "message": f"生成 {len(created)} 个视频"}


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


# ─────────────────────────────────────────────────────────────────────────────
# 剧本生成（剧本 Agent：格式约束 + 分镜/人物/道具/BGM/对白关键词，供节点索引）
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_FORMAT = """# 项目设定
- 视频类型：（产品广告 / 剧情短剧 / 种草视频）
- 总时长：（秒）
- 目标受众：（人群画像）
- 情感基调：
- 叙事结构：

# 出场元素
- 人物：（姓名 / 性别 / 年龄 / 性格 / 造型）
- 道具：（关键器物）
- 分镜：（地点 / 时间）

# 故事大纲
（1-2 句话概括全片）

# 情绪曲线
（如 平静 → 紧张 → 反转 → 温暖，标注时间点）

# 分镜剧本
按总时长拆成 3-5 个分镜，每个分镜必须包含，可拆多个镜头：
## 分镜X：（地点，时间）
- 分镜目标：
- 情绪基调：
- 背景音乐：（每个分镜必须单独编排专属 BGM，按该分镜的场景与情绪基调描述音乐类型/节奏/风格，如"轻松俏皮的潜行BGM"；禁止省略、禁止写"无"、禁止照抄上一分镜）
- 关键画面（每行一个镜头，镜头编号 X-1、X-2...）：
  - 镜头X-1：（镜头级视觉描述，含景别/动作特写）
  - 镜头X-2：（镜头级视觉描述，含景别/动作特写）
- 对白 / 旁白：
  - 人物A（情绪）："台词"
  - （环境音 / 音效）
- 时长：约 X 秒（所有分镜时长之和 ≈ 总时长）

# 整体节奏与风格说明
（节奏/转场/BGM/色调/镜头语言）

# 核心信息点对应
（把商品卖点/品牌主张逐一对应到具体分镜）"""


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
        mp = re.search(r"-\s*道具[：:]\s*(.+)", block)
        if mp:
            raw = mp.group(1)
            names = [x.strip() for x in re.split(r"[、,，]", raw) if x.strip()]
            parsed["props"] = names
    # 分镜块：## 分镜N：（地点，时间）
    for m in re.finditer(r"##\s*分镜(\d+)[：:]?\s*（?([^）\n]*)）?", script):
        no = int(m.group(1))
        head = m.group(2).strip()
        loc, tm = "", ""
        mm = re.search(r"(.+?)[,，]\s*(.+)", head)
        if mm:
            loc, tm = mm.group(1).strip(), mm.group(2).strip()
        elif head:
            loc = head
        start = m.end()
        nxt = re.search(r"\n##\s*分镜", script[start:])
        end = start + nxt.start() if nxt else len(script)
        block = script[start:end]
        shot: dict = {"no": no, "location": loc, "time": tm, "goal": "", "mood": "", "bgm": "",
                      "duration": "", "shots": [], "dialogue": []}
        g = re.search(r"-?\s*分镜目标[：:]\s*(.+)", block)
        if g:
            shot["goal"] = g.group(1).strip()
        g = re.search(r"-?\s*情绪基调[：:]\s*(.+)", block)
        if g:
            shot["mood"] = g.group(1).strip()
        g = re.search(r"-?\s*背景音乐[：:]\s*(.+)", block)
        if g:
            shot["bgm"] = g.group(1).strip()
        g = re.search(r"-?\s*时长[：:]\s*约?\s*([\d.]+)\s*秒", block)
        if g:
            shot["duration"] = g.group(1).strip()
        # 关键画面 → 镜头
        gm = re.search(r"-?\s*关键画面.*?\n((?:.*\n)*?)(?=\n?\s*-?\s*对白|$)", block, re.S)
        if gm:
            for line in gm.group(1).splitlines():
                line = line.strip()
                mm2 = re.match(r"[-*]\s*镜头([\d\-]+)[：:]\s*(.+)", line)
                if mm2:
                    shot["shots"].append({"no": mm2.group(1).strip(), "desc": mm2.group(2).strip()})
                elif line.startswith("-") or line.startswith("*"):
                    d = line.lstrip("-* ").strip()
                    if d and not d.startswith("镜头"):
                        mm3 = re.match(r"镜头([\d\-]+)[：:]\s*(.+)", d)
                        if mm3:
                            shot["shots"].append({"no": mm3.group(1).strip(), "desc": mm3.group(2).strip()})
        # 对白 / 旁白
        gd = re.search(r"-?\s*对白\s*/\s*旁白[：:]\s*\n((?:.*\n)*?)(?=\n?-?\s*时长|$)", block, re.S)
        if gd:
            for line in gd.group(1).splitlines():
                line = line.strip()
                if not line or line.startswith("（") or line.startswith("("):
                    continue
                line = line.lstrip("-* ").strip()
                # 排除字段行误入对白（时长/背景音乐等）
                if re.match(r"^(时长|背景音乐|分镜目标|情绪基调|关键画面)[：:]", line):
                    continue
                mm4 = re.match(r"(.+?)[（(]([^）)]*)[）)]\s*[：:]\s*[\"“]?(.+?)[\"”]?\s*$", line)
                if mm4:
                    speaker = mm4.group(1).strip()
                    if speaker not in parsed["characters"]:
                        parsed["characters"].append(speaker)
                    shot["dialogue"].append({"speaker": speaker, "emotion": mm4.group(2).strip(), "line": mm4.group(3).strip()})
                else:
                    mm5 = re.match(r"(.+?)[：:]\s*[\"“]?(.+?)[\"”]?\s*$", line)
                    if mm5:
                        speaker = mm5.group(1).strip()
                        if speaker not in parsed["characters"]:
                            parsed["characters"].append(speaker)
                        shot["dialogue"].append({"speaker": speaker, "emotion": "", "line": mm5.group(2).strip()})
        parsed["shots"].append(shot)
    return parsed


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
           f"严格按以下 Markdown 结构输出（不要 JSON、不要开场白、不要额外解释）：\n\n{SCRIPT_FORMAT}")
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


# ─────────────────────────────────────────────────────────────────────────────
# 电商：详情页（§67）
# ─────────────────────────────────────────────────────────────────────────────

async def _act_generate_detail_page(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] == "product"]
    created = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        refs = await _rag_retrieve(f"{d.get('name','')} {d.get('category','')}")
        ctx = (f"商品：{d.get('name','')}；品牌：{d.get('brand','')}；类目：{d.get('category','')}；"
               f"卖点：{', '.join(d.get('selling_points', []) or [])}；描述：{d.get('description','')}")
        if refs:
            ctx += "\n\n参考资料（RAG）：\n" + "\n".join(refs)
        sys = ("你是电商详情页策划。基于商品信息生成一套详情页文案，输出 JSON："
               '{"title":"详情页标题","sections":[{"title":"模块标题","body":"模块正文"}],"slogan":"一句话卖点标语"}'
               "。中文，专业且有转化力。")
        r = await _llm_json(sys, ctx)
        if not r:
            continue
        text = f"# {r.get('title','')}\n\n> {r.get('slogan','')}\n\n" + "\n\n".join(f"## {s.get('title','')}\n{s.get('body','')}" for s in r.get("sections", []))
        nid = await service.create_object(scene_id, "text", x=400, y=float(obj.get("y") or 0) + 320,
                                          width=420, height=520,
                                          data={"name": "详情页", "text": text, "detail_page": True,
                                                "source_object_id": oid})
        created.append(nid)
    return {"ok": bool(created), "created": created, "message": f"生成 {len(created)} 个详情页"}


async def _act_generate_shots(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """电商短剧：由分镜 storyboard 生成镜头 shot 对象（§69）。"""
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] == "storyboard"]
    created = []
    existing = await service.list_objects(scene_id)
    base_y = max([float(o.get("y") or 0) + float(o.get("height") or 0) for o in existing] or [0]) + 80
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        shot_data = {
            "shot_no": d.get("shot", 1), "scene": d.get("scene", 1),
            "duration": d.get("duration", 4), "description": d.get("description", ""),
            "dialogue": d.get("dialogue", ""), "camera": d.get("camera", ""),
            "motion": d.get("motion", ""), "shot_size": d.get("camera", ""),
        }
        nid = await service.create_object(scene_id, "shot", x=base_y and (len(created) % 4) * 340,
                                          y=base_y + (len(created) // 4) * 300,
                                          width=300, height=240, data=shot_data)
        created.append(nid)
    return {"ok": bool(created), "created": created, "message": f"生成 {len(created)} 个镜头"}


async def _act_generate_images(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """电商短剧：为场景/分镜批量出图（§69）。"""
    prov = await _image_provider()
    if not prov:
        return {"ok": False, "error": "未配置可用图像 Provider"}
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] in ("storyboard", "scene")]
    created = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        p = params.get("prompt") or d.get("description") or d.get("prompt") or ""
        if not p:
            continue
        from app.providers.cloud_gen import cloud_image_generate
        res = await cloud_image_generate(prov["id"], p, size=params.get("size", "1024x1024"))
        if not res.get("ok"):
            return {"ok": False, "error": res.get("error", "出图失败")}
        urls = [i["url"] for i in res.get("images", []) if i.get("url")]
        base_x, base_y = float(obj.get("x") or 0), float(obj.get("y") or 0)
        for idx, u in enumerate(urls):
            nid = await service.create_object(scene_id, "image", x=base_x + 340, y=base_y + idx * 300,
                                              width=280, height=280,
                                              data={"prompt": p, "url": u, "model": prov.get("name"), "source_object_id": oid})
            created.append(nid)
            await _register_asset(scene_id, "image", u, name=f"{_label(obj['object_type'])}配图", meta={"source_object_id": oid})
    return {"ok": bool(created), "created": created, "message": f"生成 {len(created)} 张图"}


async def _act_generate_node_image(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """节点级出图（导演台骨架模式）：对指定 image 节点生成图片，结果回填该节点 url。

    读取节点 data.prompt / purpose / title，调用云端出图并写回；参考图（角色一致性）优先取
    params.reference_images，其次取场景内已出图的同 purpose 资产（V2.8 locked_ref 思路的简化版）。
    """
    prov = await _image_provider()
    if not prov:
        return {"ok": False, "error": "未配置可用图像 Provider"}
    created: list[str] = []
    for oid in (obj_ids or []):
        obj = await service.get_object(oid)
        if not obj or obj["object_type"] != "image":
            continue
        d = obj["data"]
        p = str(params.get("prompt") or d.get("prompt") or d.get("description") or "").strip()
        if not p:
            continue
        refs = [str(x) for x in (params.get("reference_images") or []) if x]
        if not refs:
            purpose = str(d.get("purpose") or "")
            title = str(d.get("title") or d.get("name") or d.get("selected") or "")
            for o in await service.list_objects(scene_id):
                if o["id"] == oid or o["object_type"] != "image":
                    continue
                pd = o["data"]
                if pd.get("url") and str(pd.get("purpose") or "") == purpose and title and str(pd.get("title") or pd.get("name") or pd.get("selected") or "") == title:
                    refs.append(str(pd["url"]))
        from app.providers.cloud_gen import cloud_image_generate
        res = await cloud_image_generate(prov["id"], p,
                                         size=str(params.get("size") or d.get("size") or "1024x1024"),
                                         reference_images=refs or None)
        if not res.get("ok"):
            return {"ok": False, "error": res.get("error", "出图失败"), "logs": res.get("logs")}
        urls = [i.get("url") for i in res.get("images", []) if i.get("url")]
        if not urls:
            continue
        await service.update_object(oid, data={**d, "url": urls[0], "model": prov.get("name"), "prompt": p})
        await _register_asset(scene_id, "image", urls[0],
                              name=f"{d.get('purpose') or '图片'}·{d.get('title') or d.get('name') or ''}",
                              meta={"source_object_id": oid})
        created.append(oid)
    return {"ok": bool(created), "created": created, "message": f"生成 {len(created)} 张图"}


async def _act_generate_node_video(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """节点级出视频（导演台骨架模式）：对指定 video 节点生成视频，结果回填该节点 url。

    读取节点 data.prompt / duration / aspect_ratio / camera_motion / resolution / style /
    dialogue_script / sfx_desc / shot_no；参考图自动收集连到本节点的 image 资产图
    （供素材库→参考图一致性，等价 MCP multi_ref）。
    """
    prov = await _video_provider()
    if not prov:
        return {"ok": False, "error": "未配置可用视频 Provider"}
    created: list[str] = []
    for oid in (obj_ids or []):
        obj = await service.get_object(oid)
        if not obj or obj["object_type"] != "video":
            continue
        d = obj["data"]
        p = str(params.get("prompt") or d.get("prompt") or d.get("desc") or "").strip()
        if not p:
            continue
        # 参考图：参数优先，其次连到本节点的 image 资产（素材库同一来源）
        refs = [str(x) for x in (params.get("reference_images") or []) if x]
        if not refs:
            for e in await service.list_edges(scene_id):
                if e.get("target_id") != oid:
                    continue
                src = await service.get_object(e.get("source_id") or "")
                if src and src["object_type"] == "image" and src["data"].get("url"):
                    refs.append(str(src["data"]["url"]))
        # 风格/运镜/清晰度/音效拼进提示词
        style = str(params.get("style") or d.get("style") or "").strip()
        motion = str(params.get("camera_motion") or d.get("camera_motion") or "固定镜头").strip()
        reso = str(params.get("resolution") or d.get("resolution") or "").strip()
        extra = []
        if style:
            extra.append(f"【画面风格】{style}")
        if motion and motion != "固定镜头":
            extra.append(f"【运镜】{motion}")
        if reso:
            extra.append(f"【清晰度】{reso}")
        if d.get("dialogue_script"):
            extra.append(f"【对白】{'；'.join(str(x) for x in d['dialogue_script'] if x)}")
        if d.get("sfx_desc"):
            extra.append(f"【音效】{'、'.join(str(x) for x in d['sfx_desc'] if x)}")
        if extra:
            p = f"{p}\n" + "\n".join(extra)
        from app.renderers.generate import render_media
        res = await render_media(
            "video",
            {
                "prompt": p,
                "duration": int(params.get("duration") or d.get("duration") or 5),
                "ratio": str(params.get("ratio") or d.get("aspect_ratio") or "16:9"),
                **({"reference_images": refs} if refs else {}),
                **({"native": {"camera_movement": motion}} if motion and motion != "固定镜头" else {}),
            },
            render_mode="cloud",
            provider_id=prov["id"],
            model=str(params.get("model") or d.get("model") or ""),
        )
        if not res.get("ok"):
            return {"ok": False, "error": res.get("error", "生视频失败"), "logs": res.get("logs")}
        vids = res.get("videos") or []
        urls = [v.get("url") for v in vids if isinstance(v, dict) and v.get("url")]
        if not urls:
            continue
        await service.update_object(oid, data={**d, "url": urls[0], "model": prov.get("name"),
                                               "prompt": p, "style": style,
                                               "camera_motion": motion, "resolution": reso})
        await _register_asset(scene_id, "video", urls[0],
                              name=f"分镜{d.get('shot_no', '')}视频",
                              meta={"source_object_id": oid})
        created.append(oid)
    return {"ok": bool(created), "created": created, "message": f"生成 {len(created)} 个视频"}


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

    sys = (
        "你是资深影视编剧。根据给定的原始故事/文案，创作一部影视短片的故事方案。"
        "严格只输出 JSON，结构如下：\n"
        '{\n'
        '  "title": "片名",\n'
        '  "genre": "类型(如科幻/悬疑/情感)",\n'
        '  "theme": "核心主题",\n'
        '  "target_duration": "目标时长(秒)",\n'
        '  "story_summary": "故事梗概(150字内)",\n'
        '  "three_act_structure": {"act1": "第一幕·铺垫(场景+事件)", "act2": "第二幕·冲突(转折+危机)", "act3": "第三幕·高潮与结局"}, \n'
        '  "emotion_curve": [{"phase": "阶段名", "emotion": "情绪(如苍凉/震撼/坚定)", "note": "一句说明"}],\n'
        '  "characters": [{"name": "人物名", "appearance": "外貌", "personality": "性格", "description": "角色定位"}],\n'
        '  "scenes": [{"name": "场景名", "location": "地点", "time": "时间", "weather": "天气", "mood": "氛围"}],\n'
        '  "props": [{"name": "道具名", "description": "作用描述"}]\n'
        "}\n"
        "要求：三幕式结构清晰、情绪曲线有起伏、人物/场景/道具贴合原始故事；全部用中文。"
    )
    r = await _llm_json(sys, raw)
    if not r:
        return {"ok": False, "error": "故事生成失败（请检查 AI 配置）"}
    title = str(r.get("title") or "")
    summary = str(r.get("story_summary") or "")
    structure = r.get("three_act_structure") or {}
    emotion_curve = r.get("emotion_curve") or []
    characters = r.get("characters") or []
    scenes = r.get("scenes") or []
    props = r.get("props") or []
    # 故事正文：把结构转成可读 markdown（供剧本编辑/后续分镜引用）
    story = f"# {title or '未命名'}\n\n"
    if summary:
        story += f"> {summary}\n\n"
    if isinstance(structure, dict):
        for act, text in (structure.items()):
            if text:
                story += f"## {act}\n{text}\n\n"
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
    if write_oid:
        obj = await service.get_object(write_oid)
        await service.update_object(write_oid, data={
            **obj["data"],
            "title": title, "summary": summary, "text": str(r.get("story_summary") or summary or raw)[:800],
            "script": story, "story": story,
            "structure": structure, "emotion_curve": emotion_curve,
            "characters": characters, "scenes": scenes, "props": props,
        })
        created = [write_oid]
    else:
        existing = await service.list_objects(scene_id)
        base_y = max([float(o.get("y") or 0) + float(o.get("height") or 0) for o in existing] or [0]) + 80
        nid = await service.create_object(scene_id, "story", x=360, y=base_y, width=420, height=560,
                                          data={"title": title, "summary": summary,
                                                "text": summary or raw[:500], "script": story, "story": story,
                                                "structure": structure, "emotion_curve": emotion_curve,
                                                "characters": characters, "scenes": scenes, "props": props})
        created = [nid]
    return {"ok": True, "created": created, "title": title, "summary": summary,
            "structure": structure, "emotion_curve": emotion_curve,
            "characters": characters, "scenes": scenes, "props": props,
            "message": f"三幕式故事生成完成 · 人物 {len(characters)} / 场景 {len(scenes)} / 道具 {len(props)}"}


async def _act_generate_storyboard(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """影视拉片（文案驱动）：从 story 节点取三幕式故事 → AI 生成全字段分镜表。

    每镜输出（对齐 D:/分镜.pdf 模板 13 列 + 生成字段）：
      镜号/时长/画面描述/景别/角色/场景/道具/光影/音效/对白/旁白/分镜提示词/镜头控制描述
      + 焦距/机位/构图/色调/动作/情绪（供视频生成）
    严格遵循 story 节点 data.duration（总时长）与 data.shotCount（分镜个数）约束。
    写回 story 节点 data.storyboard。
    """
    # 1) 取故事上下文 + 时长/分镜数约束
    story_ctx = ""
    write_oid = None
    duration = 0
    shot_count = 0
    for oid in (obj_ids or []):
        obj = await service.get_object(oid)
        if obj and obj["object_type"] == "story":
            write_oid = oid
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
            break
    if not story_ctx:
        for o in await service.list_objects(scene_id):
            if o["object_type"] == "story":
                write_oid = o["id"]
                d = o["data"]
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
                break
    if not story_ctx:
        return {"ok": False, "error": "没有可用的故事——请先「从文本生成故事」或填写剧情节点"}
    extra = str(params.get("prompt") or "").strip()
    if extra:
        story_ctx += f"\n\n【创作要求】{extra}"

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
        '      "shot_no": 1, "scene": "所属场景名", "location": "地点", "duration": 5,\n'
        '      "shot_size": "景别(远景/全景/中景/近景/特写)", "lens": "焦距(如 24mm/50mm/85mm)",\n'
        '      "camera_angle": "机位角度(平视/俯拍/仰拍/过肩)", "camera_motion": "运镜(固定/推/拉/摇/移/跟/环绕)",\n'
        '      "composition": "构图(居中/三分法/对称/引导线)", "lighting": "光线(自然光/硬光/逆光/夜景)",\n'
        '      "color": "色调(冷调/暖调/高对比)", "character": "画面人物", "character_action": "人物动作",\n'
        '      "props": ["该镜头出现的道具名(无则空数组)"],\n'
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
    )
    # 全字段分镜输出很长（每镜 13 字段 × 多镜头），默认 2000 tokens 会被截断导致解析失败 → 用 6000
    r2 = await _chat_full(sys, story_ctx, json_mode=True, temperature=0.5, max_tokens=6000)
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
    # 4) 写回 story 节点
    if write_oid:
        obj = await service.get_object(write_oid)
        await service.update_object(write_oid, data={**obj["data"], "storyboard": shots})
    return {"ok": True, "created": [write_oid] if write_oid else [],
            "storyboard": shots, "message": f"分镜生成完成 · {len(shots)} 个镜头（目标 {shot_count}）"}


async def _act_director_start(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """AI 导演台：一键排片（故事 → 资产 → 分镜 → 视频 → 人工审核）。

    创建导演任务并后台异步编排，返回 task_id 供前端轮询进度。
    """
    import asyncio
    from app.director import service as ds
    from app.director.orchestrator import run_director
    # 找到故事节点（选中优先，否则场景内第一个）
    story_id = ""
    for oid in (obj_ids or []):
        obj = await service.get_object(oid)
        if obj and obj["object_type"] == "story":
            story_id = oid
            break
    if not story_id:
        for o in await service.list_objects(scene_id):
            if o["object_type"] == "story":
                story_id = o["id"]
                break
    task_id = await ds.create_task(scene_id, story_id)
    # 时长/分镜数：优先 story 节点设置，其次请求参数
    sdur = 0
    scnt = 0
    if story_id:
        sobj = await service.get_object(story_id)
        if sobj:
            try:
                sdur = int(float(sobj["data"].get("duration") or 0))
            except Exception:  # noqa: BLE001
                sdur = 0
            try:
                scnt = int(float(sobj["data"].get("shotCount") or 0))
            except Exception:  # noqa: BLE001
                scnt = 0
    opts = {"generate_video": bool(params.get("generate_video", False)),
            "style": str(params.get("style") or ""),
            "duration": int(params.get("duration") or sdur or 0),
            "shot_count": int(params.get("shot_count") or scnt or 0)}
    asyncio.create_task(run_director(task_id, scene_id, story_id, opts))
    return {"ok": True, "task_id": task_id, "director": True,
            "message": "导演台已启动：故事→分镜→骨架→审核，可打开导演台面板查看进度"}


async def _act_film_analysis(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """影视拉片：上传视频 → 解析 → 镜头检测 → 抽帧 → 视觉分析 → 建镜头/帧对象（§14/§15/§68）。"""
    video_url = params.get("video_url") or ""
    if not video_url:
        return {"ok": False, "error": "缺少 video_url（请先上传视频后传入 /uploads/xxx.mp4）"}
    from app.film.breakdown import run_film_analysis
    return await run_film_analysis(scene_id, video_url)


# ─────────────────────────────────────────────────────────────────────────────
# 分发入口
# ─────────────────────────────────────────────────────────────────────────────

async def _act_batch_sku(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """批量 SKU（§27/§67）：对每个商品（及其 SKU 变体）生成主图+场景图+海报。"""
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] == "product"]
    results = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        skus = d.get("sku") or [{"name": d.get("name", "默认")}]
        sku_urls = []
        for sku in skus:
            sku_name = sku.get("name") if isinstance(sku, dict) else str(sku)
            # 把 SKU 名注入卖点上下文，让出图有区分度
            r_main = await _gen_image(scene_id, [oid], {**params, "size": "1024x1024", "prompt": params.get("prompt", "") or f"{sku_name} 商品主图"}, "main")
            r_scene = await _gen_image(scene_id, [oid], {**params, "size": "1024x1024", "prompt": params.get("prompt", "") or f"{sku_name} 使用场景图"}, "scene")
            r_poster = await _gen_image(scene_id, [oid], {**params, "size": "1024x1024", "prompt": params.get("prompt", "") or f"{sku_name} 营销海报"}, "poster")
            sku_urls.append({
                "sku": sku_name,
                "main": [u for u in (r_main.get("created") or [])],
                "scene": [u for u in (r_scene.get("created") or [])],
                "poster": [u for u in (r_poster.get("created") or [])],
            })
        results.append({"product": d.get("name", ""), "skus": sku_urls})
    return {"ok": bool(results), "results": results, "message": f"批量生成 {len(results)} 个商品"}


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
    """调用 embedding Provider 获取向量（深度增强 #2：RAG 真向量）。"""
    try:
        import httpx
        from app.providers.service import best_provider
        prov = await best_provider("embedding")
        if not prov:
            return None
        endpoint = (prov.get("endpoint") or "").rstrip("/")
        if not endpoint:
            return None
        models = prov.get("models") or []
        if isinstance(models, str):
            try:
                models = json.loads(models)
            except Exception:  # noqa: BLE001
                models = []
        model = str(models[0]) if models else "text-embedding-v3"
        headers = {"Authorization": f"Bearer {prov.get('api_key', '')}", "Content-Type": "application/json"}
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
# Skill 桥接（P1-03 / §42）：动作名以 skill: 开头 → 调技能运行时
# ─────────────────────────────────────────────────────────────────────────────

async def _act_skill(scene_id: str, skill_id: str, obj_ids: list[str], params: dict) -> dict:
    from app.skills import skill_manager
    objs = await service.list_objects(scene_id)
    if obj_ids:
        objs = [o for o in objs if o["id"] in obj_ids]
    context = {
        "scene_id": scene_id,
        "objects": [{"id": o["id"], "type": o["object_type"], "data": o["data"]} for o in objs[:20]],
        "project_id": "default",
    }
    result = await skill_manager.execute(skill_id, params or {}, context)
    success = bool(getattr(result, "success", False))
    message = getattr(result, "output", None) or getattr(result, "error", "skill 执行完成")
    return {
        "ok": success,
        "error": None if success else message,
        "message": message,
        "skill_id": skill_id,
    }


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


async def _act_generate_music(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """音频节点（BGM）：AI 识别分镜背景音乐 → 生成音乐风格/乐器/完整提示词，写回节点。

    仅做「音乐提示词生成」（后端暂无音乐合成 API，真实音频需外部 Suno 类服务）。
    自动连线剧情节点读取剧本，按节点选择的 shot_no 提取对应分镜 BGM 描述。
    """
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id)
                          if o["object_type"] == "audio"]
    if not targets:
        return {"ok": False, "error": "请先选择音频节点"}
    objs = {o["id"]: o for o in await service.list_objects(scene_id)}
    edges = await service.list_edges(scene_id)

    def _linked_story(o_id: str) -> dict | None:
        for e in edges:
            other = e["target_id"] if e["source_id"] == o_id else (e["source_id"] if e["target_id"] == o_id else None)
            if other and objs.get(other, {}).get("object_type") == "story":
                return objs[other]
        return None

    updated = []
    for oid in targets:
        obj = objs.get(oid)
        if not obj:
            continue
        d = obj["data"]
        shot_no = int(params.get("shot_no") or d.get("shot_no") or 0) or 0
        script = ""
        story = _linked_story(oid)
        if story:
            script = str((story.get("data") or {}).get("script") or "")
        bgm = str(params.get("desc") or d.get("desc") or "").strip()
        if not bgm and script and shot_no > 0:
            bgm = _shot_bgm(script, shot_no)
        if not bgm:
            updated.append(oid)
            continue
        sys = ("你是影视配乐师。根据分镜的背景音乐描述，输出 JSON："
               "{\"style\":\"音乐风格（如 轻松俏皮/悬疑紧张/温情治愈，给出具体风格名）\","
               "\"instruments\":\"乐器设定（如 尤克里里+轻快鼓点+环境采样）\","
               "\"prompt\":\"可直接用于音乐生成模型的完整中文提示词（含情绪/节奏/BPM/乐器/风格）\"}。"
               "只输出 JSON，不要多余文字。")
        r = await _llm_json(sys, f"分镜{shot_no}背景音乐描述：{bgm}")
        if not r:
            return {"ok": False, "error": "AI 生成音乐建议失败（检查 AI 配置）"}
        style = str(r.get("style") or "").strip()
        instruments = str(r.get("instruments") or "").strip()
        prompt = str(r.get("prompt") or "").strip()
        await service.update_object(oid, data={
            **d, "prompt": prompt, "style": style, "instruments": instruments,
            "desc": bgm, "shot_no": str(shot_no) if shot_no else d.get("shot_no", ""),
        })
        updated.append(oid)
    return {"ok": bool(updated), "updated": updated,
            "message": f"生成 {len(updated)} 段音乐提示词（风格/乐器建议已写回节点）"}


async def _act_generate_voiceover(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id)
                          if o["object_type"] in ("product", "story")]
    created = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        ctx = d.get("text") or d.get("summary") or d.get("name") or d.get("description") or ""
        sys = ("你是带货短剧配音导演。基于剧情/商品写一段 30-60 秒的配音稿"
               "（中文、口语化、有节奏、突出卖点），直接输出配音稿文本。")
        text = await _llm_text(sys, ctx)
        if not text:
            continue
        nid = await service.create_object(scene_id, "audio", x=400, y=float(obj.get("y") or 0) + 300,
                                          width=360, height=200,
                                          data={"text": text, "voiceover": True, "source_object_id": oid})
        created.append(nid)
    return {"ok": bool(created), "created": created, "message": f"生成 {len(created)} 段配音稿"}


async def _act_generate_subtitle(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    boards = [o for o in await service.list_objects(scene_id) if o["object_type"] == "storyboard"]
    if not boards:
        return {"ok": False, "error": "需要先有分镜对象"}
    lines = []
    for b in boards:
        dd = b["data"]
        if dd.get("dialogue"):
            lines.append(f"[{dd.get('scene', 1)}-{dd.get('shot', 1)}] {dd['dialogue']}")
    sys = ("你是短剧字幕师。把分镜台词整理成标准字幕 JSON，输出："
           '{"subtitles":[{"start":0,"end":3,"text":"..."}]}，每句 3-6 秒，只输出 JSON。')
    r = await _llm_json(sys, "\n".join(lines) if lines else "分镜台词为空，请按常见带货短剧编 5 句台词")
    payload = r or {"subtitles": [{"start": 0, "end": 3, "text": "（无台词）"}]}
    nid = await service.create_object(scene_id, "text", x=400, y=300, width=420, height=280,
                                      data={"name": "字幕", "subtitles": payload.get("subtitles", []),
                                            "subtitle": True})
    return {"ok": True, "created": [nid], "message": f"生成 {len(payload.get('subtitles', []))} 条字幕"}


async def _act_compose_final(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    from app.config import DATA_DIR
    vids = [o for o in await service.list_objects(scene_id) if o["object_type"] == "video"]
    local = []
    for o in vids:
        u = (o["data"] or {}).get("url", "")
        if u.startswith("/uploads/"):
            p = DATA_DIR / "uploads" / u[len("/uploads/"):]
            if p.exists():
                local.append(str(p))
    if len(local) < 2:
        return {"ok": False, "error": "成片合成需要至少 2 个本地视频对象（云端视频请先下载到 /uploads/）"}
    up = DATA_DIR / "uploads"
    up.mkdir(parents=True, exist_ok=True)
    name = f"final_{uuid.uuid4().hex[:12]}.mp4"
    listfile = up / f"concat_{uuid.uuid4().hex[:8]}.txt"
    listfile.write_text("\n".join(f"file '{p}'" for p in local), encoding="utf-8")
    out = up / name
    r = subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listfile),
                        "-c", "copy", str(out)], capture_output=True, text=True, timeout=300)
    if not out.exists() or out.stat().st_size < 1000:
        return {"ok": False, "error": f"ffmpeg 合成失败：{r.stderr[-200:] if r and r.stderr else '未知'}"}
    url = f"/uploads/{name}"
    nid = await service.create_object(scene_id, "video", x=500, y=400, width=340, height=240,
                                      data={"url": url, "prompt": "", "model": "ffmpeg", "composed": True})
    await _register_asset(scene_id, "video", url, name="成片", meta={"composed": True})
    return {"ok": True, "created": [nid], "message": f"合成成片（{len(local)} 段拼接）"}


async def _run_batch_async(scene_id: str, obj_ids: list[str], params: dict, tid: str) -> None:
    """后台执行批量：逐商品更新 done/total，完成后任务标记 completed/failed。"""
    try:
        products = obj_ids or [o["id"] for o in await service.list_objects(scene_id)
                               if o["object_type"] == "product"]
        total = len(products)
        await db.execute("UPDATE tasks SET total=$1 WHERE id=$2", max(total, 1), tid)
        done = 0
        for pid in products:
            try:
                await _gen_image(scene_id, [pid], {**params, "size": "1024x1024"}, "main")
                await _gen_image(scene_id, [pid], {**params, "size": "1024x1024"}, "scene")
                await _gen_image(scene_id, [pid], {**params, "size": "1024x1024"}, "poster")
            except Exception:  # noqa: BLE001
                pass
            done += 1
            await db.execute("UPDATE tasks SET done=$1 WHERE id=$2", done, tid)
        await db.execute("UPDATE tasks SET status='completed' WHERE id=$1", tid)
    except Exception:  # noqa: BLE001
        try:
            await db.execute("UPDATE tasks SET status='failed' WHERE id=$1", tid)
        except Exception:  # noqa: BLE001
            pass


async def _run_action(scene_id: str, action: str, object_ids: list[str] | None = None,
                        params: dict | None = None) -> dict:
    params = params or {}
    obj_ids = object_ids or []
    try:
        if action == "analyze_product":
            return await _act_analyze_product(scene_id, obj_ids, params)
        if action == "generate_strategy":
            return await _act_generate_strategy(scene_id, obj_ids, params)
        if action == "generate_visual_board":
            return await _act_generate_visual_board(scene_id, obj_ids, params)
        if action in ("generate_main_image", "generate_scene_image", "generate_poster", "generate_reference"):
            kind = "main" if action == "generate_main_image" else ("scene" if action == "generate_scene_image" else "poster")
            return await _gen_image(scene_id, obj_ids, params, kind)
        if action == "generate_prompt":
            return await _act_generate_prompt(scene_id, obj_ids, params)
        if action == "analyze_shot":
            return await _act_analyze_shot(scene_id, obj_ids, params)
        if action == "generate_video":
            return await _act_generate_video(scene_id, obj_ids, params)
        if action == "generate_story":
            return await _act_generate_story(scene_id, obj_ids, params)
        if action == "generate_story_from_text":
            return await _act_generate_story_from_text(scene_id, obj_ids, params)
        if action == "generate_storyboard":
            return await _act_generate_storyboard(scene_id, obj_ids, params)
        if action == "director_start":
            return await _act_director_start(scene_id, obj_ids, params)
        if action in ("generate_characters", "generate_scenes"):
            return await _act_llm_scene(scene_id, obj_ids, params, action)
        if action == "batch_generate":
            # 真异步批量（§54 / P2-06）：后台执行 + tasks 表进度，立即返回 task_id
            tid = "task_" + uuid.uuid4().hex[:16]
            await db.execute(
                """INSERT INTO tasks (id, canvas_id, project_id, type, status, done, total)
                   VALUES ($1,$2,'default','batch_generate','running',0,1)""",
                tid, scene_id,
            )
            asyncio.create_task(_run_batch_async(scene_id, obj_ids, params, tid))
            return {"ok": True, "async": True, "task_id": tid, "message": "批量生成已开始（后台执行）"}
        if action == "generate_detail_page":
            return await _act_generate_detail_page(scene_id, obj_ids, params)
        if action == "generate_shots":
            return await _act_generate_shots(scene_id, obj_ids, params)
        if action == "generate_images":
            return await _act_generate_images(scene_id, obj_ids, params)
        if action == "generate_node_image":
            return await _act_generate_node_image(scene_id, obj_ids, params)
        if action == "generate_node_video":
            return await _act_generate_node_video(scene_id, obj_ids, params)
        if action in ("analyze_video", "detect_shots", "extract_frames"):
            return await _act_film_analysis(scene_id, obj_ids, params)
        if action.startswith("skill:"):
            return await _act_skill(scene_id, action[6:], obj_ids, params)
        if action == "generate_voiceover":
            return await _act_generate_voiceover(scene_id, obj_ids, params)
        if action == "generate_music":
            return await _act_generate_music(scene_id, obj_ids, params)
        if action == "generate_subtitle":
            return await _act_generate_subtitle(scene_id, obj_ids, params)
        if action == "compose_final":
            return await _act_compose_final(scene_id, obj_ids, params)
        return {"ok": False, "error": f"未支持的动作: {action}"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"动作执行异常：{exc}"}


async def _run_action_task(scene_id: str, action: str, object_ids: list[str] | None,
                          params: dict, tid: str) -> None:
    """后台执行单个动作（深度增强 #3：AI 动作全异步）。"""
    try:
        result = await _run_action(scene_id, action, object_ids, params)
        await db.execute(
            "UPDATE tasks SET status=$1, done=1, total=1 WHERE id=$2",
            "completed" if result.get("ok") else "failed", tid,
        )
    except Exception:  # noqa: BLE001
        try:
            await db.execute("UPDATE tasks SET status='failed' WHERE id=$1", tid)
        except Exception:  # noqa: BLE001
            pass


async def execute_action(scene_id: str, action: str, object_ids: list[str] | None = None,
                        params: dict | None = None) -> dict:
    """动作分发入口（P1-05 §53 留痕 + 深度增强 #3：async_mode 全异步）。"""
    params = params or {}
    if params.get("async_mode"):
        tid = "task_" + uuid.uuid4().hex[:16]
        await db.execute(
            """INSERT INTO tasks (id, canvas_id, project_id, type, status, done, total)
               VALUES ($1,$2,'default',$3,'running',0,1)""",
            tid, scene_id, action,
        )
        asyncio.create_task(_run_action_task(scene_id, action, object_ids, params, tid))
        return {"ok": True, "async": True, "task_id": tid, "message": "动作已异步执行"}
    result = await _run_action(scene_id, action, object_ids, params)
    await _log_task(scene_id, action, "completed" if result.get("ok") else "failed")
    return result
