"""统一的 DAG JSON 规范（架构文档§三.1）。

这是前后端通信的唯一契约。无论前端连线多复杂，
最终必须组装成该格式提交给后端。

与现有 `app.agent.types.WorkflowGraph` 的关系：
- 本模块是「对外协议层」（含 workflow_id、params 命名），
  面向 API 入参/出参。
- `app.agent.types` 是「引擎执行层」（data 命名），面向执行。
- 提供 `to_engine_graph()` 一键转换，互不侵入。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class Node(BaseModel):
    """DAG 节点：唯一 id + 类型 + 参数。"""

    id: str
    type: str  # e.g., "input", "llm", "prompt_template", "skill", "output", "render"
    params: Dict[str, Any] = Field(default_factory=dict)


class Edge(BaseModel):
    """DAG 连线：source -> target 的有向边。"""

    source: str
    target: str
    source_handle: Optional[str] = None
    target_handle: Optional[str] = None


class WorkflowDAG(BaseModel):
    """整张工作流：带 workflow_id 的节点 + 连线集合。"""

    workflow_id: str = "default"
    nodes: List[Node] = Field(default_factory=list)
    edges: List[Edge] = Field(default_factory=list)

    def to_engine_graph(self):
        """转换为引擎执行层的 WorkflowGraph（app.agent.types）。

        命名映射：params -> data，source_handle/target_handle -> sourceHandle/targetHandle。
        引擎节点 id 直接用协议层 id（引擎不要求与连线 id 一致）。
        """
        from app.agent.types import WorkflowEdge, WorkflowGraph, WorkflowNode

        nodes = [
            WorkflowNode(id=n.id, type=n.type, data=dict(n.params or {}))
            for n in self.nodes
        ]
        edges = [
            WorkflowEdge(
                id=f"{e.source}->{e.target}",
                source=e.source,
                target=e.target,
                sourceHandle=e.source_handle,
                targetHandle=e.target_handle,
            )
            for e in self.edges
        ]
        return WorkflowGraph(nodes=nodes, edges=edges)
