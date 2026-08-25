"""LumiWeave MCP Server 实例 + 工具注册（stdio + streamable-http 双模式）。

- stdio 模式：`python -m app.mcp`（命令行，Codex/Claude Code 直接连）
- HTTP 模式：main.py 挂载 `server.streamable_http_app()`（浏览器/远程可连）
"""
from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from app.mcp.tools import (
    register_asset_tools,
    register_canvas_tools,
    register_project_tools,
    register_provider_tools,
    register_workflow_tools,
)

server = MCPServer(
    name="lumiweave",
    version="2.1.0",
    instructions=(
        "LumiWeave MCP Server —— AI 可编程创作基础设施。"
        "对外部编程智能体（Codex / Claude Code / WorkBuddy / Cursor 等）暴露"
        "画布（canvas.*）、工作流（workflow.*）、素材（asset.*）、"
        "接口（provider.*）、项目（project.*）五类工具。"
    ),
)

# 注册全部工具
register_canvas_tools(server)
register_workflow_tools(server)
register_asset_tools(server)
register_provider_tools(server)
register_project_tools(server)
