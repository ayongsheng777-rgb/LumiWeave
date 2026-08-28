"""营销 MCP 工具（marketing.*）：电商商品营销物料工作流的专用工具（V2.8）。
覆盖：创建营销项目 / 生成营销策略 / 生成故事板与视觉规划板 / 渲染主图海报 / 导出素材。
底层复用场景引擎（scene service + execute_action），便于 Codex / Claude / WorkBuddy 自动操作。"""
from __future__ import annotations

from typing import Any

from app.mcp.registry import tool_registry
from app.scene import service
from app.scene.actions import execute_action

MATERIAL_TYPE = "ecommerce-material"


async def _first_object(scene_id: str, object_type: str) -> dict[str, Any] | None:
    for o in await service.list_objects(scene_id):
        if o["object_type"] == object_type:
            return o
    return None


def register(server: Any) -> None:
    @server.tool(
        name="marketing.create_project",
        description="创建电商商品营销物料项目（场景）。返回 scene_id，后续工具均用它操作。",
    )
    async def marketing_create_project(name: str = "电商营销项目", project_id: str = "default") -> dict[str, Any]:
        sid = await service.create_scene(project_id, MATERIAL_TYPE, name, {})
        scene = await service.get_scene(sid)
        return {"scene_id": sid, "scene": scene, "hint": "用 scene.add 或模板铺入商品节点"}

    @server.tool(
        name="marketing.generate_strategy",
        description="对场景内商品节点生成营销策略（核心/辅助卖点、目标人群、投放渠道、内容策略、文案基调）。",
    )
    async def marketing_generate_strategy(scene_id: str) -> dict[str, Any]:
        prod = await _first_object(scene_id, "product")
        if not prod:
            return {"error": "场景内没有商品(product)节点，请先创建并填写商品信息"}
        return await execute_action(scene_id, "generate_strategy", [prod["id"]], {})

    @server.tool(
        name="marketing.generate_storyboard",
        description="对场景内剧情节点生成分镜剧本（markdown 剧本，含分镜/镜头/对白/BGM/时长）。",
    )
    async def marketing_generate_storyboard(scene_id: str, prompt: str = "") -> dict[str, Any]:
        story = await _first_object(scene_id, "story")
        if not story:
            return {"error": "场景内没有剧情(story)节点"}
        return await execute_action(scene_id, "generate_story", [story["id"]], {"prompt": prompt})

    @server.tool(
        name="marketing.generate_visual_board",
        description=("生成结构化商品广告片制作板（Visual Production Board）：角色/场景/镜头/道具/灯光/情绪/音效"
                     "均为独立结构化实体（带 ID 与 keywords），写回剧情节点，可被其它节点按字段 ID/关键词引用。"),
    )
    async def marketing_generate_visual_board(scene_id: str) -> dict[str, Any]:
        story = await _first_object(scene_id, "story")
        if not story:
            return {"error": "场景内没有剧情(story)节点"}
        return await execute_action(scene_id, "generate_visual_board", [story["id"]], {})

    @server.tool(
        name="marketing.render_campaign",
        description=("渲染营销物料：kind 支持 main_image（主图）/ scene_image（场景图）/ poster（海报）/ detail_page（详情页）。"
                     "使用场景内商品节点的商品信息与卖点。"),
    )
    async def marketing_render_campaign(scene_id: str, kind: str = "main_image") -> dict[str, Any]:
        action = {
            "main_image": "generate_main_image",
            "scene_image": "generate_scene_image",
            "poster": "generate_poster",
            "detail_page": "generate_detail_page",
        }.get(kind)
        if not action:
            return {"error": f"kind 仅支持 {list({'main_image', 'scene_image', 'poster', 'detail_page'})}"}
        prod = await _first_object(scene_id, "product")
        if not prod:
            return {"error": "场景内没有商品(product)节点"}
        return await execute_action(scene_id, action, [prod["id"]], {})

    @server.tool(name="marketing.export_assets", description="导出场景素材库清单（已生成的图片/视频/音频资源）。")
    async def marketing_export_assets(scene_id: str, asset_type: str = "") -> dict[str, Any]:
        return {"assets": await service.list_scene_assets(scene_id, asset_type)}

    tool_registry.register("marketing.create_project", "创建电商营销项目", "marketing")
    tool_registry.register("marketing.generate_strategy", "生成营销策略", "marketing")
    tool_registry.register("marketing.generate_storyboard", "生成分镜剧本", "marketing")
    tool_registry.register("marketing.generate_visual_board", "生成结构化制作板", "marketing")
    tool_registry.register("marketing.render_campaign", "渲染营销物料", "marketing")
    tool_registry.register("marketing.export_assets", "导出营销素材", "marketing")
