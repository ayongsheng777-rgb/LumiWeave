from __future__ import annotations

from app import db
from app.renderers.comfyui import ComfyUIConnector
from app.renderers.registry import BaseRenderer, RendererConfig, RendererRegistry

renderer_registry = RendererRegistry()


def _build(cfg: RendererConfig) -> BaseRenderer:
    if cfg.type == "comfyui":
        return ComfyUIConnector(cfg)
    # image-api / video-api 在此扩展，不影响核心
    return ComfyUIConnector(cfg)


async def init_renderers() -> None:
    """从 renderers 表加载已配置 Renderer。"""
    rows = await db.fetch("SELECT * FROM renderers")
    renderer_registry._renderers.clear()
    for row in rows:
        cfg = RendererConfig.from_db(dict(row))
        renderer_registry.register(_build(cfg))
