from __future__ import annotations

import hashlib
import math
import os
import re

import httpx

EMBED_DIM = 256


class Embedder:
    """Embedder：配置了 EMBEDDING_BASE_URL+KEY 走语义向量（openai 兼容 /embeddings），
    否则降级为本地确定性哈希向量（可工作、可复现，零依赖）。"""

    def __init__(self) -> None:
        self.base_url = os.environ.get("EMBEDDING_BASE_URL", "")
        self.api_key = os.environ.get("EMBEDDING_API_KEY", "")
        self.model = os.environ.get("EMBEDDING_MODEL", "text-embedding-v3")
        self.semantic = bool(self.base_url and self.api_key)

    async def embed(self, text: str) -> list[float]:
        if self.semantic:
            return await self._embed_remote(text)
        return self._embed_local(text)

    async def _embed_remote(self, text: str) -> list[float]:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
                resp = await client.post(
                    self.base_url.rstrip("/") + "/embeddings",
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    json={"model": self.model, "input": text},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return list(data["data"][0]["embedding"])
        except Exception:
            pass
        return self._embed_local(text)

    def _embed_local(self, text: str) -> list[float]:
        vec = [0.0] * EMBED_DIM
        toks = re.findall(r"\w+", (text or "").lower())
        if not toks:
            toks = list(text or "")
        for t in toks:
            h = int(hashlib.md5(t.encode("utf-8")).hexdigest(), 16)
            vec[h % EMBED_DIM] += 1.0
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


# 全局单例：供 store / source / routes / agent 复用
embedder = Embedder()
