"""画布工作流执行引擎（V2.1 增强版）。

把前端提交的 DAG（节点 + 连线）按拓扑排序依次执行，每个节点绑定到
平台真实的业务模块：
  - input           输入节点：透传原始需求
  - llm             大模型推理节点 -> app.ai.client.chat_full
  - prompt_template 提示词模板节点 -> app.prompt_learning.retrieve_for（知识库检索注入）
  - agent           智能体节点 -> app.agent.agent_registry（Agent Router 路由）
  - skill           技能节点 -> app.skills.skill_manager.execute
  - render          出图节点 -> app.renderers.dispatcher.dispatch_render_task
  - image/video/file 媒体节点：透传上游媒体结果
  - output          输出节点：汇总上游结果

V2.1 增强（在现有拓扑/环检测/变量注入基础上，不重写）：
  - task_id / workflow_id 贯穿
  - NodeExecutionContext / NodeResult 结构化结果
  - 节点级超时
  - 结构化错误（code + message）

节点 data 中的字符串支持变量注入：{{node_id}} 引用上游节点的输出，
{{node_id.key}} 精确取 dict 中的字段。
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import Any, Awaitable, Callable, Optional

import networkx as nx

from app.agent.types import NodeExecutionContext, NodeResult, WorkflowGraph

# 节点状态推送回调：on_event(node_id, status, result)
EventCallback = Callable[[str, str, Any], Awaitable[None]]

# 节点默认超时（秒）。ComfyUI 出图可能较慢，给足余量。
DEFAULT_NODE_TIMEOUT = 900.0


class WorkflowExecutionError(Exception):
    """结构化工作流执行错误：携带失败节点与错误码。"""

    def __init__(self, node_id: str, code: str, message: str) -> None:
        super().__init__(message)
        self.node_id = node_id
        self.code = code
        self.message = message


class WorkflowEngine:
    def __init__(self, graph: WorkflowGraph, *, node_timeout: float = DEFAULT_NODE_TIMEOUT) -> None:
        self.graph = graph
        self.node_timeout = node_timeout
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

    async def execute(
        self,
        on_event: Optional[EventCallback] = None,
        *,
        task_id: str = "",
        workflow_id: str = "",
        cancel_checker: Optional[Callable[[], bool]] = None,
    ) -> dict[str, Any]:
        """按拓扑顺序执行。

        返回结构化结果：
            {
              "node_results": {node_id: NodeResult.as_dict()},
              "outputs":       {node_id: raw_output},   # 供变量注入/前端回显
              "final_output":  raw_output,
            }
        节点失败即终止并抛出 WorkflowExecutionError（携带错误码）。
        """
        order = list(nx.topological_sort(self.dag))
        outputs: dict[str, Any] = {}
        node_results: dict[str, Any] = {}

        for node_id in order:
            if cancel_checker and cancel_checker():
                result = NodeResult.failure(node_id, "TASK_CANCELLED", "任务已取消", status="cancelled")
                node_results[node_id] = result.as_dict()
                await self._emit(on_event, node_id, "cancelled", result.as_dict())
                raise WorkflowExecutionError(node_id, "TASK_CANCELLED", "任务已取消")

            node = self.dag.nodes[node_id]
            await self._emit(on_event, node_id, "running", None)

            ctx = NodeExecutionContext(
                task_id=task_id,
                workflow_id=workflow_id,
                node_id=node_id,
                inputs=self._upstream_outputs(node_id, outputs),
                outputs=dict(outputs),
                metadata={"node_type": node.get("type"), "data": node.get("data") or {}},
            )

            t0 = time.monotonic()
            try:
                result = await asyncio.wait_for(
                    self._execute_node(node_id, node, outputs, ctx),
                    timeout=self.node_timeout,
                )
            except asyncio.TimeoutError:
                result = NodeResult.failure(
                    node_id, "NODE_TIMEOUT",
                    f"节点执行超时（>{int(self.node_timeout)}s）", status="timeout",
                )
            except WorkflowExecutionError:
                raise
            except Exception as exc:  # noqa: BLE001 - 统一转结构化错误
                # AIError 等携带标准错误码的异常，保留 code；否则用 NODE_ERROR
                code = getattr(exc, "code", None) or "NODE_ERROR"
                result = NodeResult.failure(node_id, code, str(exc))

            result.duration_ms = int((time.monotonic() - t0) * 1000)
            node_results[node_id] = result.as_dict()

            if not result.ok:
                await self._emit(on_event, node_id, result.status, result.as_dict())
                raise WorkflowExecutionError(
                    node_id,
                    (result.error or {}).get("code", "NODE_ERROR"),
                    (result.error or {}).get("message", "节点执行失败"),
                )

            outputs[node_id] = result.output
            # 结果引用：raw output 注入 task/workflow/node 标识，保证可追溯（§22）
            if isinstance(outputs[node_id], dict):
                outputs[node_id].setdefault("__meta", {
                    "task_id": task_id, "workflow_id": workflow_id, "node_id": node_id,
                })
            await self._emit(on_event, node_id, "completed", result.as_dict())

        final = self._final_output(order, outputs)
        return {"node_results": node_results, "outputs": outputs, "final_output": final}

    @staticmethod
    def _final_output(order: list[str], outputs: dict[str, Any]) -> Any:
        """取最后一个节点的输出作为最终输出。"""
        for node_id in reversed(order):
            if node_id in outputs:
                return outputs[node_id]
        return {}

    async def _emit(self, on_event: Optional[EventCallback], node_id: str,
                    status: str, result: Any) -> None:
        if on_event:
            await on_event(node_id, status, result)

    async def _execute_node(self, node_id: str, node: dict[str, Any],
                            outputs: dict[str, Any], ctx: NodeExecutionContext) -> NodeResult:
        ntype = node.get("type")
        data = node.get("data") or {}
        upstream = self._upstream_outputs(node_id, outputs)

        if ntype == "input":
            return NodeResult.success(node_id, {"text": str(data.get("text", ""))})

        if ntype == "analyze":
            # AI 剧本解析：输出结构化 JSON（characters/scenes/props/shots）
            text = self._render(data.get("text", ""), outputs) or self._pick_str(upstream)
            if not text:
                raise ValueError("剧本解析节点缺少输入文本")
            from app.ai.client import chat_json
            parsed = await chat_json(
                system=(
                    "你是专业的影视/广告剧本解析助手。根据用户提供的文本，提取结构化信息。"
                    "输出严格 JSON（不要多余文字）："
                    '{"characters":[{"id":"character_01","name":"...","description":"..."}],'
                    '"scenes":[{"id":"scene_01","name":"...","description":"..."}],'
                    '"props":[{"id":"prop_01","name":"...","description":"..."}],'
                    '"shots":[{"id":"shot_01","description":"...","camera":"...","motion":"..."}]}'
                ),
                user=text,
                temperature=0.3, max_tokens=2048, scenario="canvas_analyze",
            )
            if not parsed or not isinstance(parsed, dict):
                raise ValueError("剧本解析失败，模型未返回有效 JSON")
            return NodeResult.success(node_id, parsed)

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
            from app.ai.errors import AIError
            res = await chat_full(
                system, prompt,
                temperature=temperature, max_tokens=max_tokens, scenario="canvas",
                task_id=ctx.task_id, workflow_id=ctx.workflow_id, node_id=ctx.node_id,
            )
            if not res.ok:
                err = res.error or {}
                raise AIError(
                    err.get("code", "PROVIDER_ERROR"),
                    err.get("message") or res.content or "LLM 调用失败",
                    retryable=bool(err.get("retryable", False)),
                    provider=err.get("provider", ""),
                )
            usage = dict(res.usage or {})
            usage.setdefault("model", data.get("model", ""))
            return NodeResult.success(
                node_id, {"content": res.content or ""}, usage=usage,
            )

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
            return NodeResult.success(
                node_id, {"prompt": final},
                usage={"rag_enabled": bool(learned), "rag_hits": len(learned)},
            )

        if ntype == "agent":
            message = self._render(data.get("message", ""), outputs) or self._pick_str(upstream)
            if not message:
                raise ValueError("Agent 节点缺少 message")
            agent_id = str(data.get("agent_id", "") or "auto").strip()
            from app.agent import agent_registry, agent_router
            from app.agent.types import AgentRequest
            resolved = agent_router.resolve(agent_id, message)
            adapter = agent_registry.safe_get(resolved) or agent_registry.safe_get("default")
            if not adapter:
                raise RuntimeError("没有可用的 Agent")
            resp = await adapter.chat(AgentRequest(
                task_id=ctx.task_id or node_id, user_id="", message=message,
                system_prompt=str(data.get("system_prompt", "") or ""),
            ))
            usage = dict(resp.usage or {})
            usage.setdefault("agent", resp.agent)
            return NodeResult.success(
                node_id, {"content": resp.content or "", "agent": resp.agent}, usage=usage,
            )

        if ntype == "skill":
            skill_id = str(data.get("skill_id", "")).strip()
            if not skill_id:
                raise ValueError("Skill 节点未指定技能")
            args = data.get("args") or {}
            if not isinstance(args, dict):
                args = {"input": args}
            from app.skills import skill_manager
            sr = await skill_manager.execute(
                skill_id, args, {"canvas": True, "task_id": ctx.task_id},
            )
            if not sr.ok:
                raise RuntimeError(sr.result or "技能执行失败")
            return NodeResult.success(node_id, {"result": sr.result})

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
            result = await dispatch_render_task(ctx.task_id or node_id, workflow, wait=True)
            if isinstance(result, dict) and result.get("ok") is False:
                raise RuntimeError(result.get("error") or "渲染失败")
            return NodeResult.success(
                node_id, {"render": result},
                artifacts=self._extract_artifacts(result),
            )

        if ntype in ("image", "video", "file"):
            # 媒体节点：透传上游媒体结果，或取自身 data 中的 url/path
            media = data.get("url") or data.get("path") or data.get("src")
            if not media and upstream:
                media = self._pick_media(upstream)
            return NodeResult.success(
                node_id, {"kind": ntype, "url": media or "", "data": data},
            )

        if ntype == "output":
            if upstream:
                text = self._pick_str(upstream)
            else:
                text = self._render(data.get("text", ""), outputs)
            return NodeResult.success(node_id, {"content": text})

        raise ValueError(f"未知节点类型: {ntype}")

    @staticmethod
    def _extract_artifacts(result: Any) -> list[dict[str, Any]]:
        """从 render 结果里抽取图片/视频产物，供 Result 回写与可追溯。"""
        if not isinstance(result, dict):
            return []
        artifacts: list[dict[str, Any]] = []
        images = result.get("images") or []
        for img in images:
            if isinstance(img, dict):
                artifacts.append({
                    "kind": img.get("type", "image"),
                    "filename": img.get("filename", ""),
                    "subfolder": img.get("subfolder", ""),
                })
        return artifacts

    @staticmethod
    def _pick_media(upstream: dict[str, Any]) -> str:
        """从上游输出里找媒体 URL。"""
        for value in upstream.values():
            if not isinstance(value, dict):
                continue
            for key in ("url", "path", "src", "image", "video"):
                if value.get(key):
                    return str(value[key])
            # render 结果里的 images 列表
            render = value.get("render")
            if isinstance(render, dict):
                imgs = render.get("images") or []
                if imgs and isinstance(imgs[0], dict):
                    return str(imgs[0].get("filename", ""))
        return ""

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
