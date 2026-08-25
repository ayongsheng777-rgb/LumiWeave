"""工作流服务层（MCP 改造：backend/services）。

封装工作流的创建 / 执行 / 状态查询，供 MCP 工具（workflow.*）
与 /api/v2 复用。执行走统一 task 体系（绑定 TaskId，结果回写画布）。
"""
from __future__ import annotations

from typing import Any

from app import task_service
from app.task_runner import run_workflow_as_task
from app.workflow import service as _workflow


class WorkflowService:
    async def create(
        self,
        name: str,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
        project_id: str = "",
        workflow_id: str | None = None,
    ) -> str:
        """创建/更新工作流，返回 workflow_id（workflow.create）。"""
        return await _workflow.save_workflow(
            project_id, {"nodes": nodes, "edges": edges},
            name=name, workflow_id=workflow_id,
        )

    async def get(self, workflow_id: str) -> dict[str, Any] | None:
        return await _workflow.get_workflow(workflow_id)

    async def list(self, project_id: str = "") -> list[dict[str, Any]]:
        return await _workflow.list_workflows(project_id)

    async def delete(self, workflow_id: str) -> None:
        await _workflow.delete_workflow(workflow_id)

    async def execute(self, workflow_id: str, project_id: str = "") -> dict[str, Any]:
        """执行已保存的工作流（workflow.execute），返回 task_id + 执行结果。"""
        wf = await _workflow.get_workflow(workflow_id)
        if not wf:
            return {"ok": False, "error": {"code": "WORKFLOW_NOT_FOUND", "message": "工作流不存在"}}
        graph = wf.get("graph") or {"nodes": [], "edges": []}
        pid = project_id or wf.get("project_id", "") or ""
        tid = await task_service.create_task(
            project_id=pid, type="workflow", workflow_id=workflow_id,
        )
        result = await run_workflow_as_task(graph, task_id=tid, workflow_id=workflow_id, project_id=pid)
        return {
            "task_id": tid,
            "ok": bool(result.get("ok")),
            "final_output": result.get("final_output"),
            "node_results": result.get("node_results"),
            "created_objects": result.get("created_objects"),
            "error": result.get("error"),
        }

    async def inspect(self, task_id: str) -> dict[str, Any] | None:
        """查询任务状态（task.status）：status/progress/结果。"""
        detail = await task_service.get_task_detail(task_id)
        if detail:
            return detail
        return await task_service.get_task(task_id)


workflow_service = WorkflowService()
