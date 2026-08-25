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
    # ── 旧节点（保留兼容）───────────────────────────────
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
    NodeDefinition("image", "图片", CATEGORY_GEN, "图片媒体对象（透传上游结果）", {}, {}),
    NodeDefinition("video", "视频", CATEGORY_GEN, "视频媒体对象（透传上游结果）", {}, {}),
    NodeDefinition("file", "文件", CATEGORY_PROC, "文件对象", {}, {}),
    NodeDefinition("condition", "条件", CATEGORY_CTRL, "条件分支（预留）", {}, {}),
    NodeDefinition("merge", "合并", CATEGORY_CTRL, "合并上游多路输出", {}, {}),
    NodeDefinition("output", "输出", CATEGORY_OUTPUT, "汇总上游结果，作为工作流终点的展示",
                   {"text": "string"}, {"content": "string"}),
    # ── 影视创作节点 V2 ────────────────────────────────
    NodeDefinition(
        "story", "故事输入", "创作入口",
        "输入故事/小说/广告需求，AI 解析生成角色/场景/道具/分镜",
        {"text": "string", "genre": "string", "style": "string", "ratio": "string", "duration": "int"},
        {"characters": "array", "scenes": "array", "props": "array", "shots": "array"},
    ),
    NodeDefinition(
        "character", "角色设计", "资产生成",
        "角色生成，支持换装/表情/姿态，一致性种子保持角色连续性",
        {"name": "string", "description": "string", "prompt": "string", "style": "string", "pose": "string", "expression": "string", "seed": "string"},
        {"name": "string", "seed": "string", "url": "string", "images": "array"},
    ),
    NodeDefinition(
        "scene", "场景设计", "资产生成",
        "场景生成，支持城市/森林/空间站等，可调天气/时间/镜头",
        {"name": "string", "location": "string", "time": "string", "weather": "string", "camera": "string", "description": "string", "style": "string"},
        {"name": "string", "location": "string", "url": "string", "images": "array"},
    ),
    NodeDefinition(
        "prop", "关键道具", "资产生成",
        "道具生成，可绑定角色或场景，支持变化版本",
        {"name": "string", "description": "string", "prompt": "string", "bind_type": "string", "bind_id": "string"},
        {"name": "string", "url": "string", "images": "array"},
    ),
    NodeDefinition(
        "storyboard", "电影分镜", "分镜",
        "Shot-by-Shot 分镜表，支持 camera/duration/description",
        {"shots": "array", "ratio": "string", "total_duration": "int"},
        {"shots": "array", "total_duration": "int"},
    ),
    NodeDefinition(
        "audio", "声音", "后期制作",
        "旁白/角色配音/BGM/音效，支持多种音色",
        {"type": "string", "script": "string", "voice": "string"},
        {"type": "string", "audio_url": "string"},
    ),
    NodeDefinition(
        "subtitle", "字幕", "后期制作",
        "语音识别生成字幕，支持 SRT/ASS 格式，可烧录进视频",
        {"video_url": "string", "audio_url": "string", "format": "string", "burnt_in": "bool"},
        {"format": "string", "subtitle_url": "string", "content": "string"},
    ),
    NodeDefinition(
        "layout", "排版设计", "后期制作",
        "电影海报/社交封面/专辑封面等排版模板",
        {"template": "string", "ratio": "string", "elements": "array"},
        {"template": "string", "url": "string"},
    ),
    NodeDefinition(
        "export", "导出成片", "后期制作",
        "导出 MP4/MOV/PNG/PDF 分镜脚本，支持字幕/分镜包",
        {"format": "string", "video_url": "string", "subtitle_url": "string", "include_storyboard": "bool", "include_subtitles": "bool"},
        {"format": "string", "status": "string"},
    ),
]

for _d in _BUILTIN:
    register_node(_d)
