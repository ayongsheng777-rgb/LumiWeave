"""Render Kernel schemas: VisualIntent / RenderPlan / JobEvent."""
from app.render_kernel.schemas.visual_intent import (
    VisualIntent,
    CameraIntent,
    LightingIntent,
    MotionIntent,
    StyleIntent,
    ReferenceIntent,
    NormalizationIssue,
    normalize_visual_intent,
)
from app.render_kernel.schemas.render_plan import (
    RenderPlan,
    RenderPlanV1,
    RoutingPolicy,
    ImageOutput,
    VideoOutput,
    ParameterCompiler,
    build_prompt,
    compile_visual_to_plan,
)
from app.render_kernel.schemas.events import (
    JobEvent,
    JobEventType,
    JobProgressPayload,
    JobCompletedPayload,
    JobFailedPayload,
    JobCreatedPayload,
)

__all__ = [
    # visual_intent
    "VisualIntent", "CameraIntent", "LightingIntent", "MotionIntent",
    "StyleIntent", "ReferenceIntent", "NormalizationIssue",
    "normalize_visual_intent",
    # render_plan
    "RenderPlan", "RenderPlanV1", "RoutingPolicy",
    "ImageOutput", "VideoOutput", "ParameterCompiler",
    "build_prompt", "compile_visual_to_plan",
    # events
    "JobEvent", "JobEventType",
    "JobProgressPayload", "JobCompletedPayload",
    "JobFailedPayload", "JobCreatedPayload",
]
