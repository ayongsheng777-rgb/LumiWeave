from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentRequest:
    task_id: str
    user_id: str
    message: str
    system_prompt: str | None = None
    skills: list[dict[str, Any]] | None = None
    context: dict[str, Any] | None = None
    stream: bool = False


@dataclass
class AgentResponse:
    task_id: str
    agent: str
    content: str
    tool_calls: list[dict[str, Any]] | None = None
    usage: dict[str, Any] | None = None
    finish_reason: str | None = None


@dataclass
class AgentEvent:
    type: str  # token | tool | done | error
    data: dict[str, Any] = field(default_factory=dict)
