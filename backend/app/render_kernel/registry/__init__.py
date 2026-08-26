"""Capability registry — 渲染能力注册表（规格书 §5）。"""
from app.render_kernel.registry.capability import (
    ModelCapability,
    CapabilityRegistry,
    get_registry,
    resolve_capabilities,
)

__all__ = [
    "ModelCapability",
    "CapabilityRegistry",
    "get_registry",
    "resolve_capabilities",
]
