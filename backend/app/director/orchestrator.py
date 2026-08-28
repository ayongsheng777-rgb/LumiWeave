"""AI 导演台编排器（Director Orchestrator）。

把「故事节点 → 影视生产流程」串成一条可跟踪的异步任务：
    INIT → ANALYZING → ASSET_GENERATING → SHOT_GENERATING → VIDEO_GENERATING → REVIEWING → APPROVED / FAILED

每一步更新 director_task 的 status / progress / current_step / log / result，
前端 DirectorPanel 轮询展示进度与结果审核。
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from app import db
from app.director import service as ds
from app.scene import service as ss

# ─────────────────────────────────────────────────────────────────────────────
# LLM 工具（复用 scene.actions 的 chat_full 封装）
# ─────────────────────────────────────────────────────────────────────────────

async def _chat_json(system: str, user: str) -> dict | None:
    from app.scene.actions import _chat_full
    r = await _chat_full(system, user, json_mode=True, temperature=0.4, max_tokens=3000)
    if not r.ok or not r.content:
        return None
    m = re.search(r"\{.*\}", r.content, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:  # noqa: BLE001
        return None


def _place(scene_id: str, existing: list[dict], idx: int, row: int = 0) -> tuple[float, float]:
    base_y = max([float(o.get("y") or 0) + float(o.get("height") or 0) for o in existing] or [0]) + 80
    return 80 + (idx % 4) * 330, base_y + row * 320


# ─────────────────────────────────────────────────────────────────────────────
# 各步骤
# ─────────────────────────────────────────────────────────────────────────────

async def _step_analyze(task_id: str, scene_id: str, story_id: str) -> dict:
    """ANALYZING：取故事上下文（三幕式/剧本/梗概）。"""
    await ds.update_task(task_id, status="ANALYZING", progress=10,
                         current_step="读取故事", append_log={"step": "analyze", "message": "读取故事节点…"})
    obj = await ss.get_object(story_id) if story_id else None
    ctx = ""
    if obj and obj["object_type"] == "story":
        d = obj["data"]
        ctx = (str(d.get("script") or "") or str(d.get("story") or "")
               or str(d.get("summary") or "") or str(d.get("text") or "")).strip()
    if not ctx:
        # 场景内找第一个 story
        for o in await ss.list_objects(scene_id):
            if o["object_type"] == "story":
                story_id = o["id"]
                d = o["data"]
                ctx = (str(d.get("script") or "") or str(d.get("story") or "")
                       or str(d.get("summary") or "") or str(d.get("text") or "")).strip()
                break
    if not ctx:
        raise RuntimeError("没有可用的故事——请先「从文本生成故事」或填写剧情节点")
    await ds.update_task(task_id, progress=15, current_step="故事就绪",
                         append_log={"step": "analyze", "message": f"故事就绪（{len(ctx)} 字）"})
    return {"story_id": story_id, "ctx": ctx}


async def _step_assets(task_id: str, scene_id: str, ctx: str) -> dict:
    """ASSET_GENERATING：LLM 生成角色/场景/道具 → 创建场景对象 + 从故事连线。"""
    await ds.update_task(task_id, status="ASSET_GENERATING", progress=35,
                         current_step="生成角色/场景/道具", append_log={"step": "assets", "message": "AI 拆解资产…"})
    sys = (
        "你是影视美术指导。根据故事方案提取影视生产所需的资产清单，严格只输出 JSON：\n"
        '{\n'
        '  "characters": [{"name":"人物名","appearance":"外貌","clothing":"服装","personality":"性格","prompt":"角色视觉提示词(中英文混合,供出图)"}],\n'
        '  "scenes": [{"name":"场景名","location":"地点","time":"时间","weather":"天气","lighting":"光线","style":"美术风格","prompt":"场景视觉提示词"}],\n'
        '  "props": [{"name":"道具名","description":"作用","prompt":"道具视觉提示词"}]\n'
        "}\n"
        "要求：贴合故事、数量适中（角色 1-3、场景 2-4、道具 0-3），全部中文。"
    )
    r = await _chat_json(sys, ctx[:4000])
    if not r:
        raise RuntimeError("资产生成失败（检查 AI 配置）")
    existing = await ss.list_objects(scene_id)
    created: dict[str, list[str]] = {"characters": [], "scenes": [], "props": []}
    # 故事 → 资产的连线（数据流形态）
    story_obj = next((o for o in existing if o["object_type"] == "story"), None)
    story_oid = story_obj["id"] if story_obj else ""
    for key, obj_type in (("characters", "character"), ("scenes", "scene"), ("props", "prop")):
        items = r.get(key) or []
        if not isinstance(items, list):
            continue
        for idx, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            x, y = _place(scene_id, existing, idx, len(created["characters"]) + len(created["scenes"]))
            payload: dict[str, Any] = {
                "name": str(item.get("name") or ""),
                "description": str(item.get("description") or item.get("appearance") or item.get("prompt") or ""),
                "prompt": str(item.get("prompt") or item.get("description") or ""),
            }
            if obj_type == "character":
                payload.update({"appearance": str(item.get("appearance") or ""),
                                "clothing": str(item.get("clothing") or ""),
                                "personality": str(item.get("personality") or "")})
            if obj_type == "scene":
                payload.update({"location": str(item.get("location") or ""),
                                "time": str(item.get("time") or ""),
                                "weather": str(item.get("weather") or ""),
                                "lighting": str(item.get("lighting") or ""),
                                "style": str(item.get("style") or "")})
            nid = await ss.create_object(scene_id, obj_type, x=x, y=y, width=300, height=260, data=payload)
            created[key].append(nid)
            if story_oid:
                try:
                    await ss.create_edge(scene_id, story_oid, nid, "default", {"kind": "asset"})
                except Exception:  # noqa: BLE001
                    pass
    total = len(created["characters"]) + len(created["scenes"]) + len(created["props"])
    await ds.update_task(task_id, progress=55, current_step="资产就绪",
                         append_log={"step": "assets", "message": f"资产就绪：角色{len(created['characters'])} / 场景{len(created['scenes'])} / 道具{len(created['props'])}"},
                         result={"assets": created, "shots": [], "videos": []})
    return {"assets": created, "total": total}


async def _step_shots(task_id: str, scene_id: str, story_id: str) -> dict:
    """SHOT_GENERATING：全字段分镜 → 写回 story + 创建 shot 对象 + 写入分镜脚本节点。"""
    await ds.update_task(task_id, status="SHOT_GENERATING", progress=65,
                         current_step="生成分镜", append_log={"step": "shots", "message": "AI 生成全字段分镜…"})
    from app.scene.actions import _act_generate_storyboard
    r = await _act_generate_storyboard(scene_id, [story_id], {})
    if not r.get("ok"):
        raise RuntimeError(r.get("error") or "分镜生成失败")
    shots = r.get("storyboard") or []
    # 创建 shot 对象（画布可视化）+ story→分镜脚本→镜头 连线
    existing = await ss.list_objects(scene_id)
    shot_ids: list[str] = []
    story_obj2 = next((o for o in existing if o["object_type"] == "story"), None)
    story_oid2 = story_obj2["id"] if story_obj2 else ""
    for idx, s in enumerate(shots):
        if not isinstance(s, dict):
            continue
        x, y = _place(scene_id, existing, idx, 0)
        nid = await ss.create_object(scene_id, "shot", x=x, y=y, width=320, height=260,
                                     data={**s, "shot_no": s.get("shot_no", idx + 1)})
        shot_ids.append(nid)
    # 分镜脚本节点：场景内有 storyboard 对象则写入，没有则创建（影视复刻拉片左侧菜单可添加）
    sb_obj = next((o for o in existing if o["object_type"] == "storyboard"), None)
    if sb_obj:
        await ss.update_object(sb_obj["id"], data={**sb_obj["data"], "shots": shots})
        sb_oid = sb_obj["id"]
    else:
        existing2 = await ss.list_objects(scene_id)
        bx, by = _place(scene_id, existing2, 0, 1)
        sb_oid = await ss.create_object(scene_id, "storyboard", x=bx, y=by, width=420, height=520,
                                        data={"title": "分镜脚本", "shots": shots})
    # 连线：story → storyboard → shot
    if story_oid2:
        try:
            await ss.create_edge(scene_id, story_oid2, sb_oid, "default", {"kind": "storyboard"})
        except Exception:  # noqa: BLE001
            pass
    for sid in shot_ids:
        try:
            await ss.create_edge(scene_id, sb_oid, sid, "default", {"kind": "shot"})
        except Exception:  # noqa: BLE001
            pass
    await ds.update_task(task_id, progress=85, current_step=f"分镜就绪（{len(shots)}）",
                         append_log={"step": "shots", "message": f"分镜就绪：{len(shots)} 个镜头"})
    return {"shot_ids": shot_ids, "shots": shots}


async def _step_video(task_id: str, scene_id: str, shot_ids: list[str]) -> dict:
    """VIDEO_GENERATING（可选）：逐镜头生成视频。"""
    await ds.update_task(task_id, status="VIDEO_GENERATING", progress=92,
                         current_step="生成镜头视频", append_log={"step": "video", "message": "逐镜头生成视频（可选步骤）…"})
    from app.scene.actions import _act_generate_video
    r = await _act_generate_video(scene_id, shot_ids, {})
    if not r.get("ok"):
        await ds.update_task(task_id, append_log={"step": "video", "message": f"视频生成跳过：{r.get('error', '')[:120]}"})
        return {"videos": []}
    videos = r.get("created") or []
    # 连线：shot → video（_act_generate_video 的对象 data.source_object_id 指向来源镜头）
    for vid in videos:
        vobj = await ss.get_object(vid)
        if not vobj:
            continue
        src = ((vobj.get("data") or {}).get("source_object_id")) or ""
        if src:
            try:
                await ss.create_edge(scene_id, src, vid, "default", {"kind": "video"})
            except Exception:  # noqa: BLE001
                pass
    await ds.update_task(task_id, progress=97, append_log={"step": "video", "message": f"视频就绪：{len(videos)} 条"})
    return {"videos": videos}


# ─────────────────────────────────────────────────────────────────────────────
# 编排入口
# ─────────────────────────────────────────────────────────────────────────────

async def run_director(task_id: str, scene_id: str, story_id: str = "",
                       opts: dict | None = None) -> None:
    """异步执行导演编排（独立任务，不阻塞请求）。"""
    opts = opts or {}
    try:
        await ds.update_task(task_id, status="ANALYZING", current_step="启动导演编排",
                             append_log={"step": "start", "message": "导演台启动…"})
        # 1) 分析故事
        ctx = await _step_analyze(task_id, scene_id, story_id)
        # 2) 资产
        assets = await _step_assets(task_id, scene_id, ctx["ctx"])
        # 3) 分镜
        shots = await _step_shots(task_id, scene_id, ctx["story_id"])
        # 4) 视频（可选）
        videos: dict = {"videos": []}
        if opts.get("generate_video"):
            videos = await _step_video(task_id, scene_id, shots["shot_ids"])
        # 5) 完成 → 待人工审核
        result = {"assets": assets.get("assets", {}),
                  "shots": shots["shots"], "shot_ids": shots["shot_ids"],
                  "videos": videos.get("videos", [])}
        await ds.update_task(task_id, status="REVIEWING", progress=100, current_step="待人工审核",
                             result=result,
                             append_log={"step": "done", "message": "导演编排完成，等待人工审核（可修改/重新生成单项）"})
    except Exception as exc:  # noqa: BLE001
        try:
            await ds.update_task(task_id, status="FAILED",
                                 append_log={"step": "error", "message": f"编排失败：{exc}"})
        except Exception:  # noqa: BLE001
            pass
