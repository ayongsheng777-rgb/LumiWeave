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
                     temperature: float = 0.4, max_tokens: int = 2000) -> Any:
    from app.ai.client import chat_full
    return await chat_full(system, user, temperature=temperature, max_tokens=max_tokens,
                           json_mode=json_mode, scenario="scene_action", task_id="")


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


async def _llm_json(system: str, user: str) -> dict | None:
    r = await _chat_full(system, user, json_mode=True)
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


async def _llm_text(system: str, user: str) -> str | None:
    """注意：走 chat_full 拿 usage（P1-07），返回 content 字符串。"""
    r = await _chat_full(system, user, temperature=0.5)
    await _record_usage("", r)
    if not r.ok or not r.content:
        return None
    return r.content.strip() or None


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
        desc = f"商品名：{d.get('name','')}；品牌：{d.get('brand','')}；类目：{d.get('category','')}；已有描述：{d.get('description','')}"
        sys = "你是资深电商营销专家。分析商品并提炼 3-5 条核心卖点（中文，每条不超过 20 字），直接输出 JSON：{\"selling_points\":[...],\"marketing_plan\":\"一段话营销方案\"}。"
        r = await _llm_json(sys, desc)
        if r:
            patch = {"selling_points": r.get("selling_points", []), "marketing_plan": r.get("marketing_plan", "")}
            await service.update_object(oid, data={**d, **patch})
            made.append(oid)
    return {"ok": bool(made), "updated": made, "message": f"已分析 {len(made)} 个商品"}


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
    targets = obj_ids or [o["id"] for o in await service.list_objects(scene_id) if o["object_type"] in ("shot", "storyboard", "image")]
    created = []
    for oid in targets:
        obj = await service.get_object(oid)
        if not obj:
            continue
        d = obj["data"]
        p = params.get("prompt") or d.get("prompt") or d.get("description") or ""
        if not p:
            continue
        from app.providers.cloud_gen import cloud_video_generate
        res = await cloud_video_generate(prov["id"], p,
                                         image_url=d.get("url") or params.get("image_url", ""),
                                         duration=int(params.get("duration", 5)),
                                         ratio=params.get("ratio", "16:9"))
        if not res.get("ok"):
            return {"ok": False, "error": res.get("error", "生视频失败"), "logs": res.get("logs")}
        urls = [i.get("url") for i in res.get("videos", []) if i.get("url")]
        base_x, base_y = float(obj.get("x") or 0), float(obj.get("y") or 0)
        for idx, u in enumerate(urls):
            nid = await service.create_object(scene_id, "video",
                                              x=base_x + 340, y=base_y + idx * 320,
                                              width=320, height=260,
                                              data={"prompt": p, "url": u, "model": prov.get("name"), "source_object_id": oid})
            created.append(nid)
            await _register_asset(scene_id, "video", u, name=f"{_label(obj['object_type'])}视频", meta={"source_object_id": oid})
    return {"ok": bool(created), "created": created, "message": f"生成 {len(created)} 个视频"}


async def _act_llm_scene(scene_id: str, obj_ids: list[str], params: dict, action: str) -> dict:
    """通用 LLM 生成类动作（剧情/人物/场景/分镜/批量文案等）。"""
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
        if action in ("generate_main_image", "generate_scene_image", "generate_poster", "generate_reference"):
            kind = "main" if action == "generate_main_image" else ("scene" if action == "generate_scene_image" else "poster")
            return await _gen_image(scene_id, obj_ids, params, kind)
        if action == "generate_prompt":
            return await _act_generate_prompt(scene_id, obj_ids, params)
        if action == "analyze_shot":
            return await _act_analyze_shot(scene_id, obj_ids, params)
        if action == "generate_video":
            return await _act_generate_video(scene_id, obj_ids, params)
        if action in ("generate_story", "generate_characters", "generate_scenes", "generate_storyboard"):
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
        if action in ("analyze_video", "detect_shots", "extract_frames"):
            return await _act_film_analysis(scene_id, obj_ids, params)
        if action.startswith("skill:"):
            return await _act_skill(scene_id, action[6:], obj_ids, params)
        if action == "generate_voiceover":
            return await _act_generate_voiceover(scene_id, obj_ids, params)
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
