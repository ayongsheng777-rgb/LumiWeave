from __future__ import annotations

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.renderers import init_renderers, renderer_registry
from app.renderers.dispatcher import dispatch_render_task, queue_status
from app.task_service import add_event, create_task, set_result, set_status

router = APIRouter()


@router.get("")
async def list_renderers():
    return {"renderers": renderer_registry.list()}


@router.get("/dispatch/status")
async def dispatch_status():
    """异构算力路由状态：本地队列长度 / worker 存活 / 本地与云端地址。"""
    return queue_status()


@router.post("/dispatch")
async def dispatch(request: Request):
    """智能算力路由入口：按工作流内容自动派发本地队列或云端实例。"""
    data = await request.json()
    workflow = data.get("workflow")
    if not isinstance(workflow, dict):
        return JSONResponse(status_code=400, content={"error": "workflow 必须是对象"})
    wait = bool(data.get("wait", True))
    task_id = str(data.get("task_id") or f"dispatch_{id(workflow)}")
    result = await dispatch_render_task(task_id, workflow, wait=wait)
    return result


@router.get("/{renderer_id}/health")
async def renderer_health(renderer_id: str):
    r = renderer_registry.get(renderer_id)
    if not r:
        return JSONResponse(status_code=404, content={"error": "Renderer 未注册"})
    return {"id": renderer_id, "healthy": await r.health_check()}


@router.post("/{renderer_id}/generate")
async def renderer_generate(renderer_id: str, request: Request):
    r = renderer_registry.get(renderer_id)
    if not r:
        return JSONResponse(status_code=404, content={"error": "Renderer 未注册"})
    if not r.cfg.enabled:
        return JSONResponse(status_code=400, content={"error": "Renderer 未启用"})
    data = await request.json()
    workflow = data.get("workflow")
    if not isinstance(workflow, dict):
        return JSONResponse(status_code=400, content={"error": "workflow 必须是对象"})

    tid = await create_task(
        user_id=data.get("user_id", ""), canvas_id=data.get("canvas_id", ""),
        renderer_id=renderer_id,
    )
    await add_event(tid, "render_queued", {"renderer": renderer_id})
    await set_status(tid, "running")

    result = await r.generate(workflow)
    if not result.get("ok"):
        await set_status(tid, "failed")
        await add_event(tid, "render_failed", {"error": result.get("error")})
        return {"task_id": tid, "ok": False, "error": result.get("error")}

    await set_status(tid, "completed")
    await set_result(tid, json.dumps(result.get("images", []), ensure_ascii=False),
                     {"prompt_id": result.get("prompt_id"), "images": result.get("images", [])})
    await add_event(tid, "render_done", {"prompt_id": result.get("prompt_id"),
                                         "images": result.get("images", [])})
    return {"task_id": tid, "ok": True, "prompt_id": result.get("prompt_id"),
            "images": result.get("images", [])}


@router.post("/{renderer_id}/cancel")
async def renderer_cancel(renderer_id: str, request: Request):
    r = renderer_registry.get(renderer_id)
    if not r:
        return JSONResponse(status_code=404, content={"error": "Renderer 未注册"})
    data = await request.json() or {}
    ok = await r.cancel(data.get("prompt_id"))
    return {"ok": ok}
