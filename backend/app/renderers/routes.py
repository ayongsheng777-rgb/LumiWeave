from __future__ import annotations

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app import db
from app.ai.config import mask_key
from app.renderers import init_renderers, renderer_registry
from app.renderers.dispatcher import dispatch_render_task, queue_status
from app.task_service import add_event, create_task, set_result, set_status
from app.renderers.workflow_builder import build_workflow

router = APIRouter()


@router.get("")
async def list_renderers():
    """返回完整可配置字段（api_key 脱敏），供前端配置表单回填。"""
    rows = await db.fetch(
        "SELECT id, name, type, endpoint, api_key, client_id, enabled, timeout FROM renderers ORDER BY name"
    )
    out = []
    for r in rows:
        d = dict(r)
        raw_key = d.get("api_key") or ""
        d["api_key"] = mask_key(raw_key)
        d["has_api_key"] = bool(raw_key)
        out.append(d)
    return {"renderers": out}


@router.post("")
async def upsert_renderer(request: Request):
    """新增/更新渲染器（ComfyUI 等），改完立即重载注册表生效。"""
    data = await request.json() or {}
    rid = str(data.get("id") or "").strip()
    if not rid:
        return JSONResponse(status_code=400, content={"error": "id 不能为空"})
    incoming_key = str(data.get("api_key") or "")
    if incoming_key.startswith("****"):
        existing = await db.fetchrow("SELECT api_key FROM renderers WHERE id=$1", rid)
        incoming_key = existing["api_key"] if existing else ""
    await db.execute(
        """INSERT INTO renderers (id, name, type, endpoint, api_key, client_id, enabled, timeout)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET
             name=EXCLUDED.name, type=EXCLUDED.type, endpoint=EXCLUDED.endpoint,
             api_key=EXCLUDED.api_key, client_id=EXCLUDED.client_id,
             enabled=EXCLUDED.enabled, timeout=EXCLUDED.timeout, updated_at=NOW()""",
        rid,
        str(data.get("name", rid)),
        str(data.get("type", "comfyui")),
        str(data.get("endpoint", "")),
        incoming_key,
        str(data.get("client_id", "")),
        bool(data.get("enabled", False)),
        int(data.get("timeout", 600)),
    )
    await init_renderers()
    return {"ok": True, "renderers": renderer_registry.list()}


@router.delete("/{renderer_id}")
async def delete_renderer(renderer_id: str):
    await db.execute("DELETE FROM renderers WHERE id=$1", renderer_id)
    await init_renderers()
    return {"ok": True, "renderers": renderer_registry.list()}


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


@router.post("/media/generate")
async def media_generate(request: Request):
    """统一媒体生成入口（节点「生成」按钮用）。

    入参：
      kind: 'image' | 'video'
      render_mode: 'cloud' | 'comfyui'
      provider_id: 云端 provider（cloud 模式）
      model: 模型名（可选，cloud 覆盖 provider 默认 / comfyui 填 checkpoint）
      renderer_id: ComfyUI 渲染器（comfyui 模式，可选，留空自动挑第一个启用的）
      params: {prompt, negative, ratio, seed, steps, duration, ...}
    返回：{ok, images, videos, url, logs, error}
    """
    data = await request.json() or {}
    kind = str(data.get("kind") or "image")
    params = data.get("params") or {}
    if not isinstance(params, dict):
        return JSONResponse(status_code=400, content={"error": "params 必须是对象"})
    from app.renderers.generate import render_media
    result = await render_media(
        kind, params,
        render_mode=str(data.get("render_mode") or "comfyui"),
        provider_id=str(data.get("provider_id") or ""),
        model=str(data.get("model") or ""),
        renderer_id=str(data.get("renderer_id") or ""),
    )
    return result


@router.get("/{renderer_id}/health")
async def renderer_health(renderer_id: str):
    r = renderer_registry.get(renderer_id)
    if not r:
        return JSONResponse(status_code=404, content={"error": "Renderer 未注册"})
    health = await r.health()
    return {"id": renderer_id, "name": r.cfg.name, **health}


@router.post("/{renderer_id}/generate")
async def renderer_generate(renderer_id: str, request: Request):
    r = renderer_registry.get(renderer_id)
    if not r:
        return JSONResponse(status_code=404, content={"error": "Renderer 未注册"})
    if not r.cfg.enabled:
        return JSONResponse(status_code=400, content={"error": "Renderer 未启用"})
    data = await request.json()

    # 两种调用方式：
    # 1. workflow：直接传 ComfyUI workflow JSON（规格完整）
    # 2. params + mode：从简化参数自动构建工作流（前端用这个）
    workflow = data.get("workflow")
    if isinstance(workflow, dict):
        # 直接传入了完整 workflow，不转换
        pass
    elif data.get("params"):
        # 从简化参数构建工作流
        mode  = str(data.get("mode", "text2image"))
        model = str(data.get("model", ""))
        workflow = build_workflow(data["params"], mode, model=model)
    else:
        return JSONResponse(status_code=400,
                            content={"error": "必须传 workflow（完整 JSON）或 params（简化参数）+ mode"})

    tid = await create_task(
        user_id=data.get("user_id", ""), canvas_id=data.get("canvas_id", ""),
        renderer_id=renderer_id,
    )
    await add_event(tid, "render_queued", {"renderer": renderer_id, "mode": data.get("mode", "text2image")})
    await set_status(tid, "running")

    result = await r.generate(workflow)
    if not result.get("ok"):
        await set_status(tid, "failed")
        await add_event(tid, "render_failed", {"error": result.get("error")})
        return {"task_id": tid, "ok": False, "error": result.get("error")}

    await set_status(tid, "completed")
    videos = result.get("videos", [])
    images = result.get("images", [])
    await set_result(tid, json.dumps(videos or images, ensure_ascii=False),
                     {"prompt_id": result.get("prompt_id"), "images": images, "videos": videos})
    await add_event(tid, "render_done", {"prompt_id": result.get("prompt_id"),
                                         "images": images, "videos": videos})
    return {"task_id": tid, "ok": True, "prompt_id": result.get("prompt_id"),
            "images": images, "videos": videos}


@router.post("/{renderer_id}/cancel")
async def renderer_cancel(renderer_id: str, request: Request):
    r = renderer_registry.get(renderer_id)
    if not r:
        return JSONResponse(status_code=404, content={"error": "Renderer 未注册"})
    data = await request.json() or {}
    ok = await r.cancel(data.get("prompt_id"))
    return {"ok": ok}
