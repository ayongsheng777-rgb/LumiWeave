from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

from app import db
from app.config import settings


@dataclass
class AgentProviderConfig:
    """统一 Provider 配置（spec #7）。新增 Gemini/Qwen/DeepSeek/Ollama 不改 Agent Core。"""

    id: str
    name: str
    protocol: str  # anthropic | openai-compatible | custom-http
    model: str
    endpoint: str = ""
    api_key: str = ""
    enabled: bool = True
    base_url: str = ""

    def to_profile(self) -> dict[str, Any]:
        base = self.base_url or self.endpoint
        return {
            "id": self.id,
            "name": self.name,
            "base_url": base,
            "model": self.model,
            "api_key": self.api_key,
            "proxy": "",
            "user_agent": "",
            "provider": _provider_of(base),
        }

    @classmethod
    def from_db(cls, row: dict[str, Any]) -> "AgentProviderConfig":
        provider = row.get("provider") or {}
        if isinstance(provider, str):
            try:
                provider = json.loads(provider)
            except Exception:
                provider = {}
        return cls(
            id=row["id"],
            name=row.get("name", row["id"]),
            protocol=provider.get("protocol", "openai-compatible"),
            model=provider.get("model", ""),
            endpoint=provider.get("endpoint", ""),
            api_key=provider.get("api_key", ""),
            base_url=provider.get("base_url", ""),
            enabled=bool(row.get("enabled", True)),
        )


def _provider_of(base_url: str) -> str:
    url = (base_url or "").lower()
    for token, name in (
        ("anthropic", "anthropic"), ("deepseek", "deepseek"), ("dashscope", "dashscope"),
        ("openai", "openai"), ("moonshot", "moonshot"), ("zhipu", "zhipu"),
        ("hunyuan", "hunyuan"),
    ):
        if token in url:
            return name
    return "custom"


async def seed_default_agents() -> None:
    """首次启动播种默认 Agent（default / claude / hermes / workbuddy）。"""
    defaults = [
        {
            "id": "default", "name": "默认 Agent", "protocol": "openai-compatible",
            "model": settings.ai_model, "base_url": settings.ai_base_url,
            "api_key": settings.ai_api_key,
        },
        {
            "id": "claude", "name": "Claude", "protocol": "anthropic",
            "model": os.environ.get("CLAUDE_MODEL", "claude-3-5-sonnet-20241022"),
            "endpoint": os.environ.get("CLAUDE_ENDPOINT", "https://api.anthropic.com"),
            "api_key": os.environ.get("ANTHROPIC_API_KEY", settings.ai_api_key),
        },
        {
            "id": "hermes", "name": "Hermes", "protocol": "openai-compatible",
            "model": os.environ.get("HERMES_MODEL", "hermes-2-pro"),
            "base_url": os.environ.get("HERMES_BASE_URL", settings.ai_base_url),
            "api_key": os.environ.get("HERMES_API_KEY", settings.ai_api_key),
        },
        {
            "id": "workbuddy", "name": "Workbuddy", "protocol": "openai-compatible",
            "model": os.environ.get("WORKBUDDY_MODEL", settings.ai_model),
            "base_url": os.environ.get("WORKBUDDY_BASE_URL", settings.ai_base_url),
            "api_key": os.environ.get("WORKBUDDY_API_KEY", settings.ai_api_key),
        },
    ]
    for d in defaults:
        provider = {
            "protocol": d["protocol"], "model": d["model"],
            "endpoint": d.get("endpoint", ""), "base_url": d.get("base_url", ""),
            "api_key": d.get("api_key", ""),
        }
        await db.execute(
            """INSERT INTO agents (id, name, provider, enabled)
               VALUES ($1,$2,$3::jsonb,$4)
               ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, provider=EXCLUDED.provider""",
            d["id"], d["name"], json.dumps(provider), True,
        )
