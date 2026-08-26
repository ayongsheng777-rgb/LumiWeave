"""Scene MCP 工具（scene.*）：场景引擎的列表/创建/加载/保存/动作执行/素材/版本（§41 / P1-02）。"""
from __future__ import annotations

from typing import Any

from app.mcp.registry import tool_registry
from app.scene import service
from app.scene.actions import execute_action


def register(server: Any) -> None:
    @server.tool(name="scene.list", description="列出全部场景实例。project_id 默认 default。")
    async def scene_list(project_id: str = "default") -> dict[str, Any]:
        return {"scenes": await service.list_scenes(project_id)}

    @server.tool(
        name="scene.create",
        description="创建场景实例。scene_type 支持 ecommerce-material / ecommerce-drama / film-analysis。",
    )
    async def scene_create(scene_type: str, name: str = "", project_id: str = "default") -> dict[str, Any]:
        sid = await service.create_scene(project_id, scene_type, name or scene_type, {})
        return {"scene": await service.get_scene(sid)}

    @server.tool(name="scene.load", description="加载场景（含对象与连线）。")
    async def scene_load(scene_id: str) -> dict[str, Any]:
        scene = await service.get_scene(scene_id)
        if not scene:
            return {"error": "场景不存在"}
        return {
            "scene": scene,
            "objects": await service.list_objects(scene_id),
            "edges": await service.list_edges(scene_id),
        }

    @server.tool(name="scene.save", description="保存场景名称/数据。")
    async def scene_save(scene_id: str, name: str = "", data: dict[str, Any] | None = None) -> dict[str, Any]:
        fields: dict[str, Any] = {}
        if name:
            fields["name"] = name
        if data is not None:
            fields["data"] = data
        return {"scene": await service.update_scene(scene_id, **fields)}

    @server.tool(
        name="scene.action.execute",
        description=("执行场景动作：analyze_product / generate_main_image / generate_detail_page / "
                     "analyze_video / analyze_shot / generate_story / generate_subtitle / compose_final 等。"),
    )
    async def scene_action_execute(scene_id: str, action: str,
                                   object_ids: list[str] | None = None,
                                   parameters: dict[str, Any] | None = None) -> dict[str, Any]:
        return await execute_action(scene_id, action, object_ids or [], parameters or {})

    @server.tool(name="scene.asset.list", description="列出场景素材库。type 可选 image/video/audio。")
    async def scene_asset_list(scene_id: str, asset_type: str = "") -> dict[str, Any]:
        return {"assets": await service.list_scene_assets(scene_id, asset_type)}

    @server.tool(name="scene.version.save", description="保存场景版本快照。")
    async def scene_version_save(scene_id: str, label: str = "") -> dict[str, Any]:
        vid = await service.create_version(scene_id, label)
        return {"version_id": vid, "versions": await service.list_versions(scene_id)}

    tool_registry.register("scene.list", "列出场景", "scene")
    tool_registry.register("scene.create", "创建场景", "scene")
    tool_registry.register("scene.load", "加载场景", "scene")
    tool_registry.register("scene.save", "保存场景", "scene")
    tool_registry.register("scene.action.execute", "执行场景动作", "scene")
    tool_registry.register("scene.asset.list", "列出场景素材", "scene")
    tool_registry.register("scene.version.save", "保存场景版本", "scene")
