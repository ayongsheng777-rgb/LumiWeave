from __future__ import annotations

import asyncio
import logging
from typing import Any

from app import db

logger = logging.getLogger(__name__)


async def log_usage(
    model: str,
    provider: str,
    scenario: str,
    prompt_tokens: int,
    completion_tokens: int,
    success: bool,
    latency_ms: int = 0,
) -> None:
    try:
        await db.execute(
            """
            INSERT INTO token_usage_log
            (model, provider, scenario, prompt_tokens, completion_tokens, success, latency_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            model,
            provider or "",
            scenario or "",
            int(prompt_tokens or 0),
            int(completion_tokens or 0),
            bool(success),
            int(latency_ms or 0),
        )
    except Exception:
        logger.exception("log_token_usage failed")


def fire_and_forget(
    model: str,
    provider: str,
    scenario: str,
    prompt_tokens: int,
    completion_tokens: int,
    success: bool,
    latency_ms: int = 0,
) -> None:
    try:
        asyncio.create_task(
            log_usage(
                model, provider, scenario, prompt_tokens, completion_tokens, success, latency_ms
            )
        )
    except Exception:
        logger.exception("fire_and_forget log failed")
