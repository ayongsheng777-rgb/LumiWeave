"""画布工作流执行路由：REST 兜底 + WebSocket 实时打点。"""
from __future__ import annotations

from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Request, WebSocket
from fastapi.responses import JSONResponse

from app import auth
from app.agent.engine import WorkflowEngine
from app.agent.types import WorkflowGraph

router = APIRouter()


async def _run_graph(graph: WorkflowGraph, on_event: Callable[[str, str, Any], Awaitable[None]] | None) -> dict:
    engine = WorkflowEngine(graph)
    return await engine.execute(on_event=on_event)


@router.post("/execute")
async def workflow_execute(request: Request):
    """REST 兜底：同步执行整张图，返回每个节点的输出。"""
    data = await request.json()
    try:
        graph = WorkflowGraph(**data)
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": f"工作流数据不合法: {exc}"})
    try:
        outputs = await _run_graph(graph, None)
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})
    return {"ok": True, "node_outputs": outputs, "final_output": outputs}


@router.websocket("/ws/execute")
async def workflow_execute_ws(websocket: WebSocket):
    """WebSocket 执行：实时推送每个节点的运行状态。"""
    token = websocket.query_params.get("token", "")
    if not auth.verify_token(token):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        raw = await websocket.receive_json()
        graph = WorkflowGraph(**raw)
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "message": f"工作流数据不合法: {exc}"})
        except Exception:
            pass
        await websocket.close(code=1003)
        return

    async def on_event(node_id: str, status: str, result: Any) -> None:
        await websocket.send_json(
            {"type": "node_status", "node_id": node_id, "status": status, "result": result}
        )

    try:
        outputs = await _run_graph(graph, on_event)
        await websocket.send_json({"type": "workflow_finished", "final_output": outputs})
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
