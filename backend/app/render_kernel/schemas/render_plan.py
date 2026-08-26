"""RenderPlan — 渲染执行计划（规格书 §4 RenderPlan）。"""
from __future__ import annotations

from typing import Optional, Literal
from pydantic import BaseModel, Field
from datetime import datetime


class ImageOutput(BaseModel):
    width: int = Field(default=1024, ge=256, le=4096)
    height: int = Field(default=1024, ge=256, le=4096)
    steps: int = Field(default=25, ge=1, le=200)
    cfg_scale: float = Field(default=7.0, ge=0.0, le=30.0)
    seed: Optional[int] = Field(default=None)
    batch_size: int = Field(default=1, ge=1, le=16)


class VideoOutput(BaseModel):
    duration: float = Field(default=5.0, ge=1.0, le=60.0, description="秒")
    fps: int = Field(default=24, ge=8, le=120)
    model: str = Field(default="minimax-video")
    prompt_strength: float = Field(default=0.85, ge=0.0, le=1.0)


class RoutingPolicy(BaseModel):
    """路由策略：优先走哪个渲染引擎。"""
    preferred: Literal["comfyui", "cloud", "video"] = "cloud"
    fallback: Optional[Literal["comfyui", "cloud", "video"]] = None
    force_provider: Optional[str] = Field(default=None, description="强制指定 provider id")
    capability_required: list[str] = Field(default_factory=list)


class ParameterCompiler(BaseModel):
    """编译后的完整参数字典，可直接送入渲染引擎。"""
    engine: str = Field(description="comfyui | cloud | minimax-video | ...")
    params: dict = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list, description="降级或参数裁剪警告")


class RenderPlanV1(BaseModel):
    """RenderPlan V1 — 最终渲染执行计划。"""
    plan_id: str = Field(description="UUID，本地与后端对齐")
    version: Literal["1.0"] = "1.0"
    visual_text: str = Field(default="")
    negative_text: str = Field(default="")
    image: ImageOutput = Field(default_factory=ImageOutput)
    video: VideoOutput = Field(default_factory=VideoOutput)
    routing: RoutingPolicy = Field(default_factory=RoutingPolicy)
    capability_required: list[str] = Field(default_factory=list)
    compiled: Optional[ParameterCompiler] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class RenderPlan(RenderPlanV1):
    """规格书 §4 统一 RenderPlan（向后兼容 V1）。"""
    pass


# ── helpers ────────────────────────────────────────────────────────────────────

def build_prompt(
    text: str,
    camera: Optional[dict] = None,
    lighting: Optional[dict] = None,
    style: Optional[dict] = None,
) -> tuple[str, str]:
    """
    将 VisualIntent 各字段拼接为渲染引擎接受的 prompt 字符串。

    返回 (positive_prompt, negative_prompt)。
    camera/lighting/style 任一传 dict 则追加对应英文标签。
    """
    parts = [text.strip()] if text.strip() else []
    if camera:
        shot = camera.get("shot", "")
        angle = camera.get("angle", "")
        lens  = camera.get("lens")
        tags = [s for s in [shot, angle, f"{lens}mm lens" if lens else None] if s]
        parts.append(", ".join(tags))
    if lighting:
        direction = lighting.get("direction", "")
        temp = lighting.get("temperature")
        tags = [s for s in [direction, f"{temp}K" if temp else None] if s]
        parts.append(f"lighting: {', '.join(tags)}")
    if style:
        st = style.get("style", "")
        if st:
            parts.append(f"style: {st}")

    pos = ". ".join(parts)
    neg = "blurry, low quality, deformed, watermark, text, logo"
    return pos, neg


def compile_visual_to_plan(vi: dict, capability_required: Optional[list[str]] = None) -> RenderPlan:
    """
    把 normalize_visual_intent() 输出的 dict 编译为 RenderPlan。
    capability_required 为空时根据 image/video 输出自动推导。
    """
    cap = capability_required or []
    has_video = bool(vi.get("motion", {}).get("type", "static") != "static")
    if "video" not in cap and has_video:
        cap = cap + ["video_generation"]

    routing = RoutingPolicy()
    if "comfyui" in cap:
        routing = RoutingPolicy(preferred="comfyui", fallback="cloud")
    elif "video_generation" in cap:
        routing = RoutingPolicy(preferred="video", fallback="cloud")

    pos, neg = build_prompt(
        vi.get("text", ""),
        camera=vi.get("camera"),
        lighting=vi.get("lighting"),
        style=vi.get("style"),
    )

    img = vi.get("image", {})
    vid = vi.get("video", {}) or {}
    mot = vi.get("motion", {})

    return RenderPlan(
        plan_id=vi.get("plan_id", ""),
        visual_text=pos,
        negative_text=neg,
        image=ImageOutput(
            width=img.get("width", 1024),
            height=img.get("height", 1024),
            steps=img.get("steps", 25),
            cfg_scale=img.get("cfg_scale", 7.0),
            seed=img.get("seed"),
            batch_size=img.get("batch_size", 1),
        ),
        video=VideoOutput(
            duration=vid.get("duration", 5.0),
            fps=vid.get("fps", 24),
            model=vid.get("model", "minimax-video"),
            prompt_strength=vid.get("prompt_strength", 0.85),
        ) if has_video else VideoOutput(),
        routing=routing,
        capability_required=cap,
        compiled=None,
    )
