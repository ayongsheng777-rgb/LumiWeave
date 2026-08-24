from __future__ import annotations

from app import db
from app.agent.adapter import LLMAgentAdapter
from app.agent.provider import AgentProviderConfig, seed_default_agents
from app.agent.registry import AgentRegistry
from app.agent.router import AgentRouter

agent_registry = AgentRegistry()
agent_router = AgentRouter()


async def init_agents() -> None:
    """从 agents 表加载已启用 Agent；为空则播种默认 Agent（default/claude/hermes/workbuddy）。"""
    rows = await db.fetch("SELECT id, name, provider, enabled FROM agents WHERE enabled=TRUE")
    if not rows:
        await seed_default_agents()
        rows = await db.fetch("SELECT id, name, provider, enabled FROM agents WHERE enabled=TRUE")
    agent_registry._adapters.clear()
    for row in rows:
        d = dict(row)
        try:
            cfg = AgentProviderConfig.from_db(d)
        except Exception:
            continue
        agent_registry.register(LLMAgentAdapter(cfg))
    agent_router.bind(agent_registry)
