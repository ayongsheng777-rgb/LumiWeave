"""场景动作·媒体生成（图片 / 视频 / 镜头 / 节点级生成 / 拉片解析）。

从 actions.py 拆分而来（2026-08-29），函数实现原样未动。
"""
from __future__ import annotations

from typing import Any

from app.scene import service

from app.scene.actions.shared import (
    _image_provider,
    _label,
    _llm_text,
    _register_asset,
    _video_provider,
)


# 场景图变体词库（场景图 1 拖 N，对齐灵境画布「场景图→场景1~9」批量派生）
_SCENE_VARIANTS = [
    "厨房料理台场景", "客厅茶几场景", "办公室桌面场景", "户外露营场景",
    "卧室床头场景", "书房工作台场景", "餐厅餐桌场景", "阳台下午茶场景",
    "健身房场景", "浴室洗漱台场景", "咖啡厅场景", "节日送礼场景",
]


def _ref_label(d: dict, obj_type: str = "image") -> str:
    """参考图语义标签：用途/标题 → 中文说明，用于提示词 Ref 序号标注。"""
    purpose = str(d.get("purpose") or "").strip()
    title = str(d.get("title") or d.get("name") or d.get("selected") or "").strip()
    if purpose:
        return f"{purpose}{'·' + title if title else ''}"
    if title:
        return title
    if obj_type == "product":
        return "商品主图"
    return "参考图"


async def _collect_refs(
    scene_id: str,
    oid: str,
    params: dict,
    *,
    include_product: bool = True,
) -> list[tuple[str, str]]:
    """收集某视频/图片节点可用参考图（url, 语义标签）。

    优先级：显式 params.reference_images → 连到本节点的 image 资产 →
    场景内商品图（main_image / refined_image / url，带货一致性刚需）。
    返回 [(url, label)]，供提示词 Ref 序号标注与 native.reference_images 注入。
    """
    refs: list[tuple[str, str]] = []

    def _push(u: str, label: str) -> None:
        u = str(u or "").strip()
        if not u:
            return
        if any(u == r[0] for r in refs):
            return
        refs.append((u, label))

    for x in (params.get("reference_images") or []):
        if isinstance(x, dict):
            _push(x.get("url") or x.get("reference") or "", str(x.get("label") or "参考图"))
        else:
            _push(x, "参考图")

    # 连到本节点的 image 资产（素材库同一来源）
    if not refs:
        for e in await service.list_edges(scene_id):
            if e.get("target_id") != oid:
                continue
            src = await service.get_object(e.get("source_id") or "")
            if not src:
                continue
            sd = src.get("data") or {}
            st = src.get("object_type") or ""
            if st == "image":
                _push(sd.get("url"), _ref_label(sd, "image"))
            elif st == "product":
                _push(sd.get("main_image") or sd.get("refined_image") or sd.get("url"),
                      _ref_label(sd, "product"))

    # 场景内商品图兜底（未连线也带上，保证带货视频里商品外观一致）
    if include_product and not refs:
        for o in await service.list_objects(scene_id):
            if o["id"] == oid:
                continue
            d = o.get("data") or {}
            if o.get("object_type") == "product":
                _push(d.get("main_image") or d.get("refined_image") or d.get("url"),
                      _ref_label(d, "product"))
                break

    return refs


def _refs_into_prompt(p: str, refs: list[tuple[str, str]]) -> str:
    """把参考图语义标注写进提示词（对齐灵境 Ref 序号，供多参考视频模型区分角色/场景/商品）。"""
    if not refs:
        return p
    notes = "；".join(f"参考图{i + 1}={label}" for i, (_, label) in enumerate(refs))
    return f"{p}\n【参考图说明】{notes}"


async def _gen_image(scene_id: str, obj_ids: list[str], params: dict, kind: str) -> dict:
    prov = await _image_provider()
    if not prov:
        return {"ok": False, "error": "未配置可用图像 Provider（请在「接口配置」添加硅基流动等云端出图）"}
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] in ("product", "shot", "storyboard", "scene")]
    created = []
    prompt = params.get("prompt", "")
    # 参考生图（对齐灵境画布：电商物料以商品原图为参考做图生图，保持商品外观一致）。
    # 显式 params.reference_images 优先；商品节点自动取 refined_image（精修图）→ main_image（主图）。
    param_refs = [str(x) for x in (params.get("reference_images") or []) if x]
    # 场景图 1 拖 N（仅商品节点 + kind=scene 生效；count 上限 12）
    count = 1
    if kind == "scene":
        try:
            count = max(1, min(12, int(params.get("count") or 1)))
        except (TypeError, ValueError):
            count = 1
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        refs = list(param_refs)
        if not refs and obj["object_type"] == "product":
            ref = str(d.get("refined_image") or d.get("main_image") or "").strip()
            if ref:
                refs = [ref]
        # 自动拼提示词：用户给的优先，否则从对象数据生成
        base_prompt = prompt or d.get("prompt") or _auto_prompt(kind, obj["object_type"], d)
        if not base_prompt:
            continue
        from app.providers.cloud_gen import cloud_image_generate
        rounds = count if (kind == "scene" and obj["object_type"] == "product") else 1
        first_url = ""
        for round_i in range(rounds):
            p = base_prompt
            if rounds > 1:
                p = f"{base_prompt}，{_SCENE_VARIANTS[round_i % len(_SCENE_VARIANTS)]}"
            res = await cloud_image_generate(prov["id"], p, size=params.get("size", "1024x1024"),
                                             reference_images=refs or None)
            if not res.get("ok"):
                return {"ok": False, "error": res.get("error", "出图失败"), "logs": res.get("logs")}
            urls = [i["url"] for i in res.get("images", []) if i.get("url")]
            # 创建图片对象并回写引用。x/y 是表列（不在 data 里），从 obj 顶层取。
            base_x, base_y = float(obj.get("x") or 0), float(obj.get("y") or 0)
            for u in urls:
                nid = await service.create_object(scene_id, "image",
                                                  x=base_x + 340, y=base_y + len(created) * 300,
                                                  width=280, height=280,
                                                  data={"prompt": p, "url": u, "model": prov.get("name"), "source_object_id": oid})
                created.append(nid)
                await _register_asset(scene_id, "image", u, name=f"{_label(obj['object_type'])}·{kind}", meta={"kind": kind, "source_object_id": oid})
            if not first_url and urls:
                first_url = urls[0]
        # 回写原对象（首图；重读最新 data 避免多轮覆盖）
        if first_url:
            latest = await service.get_object(oid)
            if latest:
                await service.update_object(oid, data={**latest["data"], f"{kind}_image": first_url})
    return {"ok": bool(created), "created": created, "message": f"生成 {len(created)} 张图"}


def _auto_prompt(kind: str, obj_type: str, d: dict) -> str:
    if obj_type == "product":
        sp = "，".join(d.get("selling_points", []) or [])
        if kind == "refined":
            return (f"电商白底精修图，商品：{d.get('name','')}，保持商品外观/材质/颜色完全一致，"
                    "纯净白色背景，专业摄影棚布光，产品精修质感，高清细节")
        if kind == "selling":
            return (f"电商卖点展示图，商品：{d.get('name','')}，突出卖点：{sp}，"
                    "卖点可视化呈现，商业海报构图，高级质感")
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
        # 参考图收集（对齐灵境：商品图/人物图/场景图一并带上）+ Ref 语义标注
        refs = await _collect_refs(scene_id, oid, params)
        ref_urls = [u for u, _ in refs]
        if ref_urls:
            p = _refs_into_prompt(p, refs)
        # 负面提示词（V2.10）
        negative = str(params.get("negative") or d.get("negative_prompt") or "").strip()
        if negative:
            native["negative_prompt"] = negative
        from app.providers.cloud_gen import cloud_video_generate
        res = await cloud_video_generate(prov["id"], p,
                                         image_url=d.get("url") or params.get("image_url", "") or (ref_urls[0] if ref_urls else ""),
                                         duration=int(params.get("duration") or d.get("duration") or 5),
                                         ratio=str(params.get("ratio") or d.get("aspect_ratio") or "16:9"),
                                         negative=negative,
                                         native=native or None,
                                         resolution=reso)
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
        negative = str(params.get("negative") or d.get("negative_prompt") or "").strip()
        res = await cloud_image_generate(prov["id"], p,
                                         size=str(params.get("size") or d.get("size") or "1024x1024"),
                                         negative=negative,
                                         reference_images=refs or None)
        if not res.get("ok"):
            return {"ok": False, "error": res.get("error", "出图失败"), "logs": res.get("logs")}
        urls = [i.get("url") for i in res.get("images", []) if i.get("url")]
        if not urls:
            continue
        await service.update_object(oid, data={**d, "url": urls[0], "model": prov.get("name"), "prompt": p,
                                               "negative_prompt": negative})
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
        # 参考图：参数优先，其次连到本节点的 image 资产 + 场景内商品图（素材库同一来源）
        refs = await _collect_refs(scene_id, oid, params)
        ref_urls = [u for u, _ in refs]
        if ref_urls:
            p = _refs_into_prompt(p, refs)
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
        # 负面提示词 + 音频开关（V2.10）
        negative = str(params.get("negative") or d.get("negative_prompt") or "").strip()
        native: dict[str, Any] = {}
        if negative:
            native["negative_prompt"] = negative
        if params.get("generate_audio") is not None or d.get("generate_audio") is not None:
            native["generate_audio"] = bool(params.get("generate_audio", d.get("generate_audio")))
        from app.renderers.generate import render_media
        res = await render_media(
            "video",
            {
                "prompt": p,
                "negative": negative,
                "duration": int(params.get("duration") or d.get("duration") or 5),
                "ratio": str(params.get("ratio") or d.get("aspect_ratio") or "16:9"),
                "resolution": reso,
                **({"reference_images": ref_urls} if ref_urls else {}),
                **({"native": {**native, "camera_movement": motion}} if motion and motion != "固定镜头" else ({"native": native} if native else {})),
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


async def _act_film_analysis(scene_id: str, obj_ids: list[str], params: dict) -> dict:
    """影视拉片：上传视频 → 解析 → 镜头检测 → 抽帧 → 视觉分析 → 建镜头/帧对象（§14/§15/§68）。"""
    video_url = params.get("video_url") or ""
    if not video_url:
        return {"ok": False, "error": "缺少 video_url（请先上传视频后传入 /uploads/xxx.mp4）"}
    from app.film.breakdown import run_film_analysis
    return await run_film_analysis(scene_id, video_url)
