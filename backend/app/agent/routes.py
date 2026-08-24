from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.agent import agent_registry, agent_router, init_agents
from app.agent.types import AgentEvent, AgentRequest
from app.prompt_learning import retrieve_for
from app.skills import skill_manager
from app.task_service import add_event, create_task, set_result, set_status

router = APIRouter()


@router.get("")
async def list_agents():
    return {"agents": agent_registry.list()}


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
