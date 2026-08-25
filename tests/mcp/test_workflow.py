"""Workflow MCP 工具测试：工作流的创建 / 查询 / 删除 + 引擎执行。"""
from __future__ import annotations

import pytest

from app.services.workflow_service import workflow_service


@pytest.mark.asyncio
async def test_workflow_crud():
    pid = "test-mcp-workflow"
    nodes = [{"id": "n1", "type": "input", "data": {"text": "测试"}}]
    edges: list = []
    wid = await workflow_service.create("测试流程", nodes, edges, pid)
    assert wid.startswith("wf_")
    wf = await workflow_service.get(wid)
    assert wf is not None
    assert wf["graph"]["nodes"][0]["type"] == "input"
    await workflow_service.delete(wid)
    assert await workflow_service.get(wid) is None


def test_engine_dag():
    """DAG 引擎：input → output 简单链路。"""
    import asyncio

    from app.workflow.engine import WorkflowEngine
    from app.workflow.types import WorkflowEdge, WorkflowGraph, WorkflowNode

    graph = WorkflowGraph(
        nodes=[
            WorkflowNode(id="n1", type="input", data={"text": "你好"}),
            WorkflowNode(id="n2", type="output", data={}),
        ],
        edges=[WorkflowEdge(id="e1", source="n1", target="n2")],
    )
    engine = WorkflowEngine(graph)
    result = asyncio.run(engine.execute())
    assert result["final_output"]["content"] == "你好"
