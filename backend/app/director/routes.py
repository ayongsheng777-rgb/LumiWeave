"""AI 导演台路由：创建导演任务 + 查询状态/进度/结果。"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.director import service as ds
from app.director.orchestrator import run_director

router = APIRouter()


@router.post("/create")
async def director_create(request: Request):
    """创建导演任务并启动编排。

    入参：{scene_id, story_id?, duration?, style?, generate_video?}
    返回：{ok, task_id}；编排在后台异步执行。
    """
    data = await request.json() or {}
    scene_id = str(data.get("scene_id") or "").strip()
    if not scene_id:
        return JSONResponse(status_code=400, content={"error": "scene_id 不能为空"})
    story_id = str(data.get("story_id") or "").strip()
    project_id = str(data.get("project_id") or "").strip()
    opts = {
        "duration": data.get("duration"),
        "style": str(data.get("style") or ""),
        "generate_video": bool(data.get("generate_video", False)),
    }
    task_id = await ds.create_task(scene_id, story_id, project_id)
    asyncio.create_task(run_director(task_id, scene_id, story_id, opts))
    return {"ok": True, "task_id": task_id, "message": "导演任务已启动"}


@router.get("/task/{task_id}")
async def director_task(task_id: str):
    task = await ds.get_task(task_id)
    if not task:
        return JSONResponse(status_code=404, content={"error": "导演任务不存在"})
    return {"ok": True, "task": task}


@router.get("/tasks")
async def director_tasks(scene_id: str = ""):
    if not scene_id:
        return JSONResponse(status_code=400, content={"error": "scene_id 不能为空"})
    tasks = await ds.list_tasks(scene_id)
    return {"ok": True, "tasks": tasks}


@router.post("/task/{task_id}/video")
async def director_generate_video(task_id: str):
    """导演任务进入视频生成步骤（用户审核分镜后点「生成视频」）。"""
    task = await ds.get_task(task_id)
    if not task:
        return JSONResponse(status_code=404, content={"error": "导演任务不存在"})
    scene_id = str(task.get("scene_id") or "")
    shot_ids = ((task.get("result") or {}).get("shot_ids")) or []
    if not scene_id or not shot_ids:
        return JSONResponse(status_code=400, content={"error": "任务没有可生成视频的分镜"})
    from app.director.orchestrator import _step_video
    asyncio.create_task(_step_video(task_id, scene_id, shot_ids))
    return {"ok": True, "message": "视频生成已启动"}
