"""LumiWeave MCP Server 实例 + 工具注册（stdio + streamable-http 双模式）。

- stdio 模式：`python -m app.mcp`（命令行，Codex/Claude Code 直接连，本地信任无 token）
- HTTP 模式：`python -m app.mcp --http --port 8901`（独立进程，带 Bearer token 认证）
"""
from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from app.mcp.tools import (
    register_asset_tools,
    register_canvas_tools,
    register_film_tools,
    register_project_tools,
    register_provider_tools,
    register_workflow_tools,
)

server = MCPServer(
    name="lumiweave",
    version="2.1.0",
    instructions=(
        "LumiWeave MCP Server —— AI 影视创作操作系统。"
        "对外部编程智能体（Codex / Claude Code / WorkBuddy / Cursor 等）暴露："
        "画布（canvas.*）、工作流（workflow.*）、素材（asset.*）、"
        "接口（provider.*）、项目（project.*）、影视创作（film.*）六类工具。"
    ),
)

# 注册全部工具
register_canvas_tools(server)
register_workflow_tools(server)
register_asset_tools(server)
register_provider_tools(server)
register_project_tools(server)
register_film_tools(server)


def http_app():
    """带 Bearer token 认证的 streamable-http ASGI app（供独立 HTTP 进程使用）。

    每个请求校验 `Authorization: Bearer lw-mcp-xxx`（查 mcp_clients 表），
    无效或缺失返回 401。stdio 模式走本地信任，不经此层。

    MCP HTTP streamable 协议要求客户端 Accept: application/json, text/event-stream。
    WorkBuddy MCP 发 Accept: application/json，不支持 SSE → server 强制返回 JSON 响应。
    通过 patch streamable_http_app 的响应逻辑，让它忽略 Accept 检查始终返回 JSON。
    """
    from starlette.responses import JSONResponse

    base = server.streamable_http_app(
        streamable_http_path="/mcp",
        json_response=True,  # 支持 Accept: application/json（非强制 SSE）
        stateless_http=True,  # 无状态，无需 session cookie，适合 HTTP API 客户端
    )

    async def wrapped(scope, receive, send):
        if scope["type"] == "http":
            headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
            auth = headers.get("authorization", "")
            token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
            if not token:
                resp = JSONResponse({"error": "缺少 MCP token", "code": "AUTH_REQUIRED"}, status_code=401)
                await resp(scope, receive, send)
                return
            from app.mcp.auth.token import verify_client_token
            client = await verify_client_token(token)
            if not client:
                resp = JSONResponse({"error": "MCP token 无效", "code": "AUTH_REQUIRED"}, status_code=401)
                await resp(scope, receive, send)
                return

        await base(scope, receive, send)

    return wrapped

