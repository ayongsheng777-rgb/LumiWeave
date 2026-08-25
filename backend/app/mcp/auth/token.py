"""MCP 客户端 token 生成与验证（对应 mcp_clients 表）。

外部编程智能体（Codex/Claude Code/WorkBuddy 等）注册后获得 token，
HTTP 模式通过 Authorization 头携带，服务端查表校验。
"""
from __future__ import annotations

import secrets
from typing import Any

from app import db


def create_client_token() -> str:
    """生成 MCP 客户端 token（前缀 lw-mcp-）。"""
    return "lw-mcp-" + secrets.token_hex(24)


async def verify_client_token(token: str) -> dict[str, Any] | None:
    """校验 token，返回 mcp_clients 记录（含 permissions），无效返回 None。"""
    if not token or not token.startswith("lw-mcp-"):
        return None
    row = await db.fetchrow("SELECT * FROM mcp_clients WHERE token=$1", token)
    return dict(row) if row else None
