"""Workflow MCP 工具（workflow.*）：工作流的创建 / 查询 / 执行 / 状态。"""
from __future__ import annotations

from typing import Any

from app.mcp.registry import tool_registry
from app.services.workflow_service import workflow_service


def register(server: Any) -> None:
    @server.tool(
        name="workflow.create",
        description="创建/更新一个工作流。nodes 是节点列表（含 id/type/data），"
                    "edges 是连线列表（含 source/target），返回 workflow_id。",
    )
    async def workflow_create(
        name: str,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
        project_id: str = "",
    ) -> dict[str, Any]:
        wid = await workflow_service.create(name, nodes, edges, project_id)
        return {"workflow_id": wid, "status": "created"}

    @server.tool(
        name="workflow.execute",
        description="执行已保存的工作流，返回 task_id 和最终输出。",
    )
    async def workflow_execute(workflow_id: str, project_id: str = "") -> dict[str, Any]:
        result = await workflow_service.execute(workflow_id, project_id)
        return {
            "task_id": result.get("task_id"),
            "ok": result.get("ok"),
            "final_output": result.get("final_output"),
            "error": result.get("error"),
        }

    @server.tool(
        name="workflow.inspect",
        description="查询任务执行状态（status / 进度 / 结果）。",
    )
    async def workflow_inspect(task_id: str) -> dict[str, Any]:
        detail = await workflow_service.inspect(task_id)
        if not detail:
            return {"task_id": task_id, "status": "not_found"}
        return detail

    @server.tool(
        name="workflow.list",
        description="列出项目下的所有工作流。",
    )
    async def workflow_list(project_id: str = "") -> dict[str, Any]:
        workflows = await workflow_service.list(project_id)
        return {"workflows": workflows}

    @server.tool(
        name="workflow.get",
        description="获取单个工作流的完整定义（含 nodes/edges）。",
    )
    async def workflow_get(workflow_id: str) -> dict[str, Any]:
        wf = await workflow_service.get(workflow_id)
        if not wf:
            return {"workflow_id": workflow_id, "status": "not_found"}
        return wf

    @server.tool(
        name="workflow.delete",
        description="删除一个工作流。",
    )
    async def workflow_delete(workflow_id: str) -> dict[str, Any]:
        await workflow_service.delete(workflow_id)
        return {"workflow_id": workflow_id, "status": "deleted"}

    tool_registry.register("workflow.create", "创建工作流", "workflow")
    tool_registry.register("workflow.execute", "执行工作流", "workflow")
    tool_registry.register("workflow.inspect", "查询任务状态", "workflow")
    tool_registry.register("workflow.list", "列出工作流", "workflow")
    tool_registry.register("workflow.get", "获取工作流定义", "workflow")
    tool_registry.register("workflow.delete", "删除工作流", "workflow")
