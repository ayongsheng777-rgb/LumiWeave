"""Canvas 对象 与 WorkflowGraph 的双向转换（规格书 §7）。

这是「无限画布对象」与「DAG 工作流节点」之间的桥。V2.1 统一模型后：
  - 工作流节点（input/llm/skill/render/output 等）本质也是画布对象，
    通过 `metadata.node_type` 标记其节点身份；
  - 自由画布对象（text/image/prompt/note 等）不参与 DAG 执行，仅展示。

本模块工作在引擎层格式（data 命名），与 `app.agent.types.WorkflowGraph`
以及前端 workflowStore 提交格式完全一致，避免再引入一层协议转换。

关系（规格书 §6）：
    Project
     └── Canvas
          ├── CanvasObject（自由对象：text/image/prompt/...）
          └── WorkflowGraph（DAG：input/llm/skill/render/output）
两者通过 project_id 关联，本模块负责在需要时互相映射。
"""
from __future__ import annotations

from typing import Any

# 工作流节点类型集合：这些类型会被当作 DAG 节点执行
WORKFLOW_NODE_TYPES = {
    "input", "prompt_template", "llm", "agent", "skill",
    "render", "image", "video", "file", "condition", "merge", "output",
}


def is_workflow_node(obj: dict[str, Any]) -> bool:
    """判断一个画布对象是否属于工作流节点。"""
    ntype = obj.get("metadata", {}).get("node_type") or obj.get("type")
    return ntype in WORKFLOW_NODE_TYPES


def canvas_to_workflow(
    objects: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> dict[str, Any]:
    """将 Canvas 对象 + 连线转换成 WorkflowGraph（引擎层格式）。

    只提取工作流节点类型，自由对象（text/note/prompt）被跳过。
    """
    nodes: list[dict[str, Any]] = []
    valid_ids = {obj["id"] for obj in objects}

    for obj in objects:
        ntype = obj.get("metadata", {}).get("node_type") or obj.get("type")
        if ntype not in WORKFLOW_NODE_TYPES:
            continue
        content = obj.get("content") or {}
        nodes.append({
            "id": obj["id"],
            "type": ntype,
            "data": content if isinstance(content, dict) else {},
            "position": obj.get("position") or {"x": 0, "y": 0},
            "metadata": obj.get("metadata") or {},
        })

    # 只保留两端节点都存在的连线
    valid_edges = [
        e for e in edges
        if e.get("source") in valid_ids and e.get("target") in valid_ids
    ]

    return {"nodes": nodes, "edges": valid_edges}


def workflow_to_canvas(
    workflow: dict[str, Any],
) -> dict[str, Any]:
    """将 WorkflowGraph 转换为 Canvas 持久化结构（objects + edges）。

    工作流节点的 data 落到对象 content，node_type 标记写进 metadata，
    供 canvas_to_workflow 反向还原。
    """
    objects: list[dict[str, Any]] = []
    for node in workflow.get("nodes", []):
        meta = dict(node.get("metadata") or {})
        meta.setdefault("node_type", node.get("type", "workflow"))
        objects.append({
            "id": node["id"],
            "type": meta.get("canvas_type", "workflow"),
            "content": node.get("data") or {},
            "position": node.get("position") or {"x": 0, "y": 0},
            "size": node.get("size") or {},
            "metadata": meta,
        })

    return {
        "objects": objects,
        "edges": workflow.get("edges", []),
    }
