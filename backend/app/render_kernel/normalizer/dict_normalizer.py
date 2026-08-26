"""中英文同义词归一化（规格书 §3.3）。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class NormalizerResult:
    normalized: dict
    issues: list[dict] = field(default_factory=list)  # [{field, original, normalized, reason}]


# ── 中英文同义词映射表 ─────────────────────────────────────────────────────────
_SHOT_MAP = {
    # 英文 → 标准英文
    "extreme wide": "extreme_wide", "extreme-wide": "extreme_wide", "ew": "extreme_wide",
    "wide": "wide", "ws": "wide", "wide shot": "wide",
    "full": "full", "fs": "full", "full shot": "full",
    "medium": "medium", "ms": "medium", "medium shot": "medium",
    "close up": "close_up", "close-up": "close_up", "cu": "close_up",
    "extreme close up": "extreme_close_up", "extreme-close-up": "extreme_close_up", "ecu": "extreme_close_up",
}
_ANGLE_MAP = {
    "eye level": "eye", "eye-level": "eye", "neutral": "eye",
    "high angle": "high", "high": "high",
    "low angle": "low", "low": "low",
    "bird": "bird", "bird view": "bird", "overhead": "bird",
    "worm": "worm", "worm view": "worm", "from below": "worm",
    "dutch": "dutch", "dutch angle": "dutch",
}
_LIGHTING_DIR_MAP = {
    "正光": "front", "正面光": "front", "柔光": "front",
    "侧光": "side_left", "左侧光": "side_left", "右侧光": "side_right",
    "背光": "back", "逆光": "back", "轮廓光": "back",
    "顶光": "top", "顶棚光": "top",
    "底光": "low", "脚下光": "low",
}
_MOTION_TYPE_MAP = {
    "静止": "static", "无运动": "static", "fixed": "static",
    "推近": "zoom_in", "zoom in": "zoom_in", "zoom_in": "zoom_in",
    "拉远": "zoom_out", "zoom out": "zoom_out", "zoom_out": "zoom_out",
    "左移": "pan_left", "向左平移": "pan_left",
    "右移": "pan_right", "向右平移": "pan_right",
    "上摇": "tilt_up", "向上倾斜": "tilt_up",
    "下摇": "tilt_down", "向下倾斜": "tilt_down",
    "推进": "dolly_in", "dolly in": "dolly_in",
    "拉出": "dolly_out", "dolly out": "dolly_out",
}


def normalize_text(raw: str) -> str:
    """单行文本去首尾空格。"""
    return raw.strip() if raw else ""


def _norm(val: Optional[str], mapping: dict[str, str]) -> tuple[str, bool, Optional[str]]:
    """
    查映射表规范化值。
    返回 (normalized_value, changed, original_if_changed)。
    """
    if not val:
        return val or "", False, None
    lower = val.lower().strip()
    for k, v in mapping.items():
        if k.lower() == lower or lower == k:
            return v, v != val, val
    return val, False, None


def normalize_dict(raw: dict) -> NormalizerResult:
    """
    将 VisualIntent dict 的各字段做中英文同义词归一化。
    返回 normalized dict + issues 列表。
    """
    vi = dict(raw)
    issues: list[dict] = []

    # camera.shot
    cam = vi.get("camera", {})
    if cam:
        shot_raw = cam.get("shot", "")
        norm_shot, changed, orig = _norm(shot_raw, _SHOT_MAP)
        if changed:
            cam["shot"] = norm_shot
            issues.append({"field": "camera.shot", "original": orig, "normalized": norm_shot, "reason": "中英同义归一化"})
        angle_raw = cam.get("angle", "")
        norm_angle, changed2, orig2 = _norm(angle_raw, _ANGLE_MAP)
        if changed2:
            cam["angle"] = norm_angle
            issues.append({"field": "camera.angle", "original": orig2, "normalized": norm_angle, "reason": "中英同义归一化"})
        vi["camera"] = cam

    # lighting.direction
    lit = vi.get("lighting", {})
    if lit:
        dir_raw = lit.get("direction", "")
        norm_dir, changed3, orig3 = _norm(dir_raw, _LIGHTING_DIR_MAP)
        if changed3:
            lit["direction"] = norm_dir
            issues.append({"field": "lighting.direction", "original": orig3, "normalized": norm_dir, "reason": "中英同义归一化"})
        vi["lighting"] = lit

    # motion.type
    mot = vi.get("motion", {})
    if mot:
        type_raw = mot.get("type", "")
        norm_type, changed4, orig4 = _norm(type_raw, _MOTION_TYPE_MAP)
        if changed4:
            mot["type"] = norm_type
            issues.append({"field": "motion.type", "original": orig4, "normalized": norm_type, "reason": "中英同义归一化"})
        vi["motion"] = mot

    return NormalizerResult(normalized=vi, issues=issues)
