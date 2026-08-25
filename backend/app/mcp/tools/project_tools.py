"""Project MCP 工具（project.*）：项目状态查询。"""
from __future__ import annotations

from typing import Any

from app import db
from app.mcp.registry import tool_registry


def register(server: Any) -> None:
    @server.tool(
        name="project.status",
        description="查询项目状态：画布对象数、连线数、工作流数、素材数。",
    )
    async def project_status(project_id: str = "") -> dict[str, Any]:
        async def _count(sql: str, *args: Any) -> int:
            row = await db.fetchrow(sql, *args)
            return int(row["c"]) if row else 0

        if project_id:
            objects = await _count("SELECT COUNT(*) AS c FROM canvas_objects WHERE project_id=$1", project_id)
            edges = await _count("SELECT COUNT(*) AS c FROM canvas_edges WHERE project_id=$1", project_id)
            workflows = await _count("SELECT COUNT(*) AS c FROM workflows WHERE project_id=$1", project_id)
        else:
            objects = await _count("SELECT COUNT(*) AS c FROM canvas_objects")
            edges = await _count("SELECT COUNT(*) AS c FROM canvas_edges")
            workflows = await _count("SELECT COUNT(*) AS c FROM workflows")
        assets = await _count("SELECT COUNT(*) AS c FROM assets")
        return {
            "project_id": project_id,
            "objects": objects,
            "edges": edges,
            "workflows": workflows,
            "assets": assets,
        }

    tool_registry.register("project.status", "查询项目状态", "project")
