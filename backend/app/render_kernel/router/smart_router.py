"""SmartRouter — RenderPlan 路由决策（规格书 §5）。"""
from __future__ import annotations

from app.render_kernel.schemas.render_plan import RenderPlan, RoutingPolicy
from app.render_kernel.registry.capability import resolve_capabilities, get_registry
from app.render_kernel.adapters import (
    RenderAdapter, ComfyUIAdapter, CloudAdapter, VideoAdapter,
)
from app.render_kernel.adapters.base import AdapterResponse


# 适配器单例（延迟创建）
_adapters: dict[str, RenderAdapter] = {}


def _get_adapter(engine: str) -> RenderAdapter:
    if engine not in _adapters:
        if engine == "comfyui":
            _adapters[engine] = ComfyUIAdapter()
        elif engine == "cloud":
            _adapters[engine] = CloudAdapter()
        elif engine in ("minimax-video", "video"):
            _adapters[engine] = VideoAdapter()
        else:
            # 默认用云端
            _adapters[engine] = CloudAdapter()
    return _adapters[engine]


class SmartRouter:
    """
    根据 RenderPlan.routing 策略 + capability_required，
    自动选择最优适配器并提交任务。
    """

    def __init__(self) -> None:
        self._registry = get_registry()

    def route(self, plan: RenderPlan) -> str:
        """
        返回选中的 engine 字符串。
        不实际提交，只做路由决策。
        """
        rp = plan.routing

        # 强制指定
        if rp.force_provider:
            return self._best_engine_for_provider(rp.force_provider)

        # 先查 capability_required
        if plan.capability_required:
            caps = resolve_capabilities(plan.capability_required)
            if caps:
                return caps[0].engine

        # 按路由策略
        pref = rp.preferred or "cloud"
        if pref in ("comfyui", "cloud", "video"):
            return pref

        return "cloud"

    async def submit(self, plan: RenderPlan) -> AdapterResponse:
        """完整路由：选引擎 + 提交。"""
        engine = self.route(plan)
        adapter = _get_adapter(engine)
        return await adapter.submit(plan)

    async def status(self, engine: str, job_id: str) -> AdapterResponse:
        adapter = _get_adapter(engine)
        return await adapter.status(job_id)

    async def cancel(self, engine: str, job_id: str) -> AdapterResponse:
        adapter = _get_adapter(engine)
        return await adapter.cancel(job_id)

    def _best_engine_for_provider(self, provider_id: str) -> str:
        """provider_id → engine。"""
        mapping = {
            "comfyui": "comfyui",
            "minimax": "cloud",
            "default": "cloud",
        }
        return mapping.get(provider_id, "cloud")


# ── 快捷函数 ───────────────────────────────────────────────────────────────────
_router = SmartRouter()


def route(plan: RenderPlan) -> str:
    return _router.route(plan)
