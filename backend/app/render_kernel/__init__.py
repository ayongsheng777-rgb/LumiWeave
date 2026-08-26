"""
LumiWeave V2.5 Render Kernel — 统一渲染内核
规格书 §4-§7: VisualIntent → RenderPlan → Capability Router → RenderJob
"""
from app.render_kernel.job import RenderJob, RenderJobManager, get_job_manager
from app.render_kernel.compiler import compile
from app.render_kernel.router import SmartRouter, route

__all__ = [
    "RenderJob",
    "RenderJobManager",
    "get_job_manager",
    "compile",
    "SmartRouter",
    "route",
]
