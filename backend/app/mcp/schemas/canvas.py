"""画布对象数据模型（MCP）。"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CanvasObject(BaseModel):
    id: str = ""
    project_id: str = ""
    type: str = "text"
    content: dict[str, Any] = Field(default_factory=dict)
    position: dict[str, Any] = Field(default_factory=dict)
    size: dict[str, Any] = Field(default_factory=dict)
    layer: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)
