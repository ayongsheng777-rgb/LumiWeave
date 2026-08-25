"""画布服务层（MCP 改造：backend/services）。

把画布对象的 CRUD / 连线 / 导出能力，封装成语义化方法，
供 MCP 工具（canvas.*）与 /api/v2 复用，MCP 不直接操作数据库。
"""
from __future__ import annotations

from typing import Any

from app.canvas import service as _canvas


class CanvasService:
    async def list_objects(self, project_id: str) -> list[dict[str, Any]]:
        """画布对象列表（canvas.list）。"""
        return await _canvas.list_objects(project_id)

    async def get_object(self, oid: str) -> dict[str, Any] | None:
        return await _canvas.get_object(oid)

    async def create_object(
        self,
        project_id: str,
        obj_type: str,
        content: dict[str, Any] | None = None,
        position: dict[str, Any] | None = None,
        size: dict[str, Any] | None = None,
        layer: int = 0,
        metadata: dict[str, Any] | None = None,
        oid: str | None = None,
    ) -> str:
        """创建画布对象，返回 id（canvas.create）。"""
        return await _canvas.create_object(
            project_id, obj_type, content, position, size, layer, metadata, oid,
        )

    async def update_object(self, oid: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        """修改画布对象（canvas.update）。changes 可含 content/position/size/type 等。"""
        return await _canvas.update_object(oid, **changes)

    async def delete_object(self, oid: str) -> None:
        """删除画布对象（canvas.delete）。"""
        await _canvas.delete_object(oid)

    async def move_object(self, oid: str, x: float, y: float) -> dict[str, Any] | None:
        """移动对象到指定坐标（canvas.move）。"""
        obj = await _canvas.get_object(oid)
        if not obj:
            return None
        pos = dict(obj.get("position") or {})
        pos.update({"x": x, "y": y})
        return await _canvas.update_object(oid, position=pos)

    async def graph(self, project_id: str) -> dict[str, Any]:
        """整张画布（节点 + 连线），供 MCP canvas.list 与导出使用。"""
        return {
            "nodes": await _canvas.list_objects(project_id),
            "edges": await _canvas.list_edges(project_id),
        }

    async def export_canvas(self, project_id: str, fmt: str = "json") -> dict[str, Any]:
        """导出画布（canvas.export）。json 返回完整结构；其它格式预留。"""
        data = await self.graph(project_id)
        fmt = (fmt or "json").lower()
        if fmt == "json":
            return {"format": "json", "project_id": project_id, "canvas": data}
        # PNG/JPG/PDF/SVG/PPTX 需要渲染引擎，此处标记为未实现（MCP 返回明确状态）
        return {
            "format": fmt,
            "project_id": project_id,
            "ok": False,
            "error": f"导出格式 {fmt} 暂未实现（当前支持 json）",
            "node_count": len(data["nodes"]),
            "edge_count": len(data["edges"]),
        }


canvas_service = CanvasService()
