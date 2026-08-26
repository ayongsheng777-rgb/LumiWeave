"""场景引擎包（V2.5 规格书 §5-§13）。

Scene Engine 把"画布"从通用节点编辑器升级为"专业场景画布"：
- 场景(Scene) 定义一套专业对象(Object) 与 AI 动作(Action)
- 三大 P0 场景：电商商品营销物料 / 电商短剧带货 / 影视拉片
- 底层仍复用 React Flow / DAG / Renderer / Provider / MCP 基础设施
"""
from __future__ import annotations

from app.scene.registry import registry, SceneDefinition

__all__ = ["registry", "SceneDefinition"]
