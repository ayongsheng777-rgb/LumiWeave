"""MCP 连接测试：验证 MCP Server 创建 + 工具注册 + 权限模型。"""
from __future__ import annotations


def test_tool_registry():
    """工具注册表应包含五类工具。"""
    from app.mcp.registry import tool_registry

    tools = tool_registry.list()
    names = {t["name"] for t in tools}
    assert "canvas.list" in names
    assert "canvas.create" in names
    assert "workflow.execute" in names
    assert "asset.list" in names
    assert "provider.list" in names
    assert "project.status" in names
    assert len(tools) >= 20


def test_permission():
    """权限模型：read/write/execute 分类 + 校验。"""
    from app.mcp.auth.permission import has_permission, required_permission

    assert required_permission("canvas.list") == "read"
    assert required_permission("canvas.create") == "write"
    assert required_permission("workflow.execute") == "execute"
    assert has_permission(["read", "write", "execute"], "canvas.create") is True
    assert has_permission(["read"], "canvas.create") is False
    assert has_permission(["*"], "workflow.execute") is True


def test_mcp_server():
    """MCP Server 实例可创建。"""
    from app.mcp.server import server
    assert server.name == "lumiweave"
