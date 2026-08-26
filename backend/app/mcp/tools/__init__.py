"""MCP 工具集：canvas / workflow / asset / provider / project / film / render_kernel / scene。"""
from app.mcp.tools.asset_tools import register as register_asset_tools
from app.mcp.tools.canvas_tools import register as register_canvas_tools
from app.mcp.tools.film_tools import register as register_film_tools
from app.mcp.tools.project_tools import register as register_project_tools
from app.mcp.tools.provider_tools import register as register_provider_tools
from app.mcp.tools.scene_tools import register as register_scene_tools
from app.mcp.tools.workflow_tools import register as register_workflow_tools
from app.mcp.tools.render_kernel_tools import router as render_kernel_router
from app.mcp.tools.render_kernel_tools import websocket_router as render_kernel_ws_router

__all__ = [
    "register_canvas_tools",
    "register_workflow_tools",
    "register_asset_tools",
    "register_provider_tools",
    "register_project_tools",
    "register_film_tools",
    "register_scene_tools",
    "render_kernel_router",
    "render_kernel_ws_router",
]
