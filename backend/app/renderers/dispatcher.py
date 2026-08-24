"""异构算力路由与轻量级队列（架构文档§三.2）。

不再使用 Celery。对于单用户的个人生产环境，利用 FastAPI 生命周期内的
`asyncio.Queue` 配合后台常驻任务（Background Worker）即可解决本地算力排队。

路由策略：
- 大显存需求（flux / wan2.2 / sora / video）→ 直接走云端实例，不排队
- 其余基础生图 → 扔进本地单卡缓冲队列，由 local_worker 串行消费，防止爆显存

本地/云端节点来自现有 renderer 注册表（id 含 "local" 视为本地，
含 "cloud" 视为云端），也可用环境变量 LOCAL_COMFY_URL / CLOUD_COMFY_URL 兜底。
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

# 针对本地单卡建立的小型缓冲队列，防止本地爆显存
local_task_queue: "asyncio.Queue[dict[str, Any]]" = asyncio.Queue(maxsize=10)

LOCAL_COMFY_URL = os.environ.get("LOCAL_COMFY_URL", "http://127.0.0.1:8188")
CLOUD_COMFY_URL = os.environ.get("CLOUD_COMFY_URL", "")

# 大显存 / 视频类关键词：命中即走云端
_CLOUD_KEYWORDS = ("flux", "wan2.2", "sora", "video")

_worker_task: Optional[asyncio.Task] = None


async def execute_comfyui_task(prompt_json: dict[str, Any], url: str) -> dict[str, Any]:
    """通用的 ComfyUI API 触发器。"""
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=15.0)) as client:
        response = await client.post(f"{url.rstrip('/')}/prompt", json={"prompt": prompt_json})
        return response.json()


def _pick_renderer(cloud: bool):
    """从注册表里挑一个本地/云端渲染器（按 id 命名约定）。"""
    from app.renderers import renderer_registry

    tag = "cloud" if cloud else "local"
    for r in renderer_registry._renderers.values():
        if r.cfg.enabled and tag in r.cfg.id.lower():
            return r
    return None


async def local_worker() -> None:
    """本地节点常驻消费者：从队列取任务，串行提交到本地 ComfyUI。"""
    logger.info("[dispatcher] local_worker started")
    while True:
        task_data = await local_task_queue.get()
        tid = task_data.get("task_id", "?")
        try:
            renderer = _pick_renderer(cloud=False)
            if renderer is not None:
                logger.info("[dispatcher] executing local task %s via %s", tid, renderer.cfg.id)
                result = await renderer.generate(task_data["prompt_json"])
            else:
                logger.info("[dispatcher] executing local task %s via %s", tid, LOCAL_COMFY_URL)
                result = await execute_comfyui_task(task_data["prompt_json"], LOCAL_COMFY_URL)
            task_data["result"] = result
            task_data["ok"] = True
        except Exception as exc:  # noqa: BLE001 - 消费者必须兜底，不能让 worker 死掉
            logger.exception("[dispatcher] local task %s failed", tid)
            task_data["result"] = {"ok": False, "error": str(exc)}
            task_data["ok"] = False
        finally:
            task_data["done_at"] = time.time()
            ev = task_data.get("done_event")
            if ev is not None:
                ev.set()
            local_task_queue.task_done()


def start_local_worker() -> None:
    """在 FastAPI lifespan 启动时挂载 local_worker（幂等）。"""
    global _worker_task
    if _worker_task is None or _worker_task.done():
        _worker_task = asyncio.create_task(local_worker())
        logger.info("[dispatcher] local_worker task created")


async def stop_local_worker() -> None:
    """关闭时取消常驻 worker。"""
    global _worker_task
    if _worker_task is not None and not _worker_task.done():
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
    _worker_task = None


def needs_cloud(comfy_prompt: dict[str, Any]) -> bool:
    """根据工作流内容判断是否必须走云端大显存实例。"""
    workflow_str = str(comfy_prompt).lower()
    return any(k in workflow_str for k in _CLOUD_KEYWORDS)


async def dispatch_render_task(
    task_id: str,
    comfy_prompt: dict[str, Any],
    *,
    wait: bool = True,
) -> dict[str, Any]:
    """智能算力路由：根据节点参数动态决定去云端还是留本地。

    wait=True 时等待本次任务出结果（用于工作流内同步取图）；
    wait=False 仅入队立即返回（用于纯排队场景）。
    """
    if needs_cloud(comfy_prompt):
        logger.info("[dispatcher] task %s routed to CLOUD", task_id)
        renderer = _pick_renderer(cloud=True)
        if renderer is not None:
            return await renderer.generate(comfy_prompt)
        if not CLOUD_COMFY_URL:
            return {"ok": False, "error": "未配置云端 ComfyUI（CLOUD_COMFY_URL 或 comfy-cloud 渲染器）"}
        # 云端性能强，直接发起请求，无需经过本地单线队列
        return await execute_comfyui_task(comfy_prompt, CLOUD_COMFY_URL)

    logger.info("[dispatcher] task %s routed to LOCAL queue (size=%d)", task_id, local_task_queue.qsize())
    done_event = asyncio.Event()
    task_data: dict[str, Any] = {
        "task_id": task_id,
        "prompt_json": comfy_prompt,
        "done_event": done_event,
        "queued_at": time.time(),
    }
    await local_task_queue.put(task_data)
    if not wait:
        return {"ok": True, "queued": True, "queue_size": local_task_queue.qsize()}
    await done_event.wait()
    return task_data.get("result") or {"ok": False, "error": "本地任务无结果"}


def queue_status() -> dict[str, Any]:
    """队列与路由状态（供前端/调试查看）。"""
    return {
        "queue_size": local_task_queue.qsize(),
        "queue_max": local_task_queue.maxsize,
        "worker_running": _worker_task is not None and not _worker_task.done(),
        "local_url": LOCAL_COMFY_URL,
        "cloud_url": CLOUD_COMFY_URL or None,
    }
