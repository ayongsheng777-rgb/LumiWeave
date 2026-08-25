"""Asset MCP 工具测试：素材的列表 / 新增 / 改名 / 删除。"""
from __future__ import annotations

import pytest

from app.assets import service as _assets
from app.services.asset_service import asset_service


@pytest.mark.asyncio
async def test_asset_lifecycle():
    aid = await _assets.add_asset("", "image", "https://example.com/x.png", name="测试图")
    assert aid.startswith("asset_")
    assets = await asset_service.list("image")
    assert any(a["id"] == aid for a in assets)
    renamed = await asset_service.rename(aid, "改名后")
    assert renamed is not None
    assert await asset_service.delete(aid) is True
