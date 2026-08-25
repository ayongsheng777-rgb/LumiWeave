"""Canvas MCP 工具测试：画布对象的创建 / 列表 / 更新 / 移动 / 删除。"""
from __future__ import annotations

import pytest

from app.services.canvas_service import canvas_service


@pytest.mark.asyncio
async def test_canvas_crud():
    pid = "test-mcp-canvas"
    # 创建
    oid = await canvas_service.create_object(
        pid, "text", {"text": "你好"}, {"x": 10, "y": 20},
    )
    assert oid.startswith("obj_")
    # 列表
    objects = await canvas_service.list_objects(pid)
    assert any(o["id"] == oid for o in objects)
    # 更新
    updated = await canvas_service.update_object(oid, content={"text": "改后"})
    assert updated is not None
    # 移动
    moved = await canvas_service.move_object(oid, 100, 200)
    assert moved["position"]["x"] == 100
    # 删除
    await canvas_service.delete_object(oid)
    objects = await canvas_service.list_objects(pid)
    assert all(o["id"] != oid for o in objects)
