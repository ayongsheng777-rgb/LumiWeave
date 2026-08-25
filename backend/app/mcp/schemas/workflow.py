"""工作流数据模型（MCP）。"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class WorkflowDefinition(BaseModel):
    id: str = ""
    name: str = ""
    project_id: str = ""
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
