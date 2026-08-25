"""Provider 服务层（MCP 改造：backend/services）。

Provider 不再被内部 Agent 调用，改由外部 AI 通过 MCP 调用。
封装 Provider 列表 / 健康检测 / 路由，供 MCP 工具（provider.*）与 /api/v2 复用。
"""
from __future__ import annotations

from typing import Any

from app.providers import service as _providers


class ProviderService:
    async def list(self) -> list[dict[str, Any]]:
        """Provider 列表（provider.list）。"""
        return await _providers.list_providers()

    async def health(self, pid: str) -> dict[str, Any]:
        """Provider 健康检测（provider.health）：真实连通性 + 延迟。"""
        return await _providers.test_provider(pid)

    async def route(
        self,
        task_type: str,
        quality: float = 1.0,
        speed: float = 1.0,
        cost: float = 1.0,
        limit: int = 3,
    ) -> list[dict[str, Any]]:
        """按质量/速度/成本评分路由 Provider 链（provider.route）。"""
        return await _providers.route(
            task_type, quality=quality, speed=speed, cost=cost, limit=limit,
        )

    async def best(self, task_type: str, **kw: Any) -> dict[str, Any] | None:
        return await _providers.best_provider(task_type, **kw)


provider_service = ProviderService()
