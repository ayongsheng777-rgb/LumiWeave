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


# ==================== V2.1 结构化节点结果（规格书 §9/§10） ====================


@dataclass
class NodeExecutionContext:
    """单个节点执行时的上下文：task/workflow/node 标识 + 输入输出。"""

    task_id: str
    workflow_id: str
    node_id: str
    inputs: dict[str, Any] = field(default_factory=dict)
    outputs: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class NodeResult:
    """节点的结构化执行结果，禁止再返回随意字符串。"""

    ok: bool
    node_id: str
    status: str  # queued|running|completed|failed|cancelled|timeout
    output: Any = None
    error: dict[str, Any] | None = None
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, Any] = field(default_factory=dict)
    duration_ms: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "node_id": self.node_id,
            "status": self.status,
            "output": self.output,
            "error": self.error,
            "artifacts": self.artifacts,
            "usage": self.usage,
            "duration_ms": self.duration_ms,
        }

    @classmethod
    def success(cls, node_id: str, output: Any, *, usage: dict[str, Any] | None = None,
                artifacts: list[dict[str, Any]] | None = None, duration_ms: int = 0) -> "NodeResult":
        return cls(True, node_id, "completed", output=output, usage=usage or {},
                   artifacts=artifacts or [], duration_ms=duration_ms)

    @classmethod
    def failure(cls, node_id: str, code: str, message: str,
                status: str = "failed", duration_ms: int = 0) -> "NodeResult":
        return cls(False, node_id, status, error={"code": code, "message": message},
                   duration_ms=duration_ms)
