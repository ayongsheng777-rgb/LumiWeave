"""本地化 Token 消耗与成本追踪（架构文档§三.3）。

文档示例用极简 SQLite，但本项目已有统一的 PostgreSQL
`token_usage_log` 表 + `app.token_usage.db.log_usage`。
为避免引入第二套存储、保持单一数据源，本模块作为
**薄封装层**：对外提供文档约定的 `record_llm_usage(...)` 接口，
内部复用现有 PG 记录逻辑。
"""
from __future__ import annotations

import logging

from app.token_usage.db import fire_and_forget, log_usage

logger = logging.getLogger(__name__)


async def record_llm_usage(
    provider: str,
    model: str,
    prompt_tk: int,
    comp_tk: int,
    *,
    scenario: str = "general",
    latency_ms: int = 0,
    success: bool = True,
    wait: bool = False,
) -> None:
    """在 LLM 客户端调用完成后记录 Token 消耗。

    默认 fire-and-forget（不阻塞主流程）；wait=True 时同步等待落库。
    """
    try:
        if wait:
            await log_usage(model, provider, scenario, prompt_tk, comp_tk, success, latency_ms)
        else:
            fire_and_forget(model, provider, scenario, prompt_tk, comp_tk, success, latency_ms)
    except Exception:  # noqa: BLE001 - 记录失败绝不能影响主调用
        logger.exception("record_llm_usage failed provider=%s model=%s", provider, model)
