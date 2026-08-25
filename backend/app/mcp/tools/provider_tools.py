"""Provider MCP 工具（provider.*）：接口的列表 / 健康检测 / 路由。"""
from __future__ import annotations

from typing import Any

from app.mcp.registry import tool_registry
from app.services.provider_service import provider_service


def register(server: Any) -> None:
    @server.tool(
        name="provider.list",
        description="列出已配置的商业接口 Provider（OpenAI/Claude/Gemini/ComfyUI/Kling 等）。",
    )
    async def provider_list() -> dict[str, Any]:
        providers = await provider_service.list()
        return {"providers": providers}

    @server.tool(
        name="provider.health",
        description="检测 Provider 连通性与延迟（真实调用）。",
    )
    async def provider_health(provider_id: str) -> dict[str, Any]:
        return await provider_service.health(provider_id)

    @server.tool(
        name="provider.route",
        description="按任务类型路由出最优 Provider（按质量/速度/成本评分）。"
                    "task_type 如 image_generation / video_generation / llm。",
    )
    async def provider_route(
        task_type: str,
        quality: float = 1.0,
        speed: float = 1.0,
        cost: float = 1.0,
    ) -> dict[str, Any]:
        chain = await provider_service.route(task_type, quality=quality, speed=speed, cost=cost)
        return {"providers": chain}

    tool_registry.register("provider.list", "列出 Provider", "provider")
    tool_registry.register("provider.health", "Provider 健康检测", "provider")
    tool_registry.register("provider.route", "Provider 路由", "provider")
