from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic_settings import BaseSettings

DATA_DIR = Path(os.environ.get("DATA_DIR", "./data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# 运行时 AI 配置覆盖层：由 /api/ai/config 保存或 auto-best 写回，
# 持久化在 app_kv（key=ai_overrides）；重启后由 lifespan 重新加载。
# 仅改模型名 / 生效 id，绝不覆盖 API Key 等敏感字段。
AI_OVERRIDES: dict[str, Any] = {"active": None, "models": {}}

# 自定义模型库：由 /api/ai/models 增删改，持久化在 app_kv（key=ai_models）。
# 在界面即可新增模型 / 改 key / 改 base_url，无需再改环境变量重启。
CUSTOM_MODELS: list[dict[str, Any]] = []


def _parse_models_json(value: str) -> list[dict[str, Any]]:
    try:
        obj = json.loads(value)
        return obj if isinstance(obj, list) else []
    except Exception:
        return []


class Settings(BaseSettings):
    database_url: str = "postgresql://lumiweave:lumiweave2026@localhost:5432/lumiweave"
    redis_url: str = "redis://localhost:6379/0"

    otp_issuer: str = "绵绣LumiWeave"
    otp_account: str = "admin@lumiweave"
    otp_secret: str = ""
    session_ttl: int = 43200
    session_secret: str = ""

    ai_enabled: bool = True
    ai_base_url: str = "https://api.deepseek.com/v1"
    ai_api_key: str = ""
    ai_model: str = "deepseek-chat"
    ai_proxy: str = ""
    ai_user_agent: str = ""
    ai_models_json: str = "[]"
    ai_active: str = "default"

    feishu_webhook_url: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"

    def model_profiles(self) -> list[dict[str, Any]]:
        profiles = _parse_models_json(self.ai_models_json)
        base = {
            "id": "default",
            "name": "默认模型",
            "base_url": self.ai_base_url,
            "model": self.ai_model,
            "api_key": self.ai_api_key,
            "proxy": self.ai_proxy,
            "user_agent": self.ai_user_agent,
            "provider": self._provider_of(self.ai_base_url),
        }
        ids = {p.get("id") for p in profiles}
        if "default" not in ids:
            profiles.insert(0, base)
        else:
            for p in profiles:
                if p.get("id") == "default":
                    p.setdefault("base_url", base["base_url"])
                    p.setdefault("model", base["model"])
                    p.setdefault("api_key", base["api_key"])
                    p.setdefault("proxy", base["proxy"])
                    p.setdefault("user_agent", base["user_agent"])
                    p.setdefault("provider", self._provider_of(p.get("base_url", self.ai_base_url)))
        for p in profiles:
            p.setdefault("provider", self._provider_of(p.get("base_url", "")))
        for p in profiles:
            if p.get("id") in AI_OVERRIDES["models"]:
                p["model"] = AI_OVERRIDES["models"][p["id"]]
        # 合并自定义模型库（界面增删改，DB 持久化）：同 id 覆盖，新 id 追加
        for cm in CUSTOM_MODELS:
            if not cm.get("id"):
                continue
            hit = next((p for p in profiles if p.get("id") == cm["id"]), None)
            if hit:
                hit.update({k: v for k, v in cm.items() if k != "id"})
                hit.setdefault("provider", self._provider_of(hit.get("base_url", "")))
            else:
                merged = dict(cm)
                merged.setdefault("provider", self._provider_of(merged.get("base_url", "")))
                profiles.append(merged)
        return profiles

    def active_ai_profile(self) -> dict[str, Any] | None:
        active_id = AI_OVERRIDES["active"] or self.ai_active
        for p in self.model_profiles():
            if p.get("id") == active_id:
                return p
        profiles = self.model_profiles()
        return profiles[0] if profiles else None

    def get_profile_by_id(self, profile_id: str) -> dict[str, Any] | None:
        for p in self.model_profiles():
            if p.get("id") == profile_id:
                return p
        return None

    @staticmethod
    def _provider_of(base_url: str) -> str:
        url = (base_url or "").lower()
        if "deepseek" in url:
            return "deepseek"
        if "dashscope" in url or "aliyun" in url:
            return "dashscope"
        if "googleapis" in url or "gemini" in url:
            return "gemini"
        if "x.ai" in url or "grok" in url:
            return "grok"
        if "openai" in url:
            return "openai"
        if "moonshot" in url or "kimi" in url:
            return "moonshot"
        if "zhipu" in url:
            return "zhipu"
        if "siliconflow" in url:
            return "siliconflow"
        if "minimax" in url:
            return "minimax"
        if "hunyuan" in url or "tencent" in url:
            return "hunyuan"
        return "custom"


settings = Settings()
