from __future__ import annotations

import asyncio
import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator

import httpx

from app import token_usage
from app.ai.config import _is_placeholder, active_profile, available, model_profiles
from app.ai.errors import (
    AIError,
    http_status_to_error,
    network_error,
    timeout_error,
)
from app.config import settings

_SEM = asyncio.Semaphore(3)
_CACHE: dict[str, tuple[Any, float]] = {}

FORCED_TEMP = {"kimi-k3": 1.0}
REASONING_PREFIXES = ("kimi-k3", "deepseek-v4-pro", "deepseek-reasoner", "o1", "o3")

stats = {
    "calls": 0,
    "ok": 0,
    "fail": 0,
    "cached": 0,
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "last_error": "",
}


@dataclass
class ChatResult:
    content: str | None
    usage: dict | None
    ok: bool
    error: dict | None = None  # V2.1 结构化错误：{code, message, retryable, provider}


def _cache_key(model: str, system: str, user: str) -> str:
    payload = f"{model}:{system}:{user}"
    return hashlib.md5(payload.encode("utf-8")).hexdigest()


def _extract_json(text: str | None) -> dict | None:
    if not text:
        return None
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start = -1
    for i, ch in enumerate(text):
        if ch in "{[":
            start = i
            break
    if start == -1:
        return None
    end = max(text.rfind("}"), text.rfind("]"))
    if end == -1 or end < start:
        return None
    candidate = text[start:end + 1]
    try:
        return json.loads(candidate)
    except Exception:
        pass
    try:
        fixed = candidate.replace("“", "\"").replace("”", "\"").replace("‘", "'").replace("’", "'")
        return json.loads(fixed)
    except Exception:
        return None


def _pick_profile(model_profile: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if model_profile:
        return model_profile
    return active_profile()


async def _do_chat(
    system: str,
    user: str,
    *,
    model_profile: dict[str, Any] | None = None,
    temperature: float = 0.3,
    max_tokens: int = 2048,
    json_mode: bool = False,
    cache_ttl: int = 900,
    scenario: str = "general",
    task_id: str = "",
    workflow_id: str = "",
    node_id: str = "",
) -> ChatResult:
    """核心调用。返回 ChatResult（含 usage），供 Agent/Skill 透传 token 计量。

    task_id / workflow_id / node_id 用于把 Token 消耗关联到具体工作流节点（规格书 §32）。
    """
    if not settings.ai_enabled:
        return ChatResult(None, None, False, error=AIError("PROVIDER_ERROR", "AI 功能未启用").to_dict())
    profile = _pick_profile(model_profile)
    if not profile:
        stats["last_error"] = "没有可用的模型配置"
        return ChatResult(None, None, False, error=AIError("PROVIDER_ERROR", "没有可用的模型配置").to_dict())
    key = (profile.get("api_key") or "").strip()
    if not key or _is_placeholder(key):
        stats["last_error"] = "API Key 无效或缺失"
        return ChatResult(None, None, False, error=AIError("INVALID_API_KEY", "API Key 无效或缺失", provider=profile.get("provider", "")).to_dict())

    model_name = profile.get("model", settings.ai_model)
    cache_key = _cache_key(model_name, system, user)
    if cache_ttl > 0 and cache_key in _CACHE:
        value, expiry = _CACHE[cache_key]
        if time.time() < expiry:
            stats["cached"] += 1
            return ChatResult(value, None, True)

    temp = FORCED_TEMP.get(model_name, temperature)
    mtokens = max_tokens
    timeout_val = 60.0
    if any(model_name.lower().startswith(p) for p in REASONING_PREFIXES):
        mtokens = max(mtokens, 4096)
        timeout_val = max(timeout_val, 150.0)
    if json_mode:
        # JSON 结构化生成（如工作流规划）通常更慢，给更长超时
        timeout_val = max(timeout_val, 120.0)

    payload: dict[str, Any] = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temp,
        "max_tokens": mtokens,
        "stream": False,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    ua = (profile.get("user_agent") or settings.ai_user_agent or "").strip()
    if ua:
        headers["User-Agent"] = ua

    proxy = profile.get("proxy")
    if proxy is None:
        proxy = settings.ai_proxy
    proxies = proxy if proxy else None

    base_url = profile.get("base_url", settings.ai_base_url).rstrip("/")
    url = f"{base_url}/chat/completions"

    t0 = time.monotonic()
    stats["calls"] += 1
    try:
        async with _SEM:
            transport = httpx.AsyncHTTPTransport(retries=1)
            async with httpx.AsyncClient(
                proxy=proxies,
                timeout=httpx.Timeout(timeout_val, connect=20.0),
                transport=transport,
            ) as client:
                response = await client.post(url, headers=headers, json=payload)
                if response.status_code == 400 and json_mode:
                    del payload["response_format"]
                    response = await client.post(url, headers=headers, json=payload)
    except httpx.ConnectError:
        stats["fail"] += 1
        stats["last_error"] = "连接失败：境外模型需配代理，国内模型检查网络"
        await token_usage.log_usage(model_name, profile.get("provider", ""), scenario, 0, 0, False, 0)
        return ChatResult(None, None, False, error=network_error(Exception("连接失败"), profile.get("provider", "")).to_dict())
    except httpx.ConnectTimeout:
        stats["fail"] += 1
        stats["last_error"] = "连接超时：检查网络或代理"
        await token_usage.log_usage(model_name, profile.get("provider", ""), scenario, 0, 0, False, 0)
        return ChatResult(None, None, False, error=timeout_error(profile.get("provider", "")).to_dict())
    except httpx.ReadTimeout:
        stats["fail"] += 1
        stats["last_error"] = "模型响应过慢，请稍后重试"
        await token_usage.log_usage(model_name, profile.get("provider", ""), scenario, 0, 0, False, 0)
        return ChatResult(None, None, False, error=timeout_error(profile.get("provider", "")).to_dict())
    except Exception as exc:
        stats["fail"] += 1
        stats["last_error"] = f"请求异常: {exc}"
        await token_usage.log_usage(model_name, profile.get("provider", ""), scenario, 0, 0, False, 0)
        return ChatResult(None, None, False, error=network_error(exc, profile.get("provider", "")).to_dict())

    if response.status_code != 200:
        stats["fail"] += 1
        err = http_status_to_error(response.status_code, response.text, profile.get("provider", ""))
        stats["last_error"] = err.message
        await token_usage.log_usage(model_name, profile.get("provider", ""), scenario, 0, 0, False, 0)
        return ChatResult(None, None, False, error=err.to_dict())

    try:
        data = response.json()
    except Exception as exc:
        stats["fail"] += 1
        stats["last_error"] = f"解析响应失败: {exc}"
        await token_usage.log_usage(model_name, profile.get("provider", ""), scenario, 0, 0, False, 0)
        return ChatResult(None, None, False, error=AIError("INVALID_RESPONSE", "解析响应失败", provider=profile.get("provider", "")).to_dict())

    choice = data.get("choices", [{}])[0] or {}
    message = choice.get("message", {}) or {}
    content = message.get("content", "")
    if not content and message.get("reasoning_content"):
        content = message["reasoning_content"]

    usage = data.get("usage", {}) or {}
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    latency_ms = int((time.monotonic() - t0) * 1000)

    stats["ok"] += 1
    stats["prompt_tokens"] += prompt_tokens
    stats["completion_tokens"] += completion_tokens
    stats["last_error"] = ""

    asyncio.create_task(
        token_usage.log_usage(
            model_name,
            profile.get("provider", ""),
            scenario,
            prompt_tokens,
            completion_tokens,
            True,
            latency_ms,
            task_id=task_id,
            workflow_id=workflow_id,
            node_id=node_id,
        )
    )

    if cache_ttl > 0:
        _CACHE[cache_key] = (content, time.time() + cache_ttl)

    usage_out = {
        "model": model_name,
        "provider": profile.get("provider", ""),
        "scenario": scenario,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "latency_ms": latency_ms,
        "success": True,
    }
    return ChatResult(content, usage_out, True)


async def chat(
    system: str,
    user: str,
    *,
    model_profile: dict[str, Any] | None = None,
    temperature: float = 0.3,
    max_tokens: int = 2048,
    json_mode: bool = False,
    cache_ttl: int = 900,
    scenario: str = "general",
) -> str | None:
    """向后兼容：仅返回 content 字符串。"""
    return (await _do_chat(
        system, user,
        model_profile=model_profile,
        temperature=temperature,
        max_tokens=max_tokens,
        json_mode=json_mode,
        cache_ttl=cache_ttl,
        scenario=scenario,
    )).content


async def chat_full(
    system: str,
    user: str,
    *,
    model_profile: dict[str, Any] | None = None,
    temperature: float = 0.3,
    max_tokens: int = 2048,
    json_mode: bool = False,
    cache_ttl: int = 900,
    scenario: str = "general",
    task_id: str = "",
    workflow_id: str = "",
    node_id: str = "",
) -> ChatResult:
    """返回 ChatResult（含 usage），供 Agent/Skill 透传 token 计量。"""
    return await _do_chat(
        system, user,
        model_profile=model_profile,
        temperature=temperature,
        max_tokens=max_tokens,
        json_mode=json_mode,
        cache_ttl=cache_ttl,
        scenario=scenario,
        task_id=task_id,
        workflow_id=workflow_id,
        node_id=node_id,
    )


async def stream_chat(
    system: str,
    user: str,
    *,
    model_profile: dict[str, Any] | None = None,
    temperature: float = 0.3,
    max_tokens: int = 2048,
    scenario: str = "general",
) -> AsyncIterator[str]:
    """OpenAI 兼容流式输出，逐块 yield 文本。带 timeout + 错误处理。"""
    profile = _pick_profile(model_profile)
    if not profile:
        yield ""; return
    key = (profile.get("api_key") or "").strip()
    if not key or _is_placeholder(key):
        return
    model_name = profile.get("model", settings.ai_model)
    base_url = profile.get("base_url", settings.ai_base_url).rstrip("/")
    url = f"{base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "text/event-stream"}
    ua = (profile.get("user_agent") or settings.ai_user_agent or "").strip()
    if ua:
        headers["User-Agent"] = ua
    proxy = profile.get("proxy") or settings.ai_proxy or None
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    prompt_tokens = 0
    completion_tokens = 0
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(proxy=proxy, timeout=httpx.Timeout(150.0, connect=20.0)) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code != 200:
                    stats["fail"] += 1
                    stats["last_error"] = _human_error(resp.status_code, await resp.aread())
                    await token_usage.log_usage(model_name, profile.get("provider", ""), scenario, 0, 0, False, 0)
                    return
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                    except Exception:
                        continue
                    choices = chunk.get("choices") or [{}]
                    delta = (choices[0] or {}).get("delta") or {}
                    piece = delta.get("content") or ""
                    if piece:
                        completion_tokens += 1
                        yield piece
        latency_ms = int((time.monotonic() - t0) * 1000)
        stats["ok"] += 1
        asyncio.create_task(token_usage.log_usage(
            model_name, profile.get("provider", ""), scenario, prompt_tokens, completion_tokens, True, latency_ms))
    except Exception as exc:
        stats["fail"] += 1
        stats["last_error"] = f"流式异常: {exc}"
        await token_usage.log_usage(model_name, profile.get("provider", ""), scenario, 0, 0, False, 0)


async def chat_json(
    system: str,
    user: str,
    *,
    model_profile: dict[str, Any] | None = None,
    temperature: float = 0.3,
    max_tokens: int = 2048,
    cache_ttl: int = 900,
    scenario: str = "general",
) -> dict | None:
    text = await chat(
        system,
        user,
        model_profile=model_profile,
        temperature=temperature,
        max_tokens=max_tokens,
        json_mode=True,
        cache_ttl=cache_ttl,
        scenario=scenario,
    )
    return _extract_json(text)


def _human_error(status: int, body: str) -> str:
    try:
        data = json.loads(body)
        msg = data.get("error", {}).get("message", "") or str(data)
    except Exception:
        msg = body[:200]
    if status == 401:
        return "API Key 无效"
    if status == 403:
        return "无权限访问该模型"
    if status == 404:
        return "模型不存在"
    if status == 429:
        low = msg.lower()
        if "insufficient_quota" in low or "quota" in low:
            return "429 欠费/额度不足"
        return "429 请求频率过高"
    if status >= 500:
        return f"模型服务端错误 {status}"
    return f"请求失败 {status}: {msg}"


async def probe(profile_id: str | None = None) -> dict[str, Any]:
    profile = _pick_profile(None if profile_id is None else next(
        (p for p in model_profiles() if p.get("id") == profile_id), None
    ))
    if not profile:
        return {"ok": False, "reason": "未找到模型配置"}
    key = (profile.get("api_key") or "").strip()
    if not key or _is_placeholder(key):
        return {"ok": False, "reason": "API Key 无效"}
    t0 = time.monotonic()
    result = await chat(
        system="你只回复两个字：正常",
        user="测试连通",
        model_profile=profile,
        max_tokens=10,
        cache_ttl=0,
        temperature=0.3,
        scenario="probe",
    )
    latency_ms = int((time.monotonic() - t0) * 1000)
    if result is None:
        return {"ok": False, "reason": stats["last_error"] or "探测失败"}
    return {
        "ok": True,
        "model": profile.get("model"),
        "base_url": profile.get("base_url"),
        "latency_ms": latency_ms,
        "reply": result,
    }
