"""MCP 工具集：canvas / workflow / asset / provider / project。"""
from app.mcp.tools.asset_tools import register as register_asset_tools
from app.mcp.tools.canvas_tools import register as register_canvas_tools
from app.mcp.tools.project_tools import register as register_project_tools
from app.mcp.tools.provider_tools import register as register_provider_tools
from app.mcp.tools.workflow_tools import register as register_workflow_tools

__all__ = [
    "register_canvas_tools",
    "register_workflow_tools",
    "register_asset_tools",
    "register_provider_tools",
    "register_project_tools",
]
