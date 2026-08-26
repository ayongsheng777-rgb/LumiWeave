"""场景引擎统一数据协议（V2.5 规格书 §6 / §9 / §13）。

全部用 pydantic 定义，供后端 service / routes / 前端共享结构。
注意：落库时 JSONB 字段由 service 层统一 json.dumps/loads，模型本身只描述内存结构。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ─────────────────────────────────────────────────────────────────────────────
# 场景定义（Scene Definition）
# ─────────────────────────────────────────────────────────────────────────────

class SceneDefinition(BaseModel):
    """一套专业场景的静态描述（注册在 registry，不落库）。

    对应规格书 §6 / §7：
    - object_types：该场景可用的专业对象类型
    - actions：该场景可用的 AI 动作
    - toolbar：顶部工具条按钮（场景不同动态变化，§17）
    - inspector：右侧 Inspector 支持的字段分组（§48）
    """

    id: str
    name: str
    version: str = "1.0"
    description: str = ""
    category: str = "general"

    object_types: List[str] = Field(default_factory=list)
    actions: List[str] = Field(default_factory=list)

    toolbar: List[str] = Field(default_factory=list)
    inspector: List[str] = Field(default_factory=list)

    timeline_enabled: bool = False
    workflow_enabled: bool = True

    metadata: Dict[str, Any] = Field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# 画布对象（Canvas Object Model，§9）
# ─────────────────────────────────────────────────────────────────────────────

class CanvasObject(BaseModel):
    id: str

    type: str
    x: float = 0.0
    y: float = 0.0
    width: float = 300.0
    height: float = 200.0
    rotation: float = 0.0
    z_index: int = 0

    locked: bool = False
    hidden: bool = False

    data: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# 影视拉片专业数据模型（§13）
# ─────────────────────────────────────────────────────────────────────────────

class FilmShot(BaseModel):
    """影视拉片：单个镜头的完整分析数据。"""

    id: str
    scene_id: Optional[str] = None

    start_time: float = 0.0
    end_time: float = 0.0
    frame_url: Optional[str] = None

    shot_size: Optional[str] = None
    lens: Optional[str] = None
    camera_angle: Optional[str] = None
    camera_motion: Optional[str] = None
    composition: Optional[str] = None
    lighting: Optional[str] = None
    color: Optional[str] = None

    characters: List[str] = Field(default_factory=list)
    actions: List[str] = Field(default_factory=list)
    emotion: Optional[str] = None

    ai_analysis: Optional[str] = None
    prompt: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# AI Canvas Command（§19 / §21）
# ─────────────────────────────────────────────────────────────────────────────

class CanvasCommand(BaseModel):
    """AI 不直接改库，先生成 Command，经校验后落到 Scene Action → Workflow → Task。"""

    command: str
    target_ids: List[str] = Field(default_factory=list)
    parameters: Dict[str, Any] = Field(default_factory=dict)
