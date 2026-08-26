"""渲染引擎适配器（规格书 §5 底层）。"""
from app.render_kernel.adapters.base import RenderAdapter, AdapterResponse
from app.render_kernel.adapters.comfyui import ComfyUIAdapter
from app.render_kernel.adapters.cloud import CloudAdapter
from app.render_kernel.adapters.video import VideoAdapter

__all__ = [
    "RenderAdapter",
    "AdapterResponse",
    "ComfyUIAdapter",
    "CloudAdapter",
    "VideoAdapter",
]
