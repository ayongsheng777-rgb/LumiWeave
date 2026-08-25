"""画布工作流路由：持久化（save/load）+ REST 兜底 + WebSocket 实时打点。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, WebSocket
from fastapi.responses import JSONResponse

from app import auth, task_service
from app.workflow import service as workflow_service
from app.workflow.engine import WorkflowEngine
from app.workflow.types import WorkflowGraph
from app.task_runner import run_workflow_as_task

router = APIRouter()


# ==================== 工作流持久化（规格书 §5.5/§23） ====================


@router.post("/save")
async def workflow_save(request: Request):
    """保存工作流 DAG，返回 workflow_id。新增/更新（带 workflow_id）二合一。"""
    data = await request.json()
    graph = data.get("graph")
    if not isinstance(graph, dict):
        return JSONResponse(status_code=400, content={"error": "graph 必须是对象"})
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return JSONResponse(status_code=400, content={"error": "graph 必须含 nodes/edges 数组"})
    wid = await workflow_service.save_workflow(
        project_id=str(data.get("project_id", "")),
        graph=graph,
        name=str(data.get("name", "")),
        workflow_id=str(data.get("workflow_id", "") or "") or None,
    )
    return {"workflow_id": wid}


@router.get("/list")
async def workflow_list(project_id: str = ""):
    workflows = await workflow_service.list_workflows(project_id)
    return {"workflows": workflows}


@router.get("/nodes")
async def workflow_nodes():
    """节点库（规格书 §8/§25）：前端 Node Library 消费，按分类渲染。"""
    from app.workflow.node_registry import list_nodes
    return {"nodes": list_nodes()}


@router.get("/load/{workflow_id}")
async def workflow_load(workflow_id: str):
    wf = await workflow_service.get_workflow(workflow_id)
    if not wf:
        return JSONResponse(status_code=404, content={"error": "工作流不存在"})
    return {"workflow_id": wf["id"], "project_id": wf.get("project_id", ""),
            "name": wf.get("name", ""), "graph": wf.get("graph")}


@router.delete("/delete/{workflow_id}")
async def workflow_delete(workflow_id: str):
    await workflow_service.delete_workflow(workflow_id)
    return {"ok": True}


@router.post("/execute")
async def workflow_execute(request: Request):
    """REST 兜底：绑定 TaskId 同步执行整张图，返回每个节点的输出 + 回写画布。"""
    data = await request.json()
    graph = {"nodes": data.get("nodes"), "edges": data.get("edges")}
    if not isinstance(graph["nodes"], list) or not isinstance(graph["edges"], list):
        return JSONResponse(status_code=400, content={"error": "工作流数据不合法"})
    try:
        WorkflowGraph(**graph)
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": f"工作流数据不合法: {exc}"})

    project_id = str(data.get("project_id", ""))
    workflow_id = str(data.get("workflow_id", ""))
    tid = await task_service.create_task(
        project_id=project_id, type="workflow", workflow_id=workflow_id,
    )
    result = await run_workflow_as_task(graph, task_id=tid, workflow_id=workflow_id,
                                        project_id=project_id)
    if not result.get("ok"):
        return JSONResponse(status_code=500, content={"task_id": tid, "error": result.get("error")})
    return {
        "ok": True, "task_id": tid,
        "node_outputs": result.get("outputs"),
        "node_results": result.get("node_results"),
        "final_output": result.get("final_output"),
        "created_objects": result.get("created_objects"),
    }


@router.websocket("/ws/execute")
async def workflow_execute_ws(websocket: WebSocket):
    """WebSocket 执行：绑定 TaskId，实时推送每个节点的运行状态（规格书 §28）。"""
    token = websocket.query_params.get("token", "")
    if not auth.verify_token(token):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        raw = await websocket.receive_json()
        graph = {"nodes": raw.get("nodes"), "edges": raw.get("edges")}
        WorkflowGraph(**graph)
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "message": f"工作流数据不合法: {exc}"})
        except Exception:
            pass
        await websocket.close(code=1003)
        return

    project_id = str(raw.get("project_id", ""))
    workflow_id = str(raw.get("workflow_id", ""))
    tid = await task_service.create_task(
        project_id=project_id, type="workflow", workflow_id=workflow_id,
    )

    async def on_event(node_id: str, status: str, result: Any) -> None:
        await websocket.send_json({
            "type": "node_status", "task_id": tid,
            "node_id": node_id, "status": status, "result": result,
        })

    result = await run_workflow_as_task(graph, task_id=tid, workflow_id=workflow_id,
                                        project_id=project_id, on_event=on_event)
    try:
        if not result.get("ok"):
            err = result.get("error") or {}
            await websocket.send_json({
                "type": "error", "task_id": tid,
                "code": err.get("code", "WORKFLOW_ERROR"),
                "message": err.get("message", "执行失败"),
            })
        else:
            await websocket.send_json({
                "type": "workflow_finished", "task_id": tid,
                "final_output": result.get("final_output"),
                "created_objects": result.get("created_objects"),
            })
    except Exception:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
