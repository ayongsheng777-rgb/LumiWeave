from __future__ import annotations

from typing import Any

from app.prompt_learning.store import prompt_store


async def retrieve(query: str, k: int = 5) -> list[dict[str, Any]]:
    return await prompt_store.search(query, k)
