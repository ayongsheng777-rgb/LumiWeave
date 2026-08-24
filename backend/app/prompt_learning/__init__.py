from __future__ import annotations

from app.prompt_learning.embedder import embedder
from app.prompt_learning.retriever import retrieve
from app.prompt_learning.store import prompt_store

__all__ = ["embedder", "prompt_store", "retrieve"]


async def retrieve_for(query: str, k: int = 5):
    """供 Agent 在运行时动态注入知识库 Prompt（spec #71，非朴素 appendSystemContext）。"""
    return await retrieve(query, k)
