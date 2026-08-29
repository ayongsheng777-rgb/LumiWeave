"""MCP Render Kernel Tools — 渲染任务接口（规格书 §8 MCP Tool）。"""
from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Optional

router = APIRouter(tags=["render"])


@router.post("/create")
async def create_render(visual_intent: dict, capability_required: Optional[list[str]] = None):
    """
    前端 canvas 点击「渲染」时调用。
    接收 VisualIntent → 编译 → 创建 RenderJob → 返回 job_id。
    """
    try:
        from app.render_kernel import compile, get_job_manager
        plan = compile(visual_intent, capability_required)
        jm = get_job_manager()
        job = await jm.submit_plan(plan)
        return {"ok": True, "data": {
            "job_id": job.job_id,
            "plan_id": job.plan_id,
            "engine": job.engine,
            "status": job.status.value,
        }}
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": f"[RenderKernel] {e}"}


@router.get("/status/{job_id}")
async def query_render_status(job_id: str):
    """轮询任务状态（前端每 3s 调用），从 DB 读最新状态。"""
    from app.render_kernel.db import job_get, job_get_events
    try:
        job = await job_get(job_id)
        if not job:
            return {"ok": False, "error": f"Job {job_id} not found"}
        events = await job_get_events(job_id)
        return {"ok": True, "data": {
            "job_id": job_id,
            "status": job.status.value,
            "engine": job.engine,
            "output_urls": job.output_urls,
            "error": job.error,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "events": events,
        }}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/cancel/{job_id}")
async def cancel_render_job(job_id: str):
    """取消渲染任务。"""
    from app.render_kernel import get_job_manager
    jm = get_job_manager()
    try:
        await jm.cancel_job(job_id)
        return {"ok": True, "data": {"job_id": job_id, "status": "cancelled"}}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/jobs")
async def list_render_jobs(limit: int = 50):
    """最近渲染任务列表。"""
    from app.render_kernel.db import job_list
    jobs = await job_list(limit=limit)
    return {"ok": True, "data": [{
        "job_id": j.job_id,
        "plan_id": j.plan_id,
        "engine": j.engine,
        "status": j.status.value,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "output_urls": j.output_urls,
    } for j in jobs]}


@router.get("/events/{job_id}")
async def get_render_events(job_id: str):
    """获取任务事件流（前端重连时拉取）。"""
    from app.render_kernel.db import job_get_events
    events = await job_get_events(job_id)
    return {"ok": True, "data": events}


# ── WebSocket 端点 ────────────────────────────────────────────────────────────
websocket_router = APIRouter()


@websocket_router.websocket("/ws/render")
async def render_websocket(websocket: WebSocket):
    """
    渲染任务实时推送 WebSocket。
    客户端连接时订阅 job_ids 参数（逗号分隔）。
    """
    from app.render_kernel.websocket import get_ws_manager
    from app.render_kernel.db import job_get_events
    from app import auth as _auth

    # 与 /ws 一致：WebSocket 不经 HTTP 鉴权中间件，须自行校验 token
    token = websocket.query_params.get("token", "")
    if not _auth.verify_token(token):
        await websocket.close(code=1008)
        return

    ws_manager = get_ws_manager()
    raw_job_ids = websocket.query_params.get("job_ids", "")
    job_ids = [j.strip() for j in raw_job_ids.split(",") if j.strip()]

    await ws_manager.connect(websocket, job_ids)

    # 发送存量事件
    for jid in job_ids:
        events = await job_get_events(jid)
        for ev in events:
            await websocket.send_json(ev)

    try:
        while True:
            data = await websocket.receive_text()
            # 客户端可发 {"action":"subscribe","job_id":"xxx"} 动态订阅
            import json
            try:
                msg = json.loads(data)
                if msg.get("action") == "subscribe":
                    ws_manager.subscribe(websocket, msg["job_id"])
            except Exception:
                pass
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
