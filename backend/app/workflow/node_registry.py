"""统一节点注册表（规格书 §8）。

把散落在 engine.py 里 if-else 的节点类型，提升为可查询、带 schema 的
NodeDefinition 注册表。前端 Node Library 直接消费 list_nodes() 渲染分类。

executor 是可选扩展点：内置节点（input/llm/skill/render/output 等）由
engine 内部执行，第三方节点可通过 register_node(executor=...) 扩展。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

# 节点分类（规格书 §25）
CATEGORY_INPUT = "输入"
CATEGORY_AI = "AI"
CATEGORY_SKILL = "Skill"
CATEGORY_GEN = "生成"
CATEGORY_PROC = "处理"
CATEGORY_CTRL = "控制"
CATEGORY_OUTPUT = "输出"


@dataclass
class NodeDefinition:
    type: str
    label: str
    category: str
    description: str
    input_schema: dict[str, Any] = field(default_factory=dict)
    output_schema: dict[str, Any] = field(default_factory=dict)
    executor: Callable[..., Awaitable[Any]] | None = None


NODE_REGISTRY: dict[str, NodeDefinition] = {}


def register_node(definition: NodeDefinition) -> None:
    NODE_REGISTRY[definition.type] = definition


def get_node(type_name: str) -> NodeDefinition | None:
    return NODE_REGISTRY.get(type_name)


def list_nodes() -> list[dict[str, Any]]:
    return [
        {
            "type": x.type,
            "label": x.label,
            "category": x.category,
            "description": x.description,
            "input_schema": x.input_schema,
            "output_schema": x.output_schema,
        }
        for x in NODE_REGISTRY.values()
    ]


# ==================== 内置节点定义 ====================

_BUILTIN: list[NodeDefinition] = [
    NodeDefinition("input", "输入", CATEGORY_INPUT, "工作流起点，输入原始文本/需求",
                   {"text": "string"}, {"text": "string"}),
    NodeDefinition("prompt_template", "提示词模板", CATEGORY_AI, "模板 + 知识库检索（RAG）注入",
                   {"template": "string", "query": "string", "k": "int"}, {"prompt": "string"}),
    NodeDefinition("llm", "大模型", CATEGORY_AI, "调用 LLM 推理生成文本",
                   {"system": "string", "prompt": "string", "temperature": "float", "max_tokens": "int"},
                   {"content": "string"}),
    NodeDefinition("skill", "技能", CATEGORY_SKILL, "调用平台技能（Skill Runtime）",
                   {"skill_id": "string", "args": "object"}, {"result": "any"}),
    NodeDefinition("render", "出图/算力", CATEGORY_GEN, "经算力路由提交 ComfyUI 生成图片/视频",
                   {"prompt": "string", "workflow": "object", "model": "string"}, {"render": "object"}),
    NodeDefinition("image", "图片", CATEGORY_GEN, "图片媒体对象", {}, {}),
    NodeDefinition("video", "视频", CATEGORY_GEN, "视频媒体对象", {}, {}),
    NodeDefinition("file", "文件", CATEGORY_PROC, "文件对象", {}, {}),
    NodeDefinition("condition", "条件", CATEGORY_CTRL, "条件分支（预留）", {}, {}),
    NodeDefinition("merge", "合并", CATEGORY_CTRL, "合并上游多路输出", {}, {}),
    NodeDefinition("output", "输出", CATEGORY_OUTPUT, "汇总上游结果，作为工作流终点的展示",
                   {"text": "string"}, {"content": "string"}),
]

for _d in _BUILTIN:
    register_node(_d)
