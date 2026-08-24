"""LLM API 的统一拦截与请求网关（架构文档§三.4）。

封装一个统一出口，确保每一次调用都能被 tracker 准确记录。
底层复用现有 `app.ai.client` 的 profile/重试/缓存体系；
本模块提供「按 provider + model + messages 直调」的门面，
方便不依赖 profile 配置的临时调用（如指定 api_key 的外部调用）。
"""
from __future__ import annotations

import time
from typing import Any, Optional

import httpx

from app.token_usage.tracker import record_llm_usage

# provider -> OpenAI 兼容 chat/completions 端点
_PROVIDER_ENDPOINTS: dict[str, str] = {
    "deepseek": "https://api.deepseek.com/v1/chat/completions",
    "moonshot": "https://api.moonshot.cn/v1/chat/completions",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "openai": "https://api.openai.com/v1/chat/completions",
    "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
}


def _endpoint_for(provider: str, base_url: Optional[str]) -> str:
    if base_url:
        return f"{base_url.rstrip('/')}/chat/completions"
    if provider in _PROVIDER_ENDPOINTS:
        return _PROVIDER_ENDPOINTS[provider]
    raise ValueError(f"Unsupported provider: {provider}")


async def unified_llm_call(
    provider: str,
    model: str,
    messages: list[dict[str, str]],
    api_key: str,
    *,
    base_url: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 2048,
    timeout: float = 120.0,
) -> str:
    """统一的 LLM 调用出口，自动拦截并记录 Token。

    返回助手消息文本。任何 provider 都是 OpenAI 兼容协议。
    """
    url = _endpoint_for(provider, base_url)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    t0 = time.monotonic()
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=20.0)) as client:
        resp = await client.post(url, headers=headers, json=payload)
    latency_ms = int((time.monotonic() - t0) * 1000)

    if resp.status_code != 200:
        await record_llm_usage(provider, model, 0, 0, latency_ms=latency_ms, success=False)
        raise RuntimeError(f"LLM 调用失败 {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    usage = data.get("usage", {}) or {}
    prompt_tk = int(usage.get("prompt_tokens") or 0)
    comp_tk = int(usage.get("completion_tokens") or 0)

    # 提取 Token 消耗并记录（fire-and-forget）
    await record_llm_usage(provider, model, prompt_tk, comp_tk, latency_ms=latency_ms, success=True)

    choices = data.get("choices") or [{}]
    message = (choices[0] or {}).get("message") or {}
    content = message.get("content") or message.get("reasoning_content") or ""
    return content
