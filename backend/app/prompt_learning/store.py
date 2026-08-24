from __future__ import annotations

import json
import uuid
from typing import Any

from app import db
from app.prompt_learning.embedder import cosine, embedder


class PromptStore:
    async def add_source(self, kind: str, uri: str, status: str = "pending") -> str:
        sid = "src_" + uuid.uuid4().hex[:16]
        await db.execute(
            """INSERT INTO prompt_sources (id, kind, uri, status, last_sync)
               VALUES ($1,$2,$3,$4,NOW())""",
            sid, kind, uri, status,
        )
        return sid

    async def sources(self) -> list[dict[str, Any]]:
        return [dict(r) for r in await db.fetch("SELECT * FROM prompt_sources ORDER BY last_sync DESC NULLS LAST")]

    async def add_knowledge(self, source: str, title: str, content: str, embedding: list[float]) -> str:
        kid = "pk_" + uuid.uuid4().hex[:16]
        await db.execute(
            """INSERT INTO prompt_knowledge (id, source, title, content, embedding)
               VALUES ($1,$2,$3,$4,$5::float8[])""",
            kid, source, title, content, embedding,
        )
        return kid

    async def all(self) -> list[dict[str, Any]]:
        return [dict(r) for r in await db.fetch("SELECT * FROM prompt_knowledge ORDER BY created_at DESC")]

    async def count(self) -> int:
        row = await db.fetchrow("SELECT COUNT(*) AS c FROM prompt_knowledge")
        return int(row["c"]) if row else 0

    async def search(self, query: str, k: int = 5) -> list[dict[str, Any]]:
        qvec = await embedder.embed(query)
        rows = await self.all()
        scored = []
        for r in rows:
            emb = list(r.get("embedding") or [])
            if not emb:
                continue
            scored.append((cosine(qvec, emb), r))
        scored.sort(key=lambda x: -x[0])
        return [
            {"title": r["title"], "content": r["content"], "score": round(score, 4)}
            for score, r in scored[:k]
        ]


prompt_store = PromptStore()
