"""VisualIntent — 统一用户创作意图模型（规格书 §3 VisualIntent）。"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class NormalizationIssue(BaseModel):
    field: str
    original: str
    normalized: str
    reason: str


class CameraIntent(BaseModel):
    lens: Optional[int] = Field(default=None, ge=10, le=300, description="焦距 mm")
    shot: Optional[str] = Field(default=None, description="景别: extreme_wide/wide/full/medium/close_up/extreme_close_up")
    angle: Optional[str] = Field(default=None, description="角度: eye/high/low/bird/worm/dutch")


class LightingIntent(BaseModel):
    direction: Optional[str] = Field(default=None, description="方向: front/left/right/back/top/low/side_left/side_right")
    temperature: Optional[int] = Field(default=None, ge=1000, le=20000, description="色温 K")
    intensity: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="强度 0-1")


class MotionIntent(BaseModel):
    type: str = Field(default="static", description="运动: static/zoom_in/zoom_out/pan_left/pan_right/tilt_up/tilt_down/dolly_in/dolly_out")
    speed: float = Field(default=0.3, ge=0.1, le=1.0)
    duration: float = Field(default=5.0, ge=1.0, le=60.0)


class ReferenceIntent(BaseModel):
    images: list[str] = Field(default_factory=list)
    strength: float = Field(default=0.85, ge=0.0, le=1.0, description="参考强度")


class StyleIntent(BaseModel):
    style: str = Field(default="电影感")


class VisualIntent(BaseModel):
    """规格书 §3: VisualIntent — 统一用户创作意图"""
    text: str = Field(default="", description="主体描述 prompt")
    negative: str = Field(default="", description="负向提示词")
    camera: CameraIntent = Field(default_factory=CameraIntent)
    lighting: LightingIntent = Field(default_factory=LightingIntent)
    motion: MotionIntent = Field(default_factory=MotionIntent)
    reference: ReferenceIntent = Field(default_factory=ReferenceIntent)
    style: StyleIntent = Field(default_factory=StyleIntent)
    extra: dict = Field(default_factory=dict, description="扩展槽位（Character/Scene/Prop 等特色节点）")


def normalize_visual_intent(vi: VisualIntent) -> tuple[VisualIntent, list[NormalizationIssue]]:
    """中英文同义词归一化，返回归一化后的 VisualIntent + 变更记录。"""
    issues: list[NormalizationIssue] = []

    shot_map: dict[str, str] = {
        "极远景": "extreme_wide", "远景": "wide", "全景": "full",
        "中景": "medium", "近景": "close_up", "特写": "close_up",
        "大特写": "extreme_close_up", "过肩": "over_shoulder", "主观": "pov",
        "close-up": "close_up", "close_up": "close_up",
    }
    if vi.camera.shot and vi.camera.shot not in shot_map.values():
        norm = shot_map.get(vi.camera.shot)
        if norm:
            issues.append(NormalizationIssue(field="camera.shot", original=vi.camera.shot, normalized=norm, reason="中英同义"))
            vi.camera.shot = norm

    angle_map: dict[str, str] = {
        "平视": "eye", "俯拍": "high", "仰拍": "low",
        "鸟瞰": "bird", "蚁视": "worm", "倾斜": "dutch",
        "eye_level": "eye", "eye": "eye",
    }
    if vi.camera.angle and vi.camera.angle not in angle_map.values():
        norm = angle_map.get(vi.camera.angle)
        if norm:
            issues.append(NormalizationIssue(field="camera.angle", original=vi.camera.angle, normalized=norm, reason="中英同义"))
            vi.camera.angle = norm

    light_dir_map: dict[str, str] = {
        "正面光": "front", "正面": "front",
        "左侧光": "left", "左侧": "left",
        "右侧光": "right", "右侧": "right",
        "逆光": "back", "背面": "back",
        "顶光": "top", "脚光": "low",
        "side_left": "side_left", "side_right": "side_right",
    }
    if vi.lighting.direction and vi.lighting.direction not in ["front", "left", "right", "back", "top", "low", "side_left", "side_right"]:
        norm = light_dir_map.get(vi.lighting.direction)
        if norm:
            issues.append(NormalizationIssue(field="lighting.direction", original=vi.lighting.direction, normalized=norm, reason="中英同义"))
            vi.lighting.direction = norm

    motion_map: dict[str, str] = {
        "静止": "static", "推近": "zoom_in", "拉远": "zoom_out",
        "左摇": "pan_left", "右摇": "pan_right",
        "上摇": "tilt_up", "下摇": "tilt_down",
        "轨道推进": "dolly_in", "轨道拉远": "dolly_out",
        "横移左": "track_left", "横移右": "track_right",
        "升降上": "crane_up", "升降下": "crane_down",
        "手持抖动": "handheld", "旋转": "spin",
        "zoom in": "zoom_in", "zoom out": "zoom_out",
        "dolly in": "dolly_in", "dolly out": "dolly_out",
    }
    if vi.motion.type not in motion_map.values() and motion_map.get(vi.motion.type):
        norm = motion_map[vi.motion.type]
        issues.append(NormalizationIssue(field="motion.type", original=vi.motion.type, normalized=norm, reason="中英同义"))
        vi.motion.type = norm

    return vi, issues
