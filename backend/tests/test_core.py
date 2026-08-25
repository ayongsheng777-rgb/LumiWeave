"""LumiWeave V2.1 核心单元测试（规格书 §37/§38）。

覆盖：DAG 环检测、节点执行闭环、Canvas↔Workflow 转换、
Node Registry、结构化结果、变量注入。均为纯逻辑测试，不依赖外部服务。
"""
import asyncio

import pytest

from app.agent.engine import WorkflowEngine, WorkflowExecutionError
from app.agent.node_registry import get_node, list_nodes
from app.agent.types import (
    NodeResult,
    WorkflowEdge,
    WorkflowGraph,
    WorkflowNode,
)
from app.canvas.workflow_adapter import canvas_to_workflow, workflow_to_canvas


def _graph(nodes, edges):
    return WorkflowGraph(nodes=nodes, edges=edges)


def _run(graph):
    return asyncio.run(WorkflowEngine(graph).execute())


def test_workflow_rejects_cycle():
    graph = _graph(
        [
            WorkflowNode(id="a", type="input", data={}),
            WorkflowNode(id="b", type="output", data={}),
        ],
        [
            WorkflowEdge(id="e1", source="a", target="b"),
            WorkflowEdge(id="e2", source="b", target="a"),
        ],
    )
    with pytest.raises(ValueError):
        WorkflowEngine(graph)


def test_workflow_rejects_missing_node_edge():
    graph = _graph(
        [WorkflowNode(id="a", type="input", data={})],
        [WorkflowEdge(id="e1", source="a", target="ghost")],
    )
    with pytest.raises(ValueError):
        WorkflowEngine(graph)


def test_input_output_flow():
    """最小闭环：input -> output，验证拓扑执行 + 变量透传。"""
    graph = _graph(
        [
            WorkflowNode(id="n1", type="input", data={"text": "你好 LumiWeave"}),
            WorkflowNode(id="n2", type="output", data={}),
        ],
        [WorkflowEdge(id="e1", source="n1", target="n2")],
    )
    result = _run(graph)
    assert result["final_output"]["content"] == "你好 LumiWeave"
    assert result["node_results"]["n2"]["ok"] is True


def test_node_result_structure():
    r = NodeResult.success("n1", {"content": "hi"}, usage={"prompt_tokens": 1})
    assert r.ok is True
    assert r.status == "completed"
    assert r.as_dict()["output"] == {"content": "hi"}
    f = NodeResult.failure("n1", "NODE_ERROR", "boom")
    assert f.ok is False
    assert f.error["code"] == "NODE_ERROR"


def test_workflow_adapter_roundtrip():
    objs = [
        {
            "id": "n1", "type": "workflow",
            "content": {"text": "hi"}, "position": {"x": 1, "y": 2},
            "metadata": {"node_type": "input"},
        },
        {
            "id": "n2", "type": "text", "content": {"text": "自由对象"},
            "metadata": {},
        },
    ]
    edges = [{"source": "n1", "target": "n2"}]
    wf = canvas_to_workflow(objs, edges)
    # 自由对象（text）不参与 DAG，被跳过
    assert len(wf["nodes"]) == 1
    assert wf["nodes"][0]["type"] == "input"
    # 反向转换
    back = workflow_to_canvas(wf)
    assert back["objects"][0]["type"] == "workflow"
    assert back["objects"][0]["metadata"]["node_type"] == "input"


def test_node_registry():
    nodes = list_nodes()
    types = {n["type"] for n in nodes}
    for t in ("input", "llm", "prompt_template", "agent", "skill", "render", "output"):
        assert t in types
    assert get_node("llm") is not None
    assert get_node("not_exist") is None


def test_variable_injection():
    outputs = {"a": {"content": "hello"}, "b": "world"}
    assert WorkflowEngine._render("{{a}}", outputs) == "hello"
    assert WorkflowEngine._render("{{a.content}}", outputs) == "hello"
    assert WorkflowEngine._render("{{b}}", outputs) == "world"
    assert WorkflowEngine._render("{{missing}}", outputs) == "{{missing}}"


def test_unknown_node_type_fails():
    graph = _graph(
        [WorkflowNode(id="x", type="whatever", data={})],
        [],
    )
    with pytest.raises(WorkflowExecutionError):
        _run(graph)
