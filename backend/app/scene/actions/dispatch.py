"""场景动作·分发入口（动作路由 / 异步执行 / 任务留痕 / 导演台 / Skill 桥接）。

从 actions.py 拆分而来（2026-08-29），函数实现原样未动。
"""
from __future__ import annotations

import asyncio
import uuid

from app import db
from app.scene import service

from app.scene.actions.audio import (
    _act_compose_final,
    _act_generate_music,
    _act_generate_subtitle,
    _act_generate_voiceover,
)
from app.scene.actions.marketing import (
    _act_analyze_product,
    _act_batch_sku,
    _act_generate_detail_page,
    _act_generate_strategy,
    _act_generate_visual_board,
)
from app.scene.actions.media import (
    _act_analyze_shot,
    _act_film_analysis,
    _act_generate_images,
    _act_generate_node_image,
    _act_generate_node_video,
    _act_generate_prompt,
    _act_generate_shots,
    _act_generate_video,
    _gen_image,
)
from app.scene.actions.shared import _log_task
from app.scene.actions.story import (
    _act_generate_story,
    _act_generate_story_from_text,
    _act_generate_storyboard,
    _act_llm_scene,
    _act_storyboard_import_ai,
)


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
        if action == "storyboard_import_ai":
            return await _act_storyboard_import_ai(scene_id, obj_ids, params)
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
