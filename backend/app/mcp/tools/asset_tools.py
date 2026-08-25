"""Asset MCP 工具（asset.*）：素材库的列表 / 绑定画布 / 删除 / 改名。"""
from __future__ import annotations

from typing import Any

from app.mcp.registry import tool_registry
from app.services.asset_service import asset_service


def register(server: Any) -> None:
    @server.tool(
        name="asset.list",
        description="列出素材库中的资源。type 可选（image/video/audio/file 等）。",
    )
    async def asset_list(type: str = "") -> dict[str, Any]:
        assets = await asset_service.list(type)
        return {"assets": assets}

    @server.tool(
        name="asset.attach",
        description="把素材绑定到画布，生成一个 image 画布对象。",
    )
    async def asset_attach(asset_id: str, project_id: str) -> dict[str, Any]:
        return await asset_service.attach(asset_id, project_id)

    @server.tool(
        name="asset.rename",
        description="给素材改名。",
    )
    async def asset_rename(asset_id: str, name: str) -> dict[str, Any]:
        result = await asset_service.rename(asset_id, name)
        return {"id": asset_id, "status": "renamed", "asset": result}

    @server.tool(
        name="asset.delete",
        description="删除素材。",
    )
    async def asset_delete(asset_id: str) -> dict[str, Any]:
        ok = await asset_service.delete(asset_id)
        return {"id": asset_id, "status": "deleted" if ok else "not_found"}

    tool_registry.register("asset.list", "列出素材", "asset")
    tool_registry.register("asset.attach", "素材绑定画布", "asset")
    tool_registry.register("asset.rename", "素材改名", "asset")
    tool_registry.register("asset.delete", "删除素材", "asset")
