"""统一工作流执行器（规格书 §11：所有操作绑定 TaskId）。

把「创建任务 → 引擎执行 → 记录事件 → 写结果 → 更新状态」串成一条
标准链路，供 /api/tasks 创建、retry、以及 /workflow/execute 统一复用。

执行过程中每个节点状态都落 task_events，WebSocket 断开不判失败，
任务状态与结果持久化到 tasks / task_results，重启可追溯。
"""
from __future__ import annotations

import json
from typing import Any, Awaitable, Callable, Optional

from app import task_service
from app.workflow.engine import WorkflowEngine, WorkflowExecutionError
from app.workflow.types import WorkflowGraph

EventCallback = Callable[[str, str, Any], Awaitable[None]]


async def run_workflow_as_task(
    graph: dict[str, Any],
    *,
    task_id: str,
    workflow_id: str = "",
    project_id: str = "",
    on_event: Optional[EventCallback] = None,
) -> dict[str, Any]:
    """执行一个工作流并全程绑定 task_id。

    返回结构化结果（成功含 node_results/outputs/final_output；失败含 error）。
    本函数不抛异常，失败以 {ok:False, error:{code,message}} 返回。
    成功后自动把生成结果回写画布（规格书 §21），created_objects 返回对象 id。
    """
    task_service.clear_cancel(task_id)
    await task_service.set_status(task_id, task_service.TASK_RUNNING)

    try:
        engine = WorkflowEngine(WorkflowGraph(**graph))
    except Exception as exc:
        await task_service.set_status(task_id, task_service.TASK_FAILED)
        await task_service.add_event(task_id, "workflow_failed",
                                     {"code": "INVALID_WORKFLOW", "message": str(exc)})
        return {"ok": False, "error": {"code": "INVALID_WORKFLOW", "message": str(exc)}}

    async def record_event(node_id: str, status: str, result: Any) -> None:
        await task_service.add_event(task_id, f"node_{status}",
                                     {"node_id": node_id, "status": status, "result": result})
        if on_event:
            await on_event(node_id, status, result)

    try:
        result = await engine.execute(
            on_event=record_event,
            task_id=task_id,
            workflow_id=workflow_id,
            cancel_checker=lambda: task_service.is_cancelled(task_id),
        )
    except WorkflowExecutionError as exc:
        await task_service.set_status(task_id, task_service.TASK_FAILED)
        await task_service.add_event(task_id, "workflow_failed",
                                     {"node_id": exc.node_id, "code": exc.code, "message": exc.message})
        return {"ok": False, "error": {"code": exc.code, "message": exc.message, "node_id": exc.node_id}}
    except Exception as exc:  # noqa: BLE001
        await task_service.set_status(task_id, task_service.TASK_FAILED)
        await task_service.add_event(task_id, "workflow_failed",
                                     {"code": "WORKFLOW_ERROR", "message": str(exc)})
        return {"ok": False, "error": {"code": "WORKFLOW_ERROR", "message": str(exc)}}

    await task_service.set_status(task_id, task_service.TASK_COMPLETED)
    final = result.get("final_output")
    await task_service.set_result(
        task_id,
        json.dumps(final, ensure_ascii=False) if final is not None else "",
        {"final_output": final, "node_results": result.get("node_results", {}),
         "workflow_id": workflow_id},
    )
    await task_service.add_event(task_id, "workflow_finished",
                                 {"final_output": final, "workflow_id": workflow_id})

    # 结果回写画布（规格书 §21）
    created_objects: list[str] = []
    if project_id:
        try:
            from app.canvas.result_writer import write_results_to_canvas
            created_objects = await write_results_to_canvas(
                project_id, graph, result.get("node_results", {}),
                task_id=task_id, workflow_id=workflow_id,
            )
        except Exception:  # noqa: BLE001 - 回写失败不阻断主结果返回
            await task_service.add_event(task_id, "canvas_write_failed", {"project_id": project_id})

    result["ok"] = True
    result["task_id"] = task_id
    result["created_objects"] = created_objects
    return result
