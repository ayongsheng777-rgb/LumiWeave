"""Provider MCP 工具测试：接口的列表 / 路由。"""
from __future__ import annotations

import pytest

from app.services.provider_service import provider_service


@pytest.mark.asyncio
async def test_provider_list():
    providers = await provider_service.list()
    assert isinstance(providers, list)


@pytest.mark.asyncio
async def test_provider_route():
    chain = await provider_service.route("llm", limit=5)
    assert isinstance(chain, list)
