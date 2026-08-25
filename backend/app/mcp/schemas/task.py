"""任务状态数据模型（MCP）。"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TaskStatus(BaseModel):
    task_id: str = ""
    status: str = "queued"  # queued|running|completed|failed|cancelled|timeout
    progress: int = 0
    result: Any = None
    error: dict[str, Any] | None = None
