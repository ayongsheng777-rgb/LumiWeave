from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from pydantic import BaseModel, Field


class WorkflowEdge(BaseModel):
    """画布连线：source -> target 的有向边。"""
    id: str
    source: str
    target: str
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None


class WorkflowNode(BaseModel):
    """画布节点：id + 类型 + 配置数据。"""
    id: str
    type: str
    data: dict[str, Any] = Field(default_factory=dict)


class WorkflowGraph(BaseModel):
    """整张画布：节点 + 连线，构成一个 DAG。"""
    nodes: list[WorkflowNode]
    edges: list[WorkflowEdge]


@dataclass
class AgentRequest:
    task_id: str
    user_id: str
    message: str
    system_prompt: str | None = None
    skills: list[dict[str, Any]] | None = None
    context: dict[str, Any] | None = None
    stream: bool = False


@dataclass
class AgentResponse:
    task_id: str
    agent: str
    content: str
    tool_calls: list[dict[str, Any]] | None = None
    usage: dict[str, Any] | None = None
    finish_reason: str | None = None


@dataclass
class AgentEvent:
    type: str  # token | tool | done | error
    data: dict[str, Any] = field(default_factory=dict)
