"""AI 调用统一错误码与异常（规格书 §20）。

所有 AI Provider 的错误都收敛到这里的标准错误码，禁止只抛裸字符串。
错误码：
    INVALID_API_KEY   密钥无效
    MODEL_NOT_FOUND   模型不存在
    RATE_LIMIT        限流/配额不足
    TIMEOUT           超时
    PROVIDER_ERROR    Provider 侧错误（5xx 等）
    NETWORK_ERROR     网络错误
    INVALID_RESPONSE  响应解析失败
"""
from __future__ import annotations

from typing import Any

INVALID_API_KEY = "INVALID_API_KEY"
MODEL_NOT_FOUND = "MODEL_NOT_FOUND"
RATE_LIMIT = "RATE_LIMIT"
TIMEOUT = "TIMEOUT"
PROVIDER_ERROR = "PROVIDER_ERROR"
NETWORK_ERROR = "NETWORK_ERROR"
INVALID_RESPONSE = "INVALID_RESPONSE"


class AIError(Exception):
    """结构化 AI 错误：携带标准错误码 + 是否可重试 + provider。"""

    def __init__(self, code: str, message: str, *, retryable: bool = False,
                 provider: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.provider = provider

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "provider": self.provider,
        }


def http_status_to_error(status: int, body: str, provider: str = "") -> AIError:
    """把 HTTP 状态码映射为标准 AIError。"""
    msg = _extract_message(body)
    if status == 401:
        return AIError(INVALID_API_KEY, "API Key 无效", retryable=False, provider=provider)
    if status == 403:
        return AIError(INVALID_API_KEY, "无权限访问该模型", retryable=False, provider=provider)
    if status == 404:
        return AIError(MODEL_NOT_FOUND, "模型不存在", retryable=False, provider=provider)
    if status == 429:
        low = msg.lower()
        if "insufficient_quota" in low or "quota" in low:
            return AIError(RATE_LIMIT, "欠费/额度不足", retryable=False, provider=provider)
        return AIError(RATE_LIMIT, "请求频率过高", retryable=True, provider=provider)
    if status >= 500:
        return AIError(PROVIDER_ERROR, f"模型服务端错误 {status}", retryable=True, provider=provider)
    return AIError(PROVIDER_ERROR, f"请求失败 {status}: {msg}", retryable=False, provider=provider)


def network_error(exc: Exception, provider: str = "") -> AIError:
    return AIError(NETWORK_ERROR, f"网络错误: {exc}", retryable=True, provider=provider)


def timeout_error(provider: str = "") -> AIError:
    return AIError(TIMEOUT, "请求超时", retryable=True, provider=provider)


def _extract_message(body: str) -> str:
    import json
    try:
        data = json.loads(body)
        return data.get("error", {}).get("message", "") or str(data)
    except Exception:
        return body[:200]
