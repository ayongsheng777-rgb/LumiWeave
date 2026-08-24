from __future__ import annotations

from app.agent.adapter import AgentAdapter
from app.agent.types import AgentRequest, AgentResponse


class AgentRegistry:
    """强类型 Agent 注册中心（spec #6）。不使用 Map<AgentType, any>。"""

    def __init__(self) -> None:
        self._adapters: dict[str, AgentAdapter] = {}

    def register(self, adapter: AgentAdapter) -> None:
        self._adapters[adapter.id] = adapter

    def get(self, agent_id: str) -> AgentAdapter:
        adapter = self._adapters.get(agent_id)
        if not adapter:
            raise KeyError(f"Agent 未注册: {agent_id}")
        return adapter

    def safe_get(self, agent_id: str) -> AgentAdapter | None:
        return self._adapters.get(agent_id)

    def contains(self, agent_id: str) -> bool:
        return agent_id in self._adapters

    def list(self) -> list[dict[str, str]]:
        return [{"id": a.id, "name": a.name} for a in self._adapters.values()]

    def ids(self) -> list[str]:
        return list(self._adapters.keys())
