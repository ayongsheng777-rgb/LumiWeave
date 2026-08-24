from __future__ import annotations

import os
from contextlib import asynccontextmanager

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None or _pool.is_closing():
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=2,
            max_size=10,
            command_timeout=60,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool and not _pool.is_closing():
        await _pool.close()
        _pool = None


@asynccontextmanager
async def acquire():
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn


async def execute(query: str, *args) -> str:
    async with acquire() as conn:
        return await conn.execute(query, *args)


async def fetch(query: str, *args) -> list[asyncpg.Record]:
    async with acquire() as conn:
        return await conn.fetch(query, *args)


async def fetchrow(query: str, *args) -> asyncpg.Record | None:
    async with acquire() as conn:
        return await conn.fetchrow(query, *args)
