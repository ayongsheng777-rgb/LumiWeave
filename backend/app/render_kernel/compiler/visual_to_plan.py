"""compile() — 统一编译入口（规格书 §4 + §7）。"""
from __future__ import annotations

import uuid
from typing import Optional
from app.render_kernel.schemas.render_plan import (
    RenderPlan, ImageOutput, VideoOutput, RoutingPolicy,
    ParameterCompiler, build_prompt,
)
from app.render_kernel.normalizer.dict_normalizer import normalize_dict
from app.render_kernel.validator.capability_checker import CapabilityChecker
from app.render_kernel.validator.prompt_safety import check_prompt_safety


def compile(
    visual_intent: dict,
    capability_required: Optional[list[str]] = None,
    force_provider: Optional[str] = None,
) -> RenderPlan:
    """
    完整编译链路：

    1. 中英文归一化（dict_normalizer）
    2. 内容安全校验（prompt_safety）
    3. 能力校验（capability_checker）
    4. VisualIntent → RenderPlan 编译

    参数:
        visual_intent: 前端 canvas 节点打包的意图字典
        capability_required: 显式指定的能力标签
        force_provider: 强制路由到指定 provider_id
    返回:
        RenderPlan（未 compiled 字段，可在 router 层填充）
    """
    # 1. 归一化
    norm_result = normalize_dict(visual_intent)
    vi = norm_result.normalized

    # 2. 安全校验
    pos_text = vi.get("text", "")
    neg_text = vi.get("negative", "")
    safety = check_prompt_safety(pos_text, neg_text)
    if not safety.safe:
        raise ValueError(f"[内容安全] {safety.message}")

    # 3. 能力推导
    has_video = vi.get("motion", {}).get("type", "static") != "static"
    caps = list(capability_required or [])
    if has_video and "video_generation" not in caps:
        caps.append("video_generation")

    # 4. 编译
    pos_prompt, neg_prompt = build_prompt(
        pos_text,
        camera=vi.get("camera"),
        lighting=vi.get("lighting"),
        style=vi.get("style"),
    )

    routing = RoutingPolicy()
    if force_provider:
        routing = RoutingPolicy(force_provider=force_provider)
    elif any("video" in c for c in caps):
        routing = RoutingPolicy(preferred="video", fallback="cloud")
    elif any(c in caps for c in ["ip_adapter", "controlnet"]):
        routing = RoutingPolicy(preferred="comfyui", fallback="cloud")

    img_cfg = vi.get("image", {})
    vid_cfg = vi.get("video", {}) or {}

    plan = RenderPlan(
        plan_id=vi.get("plan_id") or str(uuid.uuid4()),
        version="1.0",
        visual_text=pos_prompt,
        negative_text=neg_prompt,
        image=ImageOutput(
            width=img_cfg.get("width", 1024),
            height=img_cfg.get("height", 1024),
            steps=img_cfg.get("steps", 25),
            cfg_scale=img_cfg.get("cfg_scale", 7.0),
            seed=img_cfg.get("seed"),
            batch_size=img_cfg.get("batch_size", 1),
        ),
        video=VideoOutput(
            duration=vid_cfg.get("duration", 5.0),
            fps=vid_cfg.get("fps", 24),
            model=vid_cfg.get("model", "minimax-video"),
            prompt_strength=vid_cfg.get("prompt_strength", 0.85),
        ) if has_video else VideoOutput(),
        routing=routing,
        capability_required=caps,
        compiled=None,
    )

    # 5. 能力警告（非致命）
    warns = CapabilityChecker().check_plan(plan)
    for w in warns:
        print(f"[CapabilityCheck] {w}")

    return plan
