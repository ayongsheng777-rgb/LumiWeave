"""画布工作流执行引擎。

把前端提交的 DAG（节点 + 连线）按拓扑排序依次执行，每个节点绑定到
平台真实的业务模块：
  - input           输入节点：透传原始需求
  - llm             大模型推理节点 -> app.ai.client.chat_full
  - prompt_template 提示词模板节点 -> app.prompt_learning.retrieve_for（知识库检索注入）
  - skill           技能节点 -> app.skills.skill_manager.execute
  - output          输出节点：汇总上游结果

节点 data 中的字符串支持变量注入：{{node_id}} 引用上游节点的输出，
{{node_id.key}} 精确取 dict 中的字段。
"""
from __future__ import annotations

import re
from typing import Any, Awaitable, Callable, Optional

import networkx as nx

from app.agent.types import WorkflowGraph

# 节点状态推送回调：on_event(node_id, status, result)
EventCallback = Callable[[str, str, Any], Awaitable[None]]


class WorkflowEngine:
    def __init__(self, graph: WorkflowGraph) -> None:
        self.graph = graph
        self.dag = self._build_dag()

    def _build_dag(self) -> nx.DiGraph:
        g = nx.DiGraph()
        for node in self.graph.nodes:
            g.add_node(node.id, type=node.type, data=node.data)
        for edge in self.graph.edges:
            if edge.source not in g or edge.target not in g:
                raise ValueError(f"连线引用了不存在的节点: {edge.source} -> {edge.target}")
            g.add_edge(edge.source, edge.target)
        if not nx.is_directed_acyclic_graph(g):
            raise ValueError("工作流存在环路，不是合法的 DAG")
        return g

    async def execute(self, on_event: Optional[EventCallback] = None) -> dict[str, Any]:
        """按拓扑顺序执行，返回 {node_id: output}。节点失败即终止并抛出异常。"""
        order = list(nx.topological_sort(self.dag))
        outputs: dict[str, Any] = {}

        for node_id in order:
            node = self.dag.nodes[node_id]
            await self._emit(on_event, node_id, "running", None)
            try:
                result = await self._execute_node(node_id, node, outputs)
            except Exception as exc:
                err = str(exc)
                await self._emit(on_event, node_id, "failed", {"error": err})
                raise
            outputs[node_id] = result
            await self._emit(on_event, node_id, "completed", result)

        return outputs

    async def _emit(self, on_event: Optional[EventCallback], node_id: str,
                    status: str, result: Any) -> None:
        if on_event:
            await on_event(node_id, status, result)

    async def _execute_node(self, node_id: str, node: dict[str, Any],
                            outputs: dict[str, Any]) -> Any:
        ntype = node.get("type")
        data = node.get("data") or {}
        upstream = self._upstream_outputs(node_id, outputs)

        if ntype == "input":
            return {"text": str(data.get("text", ""))}

        if ntype == "llm":
            system = self._render(data.get("system", ""), outputs) or "你是绵绣LumiWeave 平台上的 AI 助手。"
            prompt = self._render(data.get("prompt", ""), outputs)
            if not prompt and upstream:
                prompt = self._pick_str(upstream)
            if not prompt:
                raise ValueError("LLM 节点缺少 prompt")
            temperature = float(data.get("temperature", 0.3))
            max_tokens = int(data.get("max_tokens", 2048))
            from app.ai.client import chat_full
            res = await chat_full(
                system, prompt,
                temperature=temperature, max_tokens=max_tokens, scenario="canvas",
            )
            if not res.ok:
                raise RuntimeError(res.content or "LLM 调用失败")
            return {"content": res.content or ""}

        if ntype == "prompt_template":
            template = self._render(data.get("template", ""), outputs)
            query = self._render(data.get("query", ""), outputs) or self._pick_str(upstream)
            k = int(data.get("k", 3))
            learned: list[dict[str, Any]] = []
            if query:
                from app.prompt_learning import retrieve_for
                try:
                    learned = await retrieve_for(query, k)
                except Exception:
                    learned = []
            final = template
            if learned:
                kb = "\n---\n".join(
                    f"【{x.get('title', '')}】{x.get('content', '')}" for x in learned
                )
                if "{{kb}}" in final:
                    final = final.replace("{{kb}}", kb)
                else:
                    final = final + "\n\n# 知识库参考 Prompt（仅作参考，按需采用）\n" + kb
            return {"prompt": final}

        if ntype == "skill":
            skill_id = str(data.get("skill_id", "")).strip()
            if not skill_id:
                raise ValueError("Skill 节点未指定技能")
            args = data.get("args") or {}
            if not isinstance(args, dict):
                args = {"input": args}
            from app.skills import skill_manager
            sr = await skill_manager.execute(skill_id, args, {"canvas": True})
            if not sr.ok:
                raise RuntimeError(sr.result or "技能执行失败")
            return {"result": sr.result}

        if ntype == "output":
            if upstream:
                text = self._pick_str(upstream)
            else:
                text = self._render(data.get("text", ""), outputs)
            return {"content": text}

        if ntype == "render":
            # 出图/算力节点：经 dispatcher 智能路由到本地或云端 ComfyUI
            prompt = self._render(data.get("prompt", ""), outputs) or self._pick_str(upstream)
            workflow = data.get("workflow")
            if not isinstance(workflow, dict) or not workflow:
                if not prompt:
                    raise ValueError("出图节点缺少 prompt 或 workflow")
                # 极简文生图工作流：把 prompt 包成 ComfyUI 可识别的最小结构
                workflow = {"prompt": prompt, "model": data.get("model", "")}
            from app.renderers.dispatcher import dispatch_render_task
            result = await dispatch_render_task(node_id, workflow, wait=True)
            if isinstance(result, dict) and result.get("ok") is False:
                raise RuntimeError(result.get("error") or "渲染失败")
            return {"render": result}

        raise ValueError(f"未知节点类型: {ntype}")

    def _upstream_outputs(self, node_id: str, outputs: dict[str, Any]) -> dict[str, Any]:
        preds = list(self.dag.predecessors(node_id))
        return {p: outputs[p] for p in preds if p in outputs}

    @staticmethod
    def _pick_str(upstream: dict[str, Any]) -> str:
        for value in upstream.values():
            if value is None:
                continue
            if isinstance(value, dict):
                for key in ("content", "text", "prompt", "result"):
                    if value.get(key):
                        return str(value[key])
                if value.get("error"):
                    return str(value["error"])
                return str(value)
            return str(value)
        return ""

    @staticmethod
    def _render(template: str, outputs: dict[str, Any]) -> str:
        """变量注入：{{node_id}} / {{node_id.key}}。"""
        if not template:
            return ""

        def repl(m: "re.Match[str]") -> str:
            parts = m.group(1).strip().split(".")
            value: Any = outputs.get(parts[0])
            for p in parts[1:]:
                if isinstance(value, dict):
                    value = value.get(p)
                else:
                    value = None
            if value is None:
                return m.group(0)
            if isinstance(value, dict):
                for key in ("content", "text", "prompt", "result"):
                    if value.get(key):
                        return str(value[key])
                return str(value)
            return str(value)

        return re.sub(r"\{\{\s*([\w.]+)\s*\}\}", repl, template)
