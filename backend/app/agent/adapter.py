from __future__ import annotations

import time
from abc import ABC, abstractmethod
from typing import Any, Callable, Awaitable

import httpx

from app import token_usage
from app.ai.client import chat_full, stream_chat
from app.agent.provider import AgentProviderConfig
from app.agent.types import AgentEvent, AgentRequest, AgentResponse
from app.config import settings

EventCallback = Callable[[AgentEvent], Awaitable[None]]


class AgentAdapter(ABC):
    """统一 Agent 接口（spec #5 / rule #10）。所有 Agent 必须实现。"""

    id: str = ""
    name: str = ""

    @abstractmethod
    async def chat(self, req: AgentRequest) -> AgentResponse:
        ...

    @abstractmethod
    async def stream(self, req: AgentRequest, on_event: EventCallback) -> None:
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        ...


class LLMAgentAdapter(AgentAdapter):
    """基于 LLM 的通用 Agent，支持 openai-compatible / custom-http / anthropic 三种协议。"""

    def __init__(self, cfg: AgentProviderConfig):
        self.id = cfg.id
        self.name = cfg.name
        self.cfg = cfg

    def _default_system(self) -> str:
        return (
            "你是绵绣LumiWeave 平台上的 AI 智能体。"
            "请根据用户需求给出清晰、可执行、结构化的回答。"
        )

    async def chat(self, req: AgentRequest) -> AgentResponse:
        system = req.system_prompt or self._default_system()
        if self.cfg.protocol == "anthropic":
            content, usage = await self._call_anthropic(system, req.message)
        else:
            res = await chat_full(
                system, req.message,
                model_profile=self.cfg.to_profile(),
                scenario="agent",
                temperature=0.3,
                max_tokens=2048,
            )
            content, usage = res.content, res.usage
        return AgentResponse(
            task_id=req.task_id, agent=self.id,
            content=content or "", usage=usage,
        )

    async def stream(self, req: AgentRequest, on_event: EventCallback) -> None:
        system = req.system_prompt or self._default_system()
        if self.cfg.protocol == "anthropic":
            content, _ = await self._call_anthropic(system, req.message)
            for chunk in _split_sentences(content or ""):
                await on_event(AgentEvent(type="token", data={"text": chunk}))
            await on_event(AgentEvent(type="done", data={"content": content or ""}))
            return
        try:
            async for piece in stream_chat(
                system, req.message,
                model_profile=self.cfg.to_profile(),
                scenario="agent",
            ):
                if piece:
                    await on_event(AgentEvent(type="token", data={"text": piece}))
            await on_event(AgentEvent(type="done", data={}))
        except Exception as exc:
            await on_event(AgentEvent(type="error", data={"message": str(exc)}))

    async def health_check(self) -> bool:
        if self.cfg.protocol == "anthropic":
            try:
                _, usage = await self._call_anthropic("pong", "ping", max_tokens=4)
                return bool(usage and usage.get("success"))
            except Exception:
                return False
        profile = self.cfg.to_profile()
        key = (profile.get("api_key") or "").strip()
        if not key:
            return False
        res = await chat_full(
            "reply OK", "ping", model_profile=profile,
            max_tokens=4, cache_ttl=0, scenario="agent_health",
        )
        return res.ok

    # ---- Anthropic 协议（真实 /v1/messages 调用，带 timeout + 错误处理）----
    async def _call_anthropic(self, system: str, user: str, max_tokens: int = 2048):
        key = (self.cfg.api_key or settings.ai_api_key or "").strip()
        if not key:
            return "", {"model": self.cfg.model, "success": False}
        url = (self.cfg.endpoint or "https://api.anthropic.com").rstrip("/") + "/v1/messages"
        headers = {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": self.cfg.model,
            "max_tokens": min(max_tokens, 4096),
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(150.0, connect=20.0)) as client:
                resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code != 200:
                await token_usage.log_usage(self.cfg.model, "anthropic", "agent", 0, 0, False, 0)
                return "", {"model": self.cfg.model, "success": False, "status": resp.status_code}
            data = resp.json()
            text = "".join(b.get("text", "") for b in data.get("content", []) if isinstance(b, dict))
            u = data.get("usage", {}) or {}
            latency_ms = int((time.monotonic() - t0) * 1000)
            await token_usage.log_usage(
                self.cfg.model, "anthropic", "agent",
                int(u.get("input_tokens", 0)), int(u.get("output_tokens", 0)), True, latency_ms,
            )
            return text, {
                "model": self.cfg.model, "provider": "anthropic",
                "scenario": "agent",
                "prompt_tokens": int(u.get("input_tokens", 0)),
                "completion_tokens": int(u.get("output_tokens", 0)),
                "latency_ms": latency_ms, "success": True,
            }
        except Exception:
            await token_usage.log_usage(self.cfg.model, "anthropic", "agent", 0, 0, False, 0)
            return "", {"model": self.cfg.model, "success": False}


def _split_sentences(text: str, size: int = 24):
    for i in range(0, len(text), size):
        yield text[i:i + size]
