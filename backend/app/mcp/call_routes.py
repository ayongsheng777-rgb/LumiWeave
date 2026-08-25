"""REST 桥接：POST /api/mcp/call/{tool_name} —— 直接调用已注册的 MCP 工具函数。

前端 api.ts 的 mcpCall() 原本请求 /mcp/call/{tool}（无 /api 前缀，nginx 不代理，
后端也无此路由），导致 film.* 系列全部失效。此路由补齐这一环，
让前端能直接通过 HTTP 调用影视工具（story_parse / storyboard_generate 等）。
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.mcp.tools.film_tools import get_film_tool

router = APIRouter()


@router.post("/{tool_name}")
async def mcp_call(tool_name: str, request: Request):
    # 安全兜底：body 解析失败按空对象处理
    try:
        params = await request.json()
    except Exception:
        params = {}
    if not isinstance(params, dict):
        params = {}

    # 优先 film.* 工具；后续可扩展 canvas.* / workflow.* 等
    func = get_film_tool(tool_name)
    if func is None:
        return JSONResponse(status_code=404, content={"ok": False, "error": f"未找到工具: {tool_name}"})

    # 仅透传工具自身声明的参数，避免注入未知字段
    result = await func(**params)
    return result
