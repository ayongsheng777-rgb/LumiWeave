"""Redis 缓存封装（2026-08-29 接通 Redis 真用途：读缓存）。

设计：缓存是加速不是依赖——Redis 不可用时一律静默降级（返回 None / 直接跳过写），
绝不让缓存层成为主链路单点。连接池懒加载，进程内复用。
"""
from __future__ import annotations

import json
from typing import Any

from app.config import settings

_pool: Any = None
_cache_available: bool | None = None


async def _client() -> Any | None:
    """取 Redis 客户端；不可用返回 None（不再重试，避免每次请求都吃一次连接超时）。"""
    global _pool, _cache_available
    if _cache_available is False:
        return None
    if _pool is None:
        try:
            import redis.asyncio as aioredis
            _pool = aioredis.from_url(settings.redis_url, decode_responses=True, max_connections=8)
            # 连接探活：失败即标记不可用，主链路不受影响
            await _pool.ping()
        except Exception:  # noqa: BLE001
            _cache_available = False
            return None
    return _pool


async def cache_get(key: str) -> Any | None:
    """读缓存 JSON；未命中/不可用返回 None。"""
    try:
        c = await _client()
        if c is None:
            return None
        raw = await c.get(key)
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None


async def cache_set(key: str, value: Any, ttl: int = 60) -> None:
    """写缓存 JSON（TTL 秒）；失败静默。"""
    try:
        c = await _client()
        if c is None:
            return
        await c.set(key, json.dumps(value, ensure_ascii=False, default=str), ex=ttl)
    except Exception:  # noqa: BLE001
        pass


async def cache_delete(keys: list[str]) -> None:
    """主动失效（数据变更后调用）。"""
    try:
        c = await _client()
        if c is None or not keys:
            return
        await c.delete(*keys)
    except Exception:  # noqa: BLE001
        pass
