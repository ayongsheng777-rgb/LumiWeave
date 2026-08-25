"""Task API（规格书 §12）。

统一任务生命周期入口：创建（+执行）/ 查询 / 取消 / 重试 / 事件。
在现有 task_service（tasks/task_events/task_results 三表）上扩展，
不新建独立任务系统。
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app import task_service
from app.workflow import service as workflow_service
from app.task_runner import run_workflow_as_task

router = APIRouter()


@router.post("")
async def create_and_run(request: Request):
    """创建任务并同步执行一个工作流（绑定 TaskId）。"""
    data = await request.json()
    graph = data.get("graph")
    if not isinstance(graph, dict):
        return JSONResponse(status_code=400, content={"error": "graph 必须是对象"})
    if not isinstance(graph.get("nodes"), list) or not isinstance(graph.get("edges"), list):
        return JSONResponse(status_code=400, content={"error": "graph 必须含 nodes/edges 数组"})

    project_id = str(data.get("project_id", ""))
    workflow_id = str(data.get("workflow_id", "") or "")
    if workflow_id:
        # 以工作流库里的图为准，若请求也带了 graph 则优先用请求里的
        if graph.get("nodes") or graph.get("edges"):
            pass
        else:
            wf = await workflow_service.get_workflow(workflow_id)
            if not wf:
                return JSONResponse(status_code=404, content={"error": "工作流不存在"})
            graph = wf.get("graph") or {"nodes": [], "edges": []}
            project_id = wf.get("project_id", project_id)

    tid = await task_service.create_task(
        user_id=str(data.get("user_id", "")),
        canvas_id=str(data.get("canvas_id", "")),
        project_id=project_id,
        type=str(data.get("type", "workflow")),
        workflow_id=workflow_id,
    )
    await task_service.add_event(tid, "task_created", {"workflow_id": workflow_id})

    result = await run_workflow_as_task(graph, task_id=tid, workflow_id=workflow_id,
                                        project_id=project_id)
    return {"task_id": tid, **result}


@router.get("")
async def list_tasks(project_id: str = "", limit: int = 50):
    tasks = await task_service.list_tasks(project_id, min(max(limit, 1), 200))
    return {"tasks": tasks}


@router.get("/{task_id}")
async def get_task(task_id: str):
    detail = await task_service.get_task_detail(task_id)
    if not detail:
        return JSONResponse(status_code=404, content={"error": "任务不存在"})
    return detail


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str):
    task = await task_service.get_task(task_id)
    if not task:
        return JSONResponse(status_code=404, content={"error": "任务不存在"})
    if task.get("status") not in (task_service.TASK_QUEUED, task_service.TASK_RUNNING):
        return JSONResponse(status_code=400, content={"error": f"任务状态 {task.get('status')} 不可取消"})
    task_service.request_cancel(task_id)
    await task_service.set_status(task_id, task_service.TASK_CANCELLED)
    await task_service.add_event(task_id, "task_cancelled", {})
    return {"ok": True, "task_id": task_id, "status": task_service.TASK_CANCELLED}


@router.post("/{task_id}/retry")
async def retry_task(task_id: str, request: Request):
    """重试任务：从工作流库重新取图执行（若请求带 graph 则优先用请求里的）。"""
    task = await task_service.get_task(task_id)
    if not task:
        return JSONResponse(status_code=404, content={"error": "任务不存在"})
    data = await request.json() or {}
    workflow_id = task.get("workflow_id") or str(data.get("workflow_id", ""))
    graph = data.get("graph")
    if not isinstance(graph, dict):
        if not workflow_id:
            return JSONResponse(status_code=400, content={"error": "缺少 workflow_id 或 graph，无法重试"})
        wf = await workflow_service.get_workflow(workflow_id)
        if not wf:
            return JSONResponse(status_code=404, content={"error": "工作流不存在，无法重试"})
        graph = wf.get("graph") or {"nodes": [], "edges": []}

    new_tid = await task_service.create_task(
        user_id=task.get("user_id", ""),
        canvas_id=task.get("canvas_id", ""),
        project_id=task.get("project_id", ""),
        type=task.get("type", "workflow"),
        workflow_id=workflow_id,
    )
    await task_service.add_event(new_tid, "task_retried", {"origin_task_id": task_id})
    result = await run_workflow_as_task(graph, task_id=new_tid, workflow_id=workflow_id,
                                        project_id=task.get("project_id", ""))
    return {"task_id": new_tid, "origin_task_id": task_id, **result}


@router.get("/{task_id}/events")
async def task_events(task_id: str):
    task = await task_service.get_task(task_id)
    if not task:
        return JSONResponse(status_code=404, content={"error": "任务不存在"})
    return {"task_id": task_id, "events": await task_service.get_events(task_id)}
