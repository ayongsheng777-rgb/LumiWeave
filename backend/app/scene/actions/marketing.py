"""场景动作·电商营销（商品分析 / 营销策略 / 视觉规划板 / 详情页 / 批量SKU /
精修白底图 / 卖点图 / 广告视频）。

从 actions.py 拆分而来（2026-08-29），函数实现原样未动。
2026-08-29 晚：对齐灵境「电商商品营销物料」画布——补精修白底图（全链路参考源）、
卖点图、参考生成广告视频；修复拆分时丢失的 _rag_retrieve 导入（详情页动作因此报错）。
"""
from __future__ import annotations

from app.scene import service

from app.scene.actions.media import _gen_image
from app.scene.actions.shared import (
    _llm_json,
    _rag_retrieve,
    _register_asset,
    _siliconflow_profile,
)


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
# 对齐灵境画布（2026-08-29）：精修白底图 / 卖点图 / 参考生成广告视频
# ─────────────────────────────────────────────────────────────────────────────

async def _act_refine_product_image(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """精修白底图（对齐灵境「电商大师-精修白底图」，全链路物料源头）。

    以商品主图（main_image）为参考做图生图精修，产出干净白底商品图；
    _gen_image 按 kind 自动回写 product.refined_image —— 后续主图/场景图/卖点图/
    海报/广告视频统一以它为参考图（_gen_image 参考优先级：refined_image → main_image）。
    """
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] == "product"]
    if not targets:
        return {"ok": False, "error": "请先创建商品(product)节点"}
    made: list[str] = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        main = str(d.get("main_image") or "").strip()
        if not main:
            return {"ok": False, "error": "请先在商品节点填写主图地址（main_image），精修以它为参考"}
        p = str(params.get("prompt") or "").strip() or (
            f"电商白底精修图，商品：{d.get('name','')}，保持商品外观/材质/颜色完全一致，"
            "纯净白色背景，专业摄影棚布光，产品精修质感，高清细节，去除杂物")
        r = await _gen_image(scene_id, [oid],
                             {**params, "prompt": p, "reference_images": [main],
                              "size": params.get("size", "1024x1024")}, "refined")
        if not r.get("ok"):
            return r
        made.extend(r.get("created") or [])
    return {"ok": bool(made), "created": made,
            "message": f"已精修 {len(made)} 张白底图（已设为后续物料的统一参考源）"}


async def _act_generate_selling_point_image(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """卖点图（对齐灵境「电商大师-卖点图」）：按商品卖点逐条生成卖点展示图。

    依赖 selling_points（可先跑「识别商品」自动提炼）；每条卖点一张图，
    参考商品图保持外观一致；上限 6 条防止刷量。
    """
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] == "product"]
    made: list[str] = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        points = d.get("selling_points") or []
        if isinstance(points, str):
            points = [points]
        points = [str(x) for x in points if str(x).strip()][:6]
        if not points:
            return {"ok": False, "error": "商品还没有卖点，请先执行「识别商品 / 提炼卖点」"}
        for point in points:
            p = (f"电商卖点展示图，商品：{d.get('name','')}，核心卖点：{point}，"
                 "将卖点可视化呈现在画面上（预留简短中文文案区域），商业海报构图，高级质感")
            r = await _gen_image(scene_id, [oid],
                                 {**params, "prompt": p, "size": params.get("size", "1024x1024")},
                                 "selling")
            if r.get("ok"):
                made.extend(r.get("created") or [])
    return {"ok": bool(made), "created": made, "message": f"生成 {len(made)} 张卖点图"}


async def _act_generate_ad_video(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """参考生成广告视频（对齐灵境「参考生成广告视频」）。

    参考图 = 商品精修图 → 主图（首帧，保持商品外观一致）；
    提示词融合卖点 + 营销策略文案基调，产出广告视频节点并回写 product.ad_video。
    2026-08-29 晚：改走视频 Provider 链逐个尝试（首选失败自动换备用）——
    首选硅基流动 Wan2.2 无 I2V 模型会报 "Model does not exist"，需能落到 MiniMax H3。
    """
    from app.providers.cloud_gen import cloud_video_generate
    from app.providers.service import route
    chain = await route("video")
    if not chain:
        return {"ok": False, "error": "未配置可用视频 Provider（请在「接口配置」添加云端视频）"}
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] == "product"]
    created: list[str] = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        sp = "，".join(d.get("selling_points", []) or [])
        strategy = d.get("strategy")
        tone = str(strategy.get("copy_tone") or "") if isinstance(strategy, dict) else ""
        p = str(params.get("prompt") or "").strip() or (
            f"电商广告视频，商品：{d.get('name','')}，核心卖点：{sp}，"
            f"镜头围绕商品特写与真实使用场景，商业广告质感，节奏明快"
            f"{('，文案基调：' + tone) if tone else ''}")
        ref = str(d.get("refined_image") or d.get("main_image") or "").strip()
        res: dict = {"ok": False, "error": "无可用视频 Provider"}
        errs: list[str] = []
        used_name = ""
        for prov in chain:
            try:
                res = await cloud_video_generate(prov["id"], p, image_url=ref,
                                                 duration=int(params.get("duration") or 6),
                                                 ratio=str(params.get("ratio") or "16:9"))
            except Exception as exc:  # noqa: BLE001
                errs.append(f"{prov.get('name') or prov['id']}: {exc}")
                continue
            if res.get("ok"):
                used_name = str(prov.get("name") or prov["id"])
                break
            errs.append(f"{prov.get('name') or prov['id']}: {res.get('error', '生成失败')}")
        if not res.get("ok"):
            return {"ok": False, "error": "广告视频生成失败（已试完全部视频 Provider）：" + "；".join(errs)[:300],
                    "logs": res.get("logs")}
        urls = [i.get("url") for i in res.get("videos", []) if isinstance(i, dict) and i.get("url")]
        base_x, base_y = float(obj.get("x") or 0), float(obj.get("y") or 0)
        for idx, u in enumerate(urls):
            nid = await service.create_object(scene_id, "video",
                                              x=base_x + 340, y=base_y + 620 + idx * 320,
                                              width=320, height=260,
                                              data={"prompt": p, "url": u, "model": used_name,
                                                    "source_object_id": oid, "kind": "ad"})
            created.append(nid)
            await _register_asset(scene_id, "video", u, name="商品·广告视频",
                                  meta={"kind": "ad", "source_object_id": oid})
        if urls:
            latest = await service.get_object(oid)
            if latest:
                await service.update_object(oid, data={**latest["data"], "ad_video": urls[0]})
    return {"ok": bool(created), "created": created, "message": f"生成 {len(created)} 个广告视频"}
