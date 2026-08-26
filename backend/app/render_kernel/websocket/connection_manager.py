"""WebSocket ConnectionManager — 渲染任务实时推送（规格书 §6）。"""
from __future__ import annotations

import json
from fastapi import WebSocket
from typing import dict


class ConnectionManager:
    """
    管理所有 WebSocket 客户端连接。
    job_id → set[WebSocket] 映射，支持广播。
    """

    def __init__(self) -> None:
        # job_id -> set of websockets subscribed to this job
        self._subs: dict[str, set[WebSocket]] = {}
        # websocket -> set of job_ids
        self._ws_jobs: dict[WebSocket, set[str]] = {}

    async def connect(self, websocket: WebSocket, job_ids: list[str] | None = None) -> None:
        await websocket.accept()
        self._ws_jobs[websocket] = set(job_ids or [])
        for jid in self._ws_jobs[websocket]:
            self._subs.setdefault(jid, set()).add(websocket)

    def subscribe(self, websocket: WebSocket, job_id: str) -> None:
        """客户端订阅某个 job 的实时推送。"""
        self._ws_jobs.setdefault(websocket, set()).add(job_id)
        self._subs.setdefault(job_id, set()).add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        """客户端断开，清除所有订阅。"""
        for job_id in self._ws_jobs.pop(websocket, []):
            self._subs.get(job_id, set()).discard(websocket)

    async def broadcast_job(self, job_id: str, message: dict) -> None:
        """向订阅了指定 job_id 的所有客户端广播消息。"""
        sockets = self._subs.get(job_id, set())
        dead = []
        for ws in sockets:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        # 清理失效连接
        for ws in dead:
            await self.disconnect(ws)

    async def send_to(self, websocket: WebSocket, message: dict) -> None:
        """向指定 WebSocket 发送消息（用于查询接口的主动推送）。"""
        try:
            await websocket.send_json(message)
        except Exception:
            await self.disconnect(websocket)

    def active_connections(self) -> int:
        return len(self._ws_jobs)


# ── 全局单例 ───────────────────────────────────────────────────────────────────
_ws_manager = ConnectionManager()


def get_ws_manager() -> ConnectionManager:
    return _ws_manager
