"""Redis 任务队列（2026-08-29 接通 Redis 真用途：可靠异步任务）。

替代原 `asyncio.create_task`（进程内存态，backend 重启即丢）：
  - 任务以 JSON 入 Redis List（LPUSH），常驻 worker BRPOP 消费
  - 后端重启后任务仍在队列里，重启即继续执行（不丢任务）
  - worker 在 lifespan 启动/停止；消费失败的任务打回队列尾部重试（最多 3 次）

队列 payload：
  {"kind": "action" | "batch" | "director", ...业务字段}
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

QUEUE_KEY = "lw:task_queue"
_DEAD_KEY = "lw:task_queue:dead"
MAX_RETRY = 3

_pool: Any = None


async def _client() -> Any | None:
    global _pool
    if _pool is None:
        try:
            import redis.asyncio as aioredis
            _pool = aioredis.from_url(settings.redis_url, decode_responses=True, max_connections=4)
        except Exception:  # noqa: BLE001
            return None
    return _pool


async def enqueue(kind: str, **payload: Any) -> bool:
    """任务入队。Redis 不可用时降级为进程内 create_task（保证功能不丢）。"""
    try:
        c = await _client()
        if c is None:
            raise RuntimeError("redis unavailable")
        await c.lpush(QUEUE_KEY, json.dumps({"kind": kind, **payload}, ensure_ascii=False))
        return True
    except Exception:  # noqa: BLE001
        logger.warning("Redis 不可用，任务降级为进程内执行: %s/%s", kind, payload.get("tid", ""))
        await _run_local(kind, payload)
        return False


async def _run_local(kind: str, payload: dict) -> None:
    """降级路径：直接在当前进程执行（原 create_task 行为）。"""
    import asyncio
    from app.scene.actions.dispatch import _run_batch_async, _run_action_task
    if kind == "action":
        asyncio.create_task(_run_action_task(payload["scene_id"], payload["action"],
                                             payload.get("object_ids"), payload.get("params") or {}, payload["tid"]))
    elif kind == "batch":
        asyncio.create_task(_run_batch_async(payload["scene_id"], payload.get("object_ids"), payload.get("params") or {}, payload["tid"]))
    elif kind == "director":
        from app.director.orchestrator import run_director
        asyncio.create_task(run_director(payload["tid"], payload["scene_id"], payload.get("story_id") or "", payload.get("opts") or {}))


async def worker_loop(stop_event: Any = None) -> None:
    """常驻消费者：BRPOP 取任务 → 按 kind 分发 → 失败重试/进死信。

    stop_event: asyncio.Event，置位后优雅退出（BRPOP timeout=1 轮询可中断）。
    """
    from app import db
    await db.get_pool()
    c = await _client()
    while not (stop_event and stop_event.is_set()):
        try:
            if c is None:
                c = await _client()
            if c is None:
                await asyncio_sleep(1.0)
                continue
            _, raw = await c.brpop(QUEUE_KEY, timeout=1)
            if not raw:
                continue
            item = json.loads(raw)
            tid = item.get("tid") or ""
            try:
                await _dispatch(item)
            except Exception as exc:  # noqa: BLE001
                logger.error("任务消费失败 %s: %s", tid, exc)
                retry = int(item.get("retry", 0)) + 1
                if retry <= MAX_RETRY:
                    item["retry"] = retry
                    await c.rpush(QUEUE_KEY, json.dumps(item, ensure_ascii=False))
                else:
                    await c.rpush(_DEAD_KEY, json.dumps(item, ensure_ascii=False))
        except Exception:  # noqa: BLE001
            await asyncio_sleep(1.0)


async def asyncio_sleep(sec: float) -> None:
    import asyncio
    await asyncio.sleep(sec)


async def _dispatch(item: dict) -> None:
    kind = item.get("kind")
    if kind == "action":
        from app.scene.actions.dispatch import _run_action_task
        await _run_action_task(item["scene_id"], item["action"], item.get("object_ids"), item.get("params") or {}, item["tid"])
    elif kind == "batch":
        from app.scene.actions.dispatch import _run_batch_async
        await _run_batch_async(item["scene_id"], item.get("object_ids"), item.get("params") or {}, item["tid"])
    elif kind == "director":
        from app.director.orchestrator import run_director
        await run_director(item["tid"], item["scene_id"], item.get("story_id") or "", item.get("opts") or {})
    else:
        logger.error("未知队列任务 kind=%s", kind)
