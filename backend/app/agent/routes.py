from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app import db
from app.agent import agent_registry, agent_router, init_agents
from app.agent.types import AgentEvent, AgentRequest
from app.prompt_learning import retrieve_for
from app.skills import skill_manager
from app.task_service import add_event, create_task, set_result, set_status

router = APIRouter()


async def _maybe_run_tools(adapter: Any, message: str) -> str | None:
    """若 Agent 配置了工具，用 LLM 判断是否需要调用、调哪个，执行后返回结果文本。"""
    tools = getattr(adapter.cfg, "tools", []) or []
    if not tools:
        return None
    from app.agent.tools import list_tools, run_tool
    from app.ai.client import chat_json

    available = [t for t in list_tools() if t["id"] in tools]
    if not available:
        return None
    tool_desc = "\n".join(f"- {t['id']}: {t['name']} - {t['description']}" for t in available)
    decision = await chat_json(
        system=(
            "你是工具调度器。根据用户消息判断是否需要调用工具。可用工具：\n"
            f"{tool_desc}\n"
            "输出严格 JSON：{\"use_tool\": bool, \"tool\": \"工具id或空字符串\", \"args\": {...}}。"
            "用户问题若需要搜索、查资料、调用接口、读网页、查知识库，就 use_tool=true 并给出 tool 和 args；"
            "否则 use_tool=false 且 tool 为空字符串。"
        ),
        user=message,
        temperature=0.1,
        max_tokens=500,
        scenario="agent_tool",
    )
    if not decision or not decision.get("use_tool"):
        return None
    tool_id = str(decision.get("tool") or "")
    if tool_id not in tools:
        return None
    result = await run_tool(tool_id, decision.get("args") or {})
    return f"工具【{tool_id}】执行结果：\n{result}"


@router.get("")
async def list_agents():
    """返回完整可配置字段（api_key 脱敏），供前端管理表单回填。"""
    rows = await db.fetch("SELECT id, name, provider, enabled, tools FROM agents ORDER BY id")
    out = []
    for r in rows:
        d = dict(r)
        provider = d.get("provider") or {}
        if isinstance(provider, str):
            try:
                provider = json.loads(provider)
            except Exception:
                provider = {}
        tools = d.get("tools") or []
        if isinstance(tools, str):
            try:
                tools = json.loads(tools)
            except Exception:
                tools = []
        key = str((provider or {}).get("api_key", "") or "")
        out.append({
            "id": d["id"], "name": d["name"], "enabled": bool(d.get("enabled", True)),
            "protocol": (provider or {}).get("protocol", "openai-compatible"),
            "model": (provider or {}).get("model", ""),
            "endpoint": (provider or {}).get("endpoint", ""),
            "base_url": (provider or {}).get("base_url", ""),
            "api_key": ("****" + key[-4:]) if key else "",
            "has_api_key": bool(key),
            "tools": list(tools or []),
        })
    return {"agents": out}


@router.get("/{agent_id}/health")
async def agent_health(agent_id: str):
    adapter = agent_registry.safe_get(agent_id)
    if not adapter:
        return JSONResponse(status_code=404, content={"error": "Agent 未注册"})
    return {"id": agent_id, "healthy": await adapter.health_check()}


@router.post("/reload")
async def reload_agents():
    await init_agents()
    return {"ok": True, "agents": agent_registry.list()}


@router.post("/chat")
async def agent_chat(request: Request):
    data = await request.json()
    message = (data.get("message") or "").strip()
    if not message:
        return JSONResponse(status_code=400, content={"error": "message 不能为空"})
    agent_id = data.get("agent_id") or "auto"
    canvas_id = data.get("canvas_id", "")
    skill_id = data.get("skill_id")
    system_prompt = data.get("system_prompt")
    user_id = data.get("user_id", "")

    resolved = agent_router.resolve(agent_id, message)
    adapter = agent_registry.safe_get(resolved) or agent_registry.safe_get("default")
    if not adapter:
        return JSONResponse(status_code=503, content={"error": "没有可用的 Agent"})

    tid = await create_task(
        user_id=user_id, canvas_id=canvas_id,
        agent_id=adapter.id, skill_id=skill_id or "",
    )
    await add_event(tid, "agent_resolved", {"agent": adapter.id, "requested": agent_id})

    # 真实 Skill 调用（spec #14）：若指定 skill_id，则先执行平台 Skill，再注入上下文
    skill_context: str | None = None
    if skill_id:
        try:
            skill_result = await skill_manager.execute(
                skill_id, {"task_id": tid, "message": message, "user_id": user_id},
                {"task_id": tid, "user_id": user_id},
            )
            await add_event(tid, "skill_executed",
                            {"skill": skill_id, "ok": bool(skill_result.ok)})
            if skill_result.ok:
                skill_context = skill_result.result
        except Exception as exc:  # 高风险能力默认关闭 / 缺失 -> 不阻断主流程
            await add_event(tid, "skill_error", {"skill": skill_id, "error": str(exc)})

    if skill_context:
        system_prompt = (system_prompt or "") + "\n\n# 平台 Skill 指引\n" + str(skill_context)

    # 动态注入知识库 Prompt（spec #71：检索后注入，而非朴素 appendSystemContext）
    if data.get("learn_prompt"):
        try:
            learned = await retrieve_for(message, k=3)
            if learned:
                kb = "\n\n# 知识库参考 Prompt（仅作参考，按需采用）\n" + "\n---\n".join(
                    f"【{x['title']}】{x['content']}" for x in learned
                )
                system_prompt = (system_prompt or "") + kb
                await add_event(tid, "prompt_learned", {"hits": len(learned)})
        except Exception as exc:
            await add_event(tid, "prompt_learn_error", {"error": str(exc)})

    await set_status(tid, "running")

    # 工具调用：若 Agent 配置了工具，先判断+执行，把结果注入系统提示词
    try:
        tool_result = await _maybe_run_tools(adapter, message)
        if tool_result:
            system_prompt = (system_prompt or "") + "\n\n# 工具执行结果（请基于这些真实信息回答，并注明信息来源）\n" + tool_result
            await add_event(tid, "tool_used", {"result_preview": tool_result[:200]})
    except Exception as exc:
        await add_event(tid, "tool_error", {"error": str(exc)})

    req = AgentRequest(
        task_id=tid, user_id=user_id, message=message, system_prompt=system_prompt,
    )
    resp = await adapter.chat(req)
    await set_status(tid, "completed")
    await set_result(tid, resp.content, {"usage": resp.usage, "agent": resp.agent})
    await add_event(tid, "agent_done", {"usage": resp.usage})
    return {
        "task_id": tid, "agent": resp.agent,
        "content": resp.content, "usage": resp.usage,
    }


@router.post("/chat/stream")
async def agent_chat_stream(request: Request):
    data = await request.json()
    message = (data.get("message") or "").strip()
    if not message:
        return JSONResponse(status_code=400, content={"error": "message 不能为空"})
    resolved = agent_router.resolve(data.get("agent_id") or "auto", message)
    adapter = agent_registry.safe_get(resolved) or agent_registry.safe_get("default")
    if not adapter:
        return JSONResponse(status_code=503, content={"error": "没有可用的 Agent"})

    tid = await create_task(
        user_id=data.get("user_id", ""), canvas_id=data.get("canvas_id", ""),
        agent_id=adapter.id, skill_id=data.get("skill_id") or "",
    )
    req = AgentRequest(
        task_id=tid, user_id=data.get("user_id", ""),
        message=message, system_prompt=data.get("system_prompt"), stream=True,
    )
    queue: asyncio.Queue[Any] = asyncio.Queue()

    async def on_event(e: AgentEvent) -> None:
        await queue.put(e)

    async def run() -> None:
        try:
            await adapter.stream(req, on_event)
        finally:
            await queue.put(None)

    asyncio.create_task(run())

    async def gen():
        while True:
            e = await queue.get()
            if e is None:
                break
            yield f"data: {json.dumps({'type': e.type, 'data': e.data}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'type': 'task', 'data': {'task_id': tid}}, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


# ==================== 工具库 ====================

@router.get("/tools")
async def list_agent_tools():
    from app.agent.tools import list_tools, search_config
    return {"tools": list_tools(), "search_config": await search_config()}


@router.post("/tools")
async def save_agent_tools(request: Request):
    from app.agent.tools import save_search_config
    data = await request.json() or {}
    cfg = data.get("search_config") or {}
    await save_search_config(cfg)
    return {"ok": True}


# ==================== Agent 增删 ====================

@router.post("")
async def upsert_agent(request: Request):
    """新增/更新 Agent（含可调用工具 tools 配置），改完立即重载生效。"""
    data = await request.json() or {}
    aid = str(data.get("id") or "").strip()
    if not aid:
        return JSONResponse(status_code=400, content={"error": "id 必填"})
    provider = {
        "protocol": str(data.get("protocol") or "openai-compatible"),
        "model": str(data.get("model") or ""),
        "endpoint": str(data.get("endpoint") or ""),
        "base_url": str(data.get("base_url") or ""),
        "api_key": str(data.get("api_key") or ""),
    }
    # 前端回传掩码（**** 开头）说明用户没改 key，保留原值
    if provider["api_key"].startswith("****"):
        existing = await db.fetchrow("SELECT provider FROM agents WHERE id=$1", aid)
        if existing:
            try:
                old = json.loads(existing["provider"]) if isinstance(existing["provider"], str) else existing["provider"]
                provider["api_key"] = (old or {}).get("api_key", "")
            except Exception:
                pass
    await db.execute(
        """INSERT INTO agents (id, name, provider, enabled, tools)
           VALUES ($1,$2,$3::jsonb,$4,$5::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             name=EXCLUDED.name, provider=EXCLUDED.provider, enabled=EXCLUDED.enabled, tools=EXCLUDED.tools""",
        aid, str(data.get("name") or aid), json.dumps(provider, ensure_ascii=False),
        bool(data.get("enabled", True)), json.dumps(data.get("tools") or [], ensure_ascii=False),
    )
    await init_agents()
    return {"ok": True, "agents": agent_registry.list()}


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str):
    await db.execute("DELETE FROM agents WHERE id=$1", agent_id)
    await init_agents()
    return {"ok": True, "agents": agent_registry.list()}


# ==================== Agent 暴露成 API（外部调用） ====================

@router.post("/{agent_id}/invoke")
async def agent_invoke(agent_id: str, request: Request):
    """把 Agent 暴露成可调用的 HTTP 接口（供外部系统/脚本调用）。"""
    adapter = agent_registry.safe_get(agent_id)
    if not adapter:
        return JSONResponse(status_code=404, content={"error": "Agent 未注册"})
    data = await request.json() or {}
    message = str(data.get("message") or "").strip()
    if not message:
        return JSONResponse(status_code=400, content={"error": "message 不能为空"})
    system_prompt = data.get("system_prompt")
    # 支持工具调用
    try:
        tool_result = await _maybe_run_tools(adapter, message)
        if tool_result:
            system_prompt = (system_prompt or "") + "\n\n# 工具执行结果\n" + tool_result
    except Exception:
        pass
    req = AgentRequest(
        task_id="invoke_" + agent_id, user_id=str(data.get("user_id", "")),
        message=message, system_prompt=system_prompt,
    )
    resp = await adapter.chat(req)
    return {"agent": resp.agent, "content": resp.content, "usage": resp.usage}
