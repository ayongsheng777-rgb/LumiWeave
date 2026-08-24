"""Provider 商业接口统一抽象（V2 Issue #006/#013）。

把 LLM / Image / Video / TTS / Embedding / Search 等商业 API 统一抽象成 Provider，
按 task_type + 质量/速度/成本偏好做评分路由，自动选商 + 故障转移。
"""
from __future__ import annotations

import json
from typing import Any

from app import db

PROVIDER_TYPES = {"llm", "image", "video", "tts", "stt", "embedding", "search", "custom"}


def _parse_json(v: Any, default: Any) -> Any:
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return default
    return v if v is not None else default


def _row_to_provider(row: Any) -> dict[str, Any]:
    d = dict(row)
    for key in ("models", "health"):
        d[key] = _parse_json(d.get(key), [] if key == "models" else {})
    return d


async def list_providers() -> list[dict[str, Any]]:
    rows = await db.fetch("SELECT * FROM providers ORDER BY type, name")
    return [_row_to_provider(r) for r in rows]


async def upsert_provider(fields: dict[str, Any]) -> dict[str, Any]:
    pid = str(fields.get("id") or "").strip()
    if not pid:
        return {"error": "id 不能为空"}
    name = str(fields.get("name", pid))
    ptype = str(fields.get("type", "llm"))
    if ptype not in PROVIDER_TYPES:
        ptype = "custom"
    await db.execute(
        """INSERT INTO providers (id, name, type, endpoint, api_key, models, status, cost_rate)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
           ON CONFLICT (id) DO UPDATE SET
             name=EXCLUDED.name, type=EXCLUDED.type, endpoint=EXCLUDED.endpoint,
             api_key=EXCLUDED.api_key, models=EXCLUDED.models, status=EXCLUDED.status,
             cost_rate=EXCLUDED.cost_rate, updated_at=NOW()""",
        pid, name, ptype,
        str(fields.get("endpoint", "")),
        str(fields.get("api_key", "")),
        json.dumps(fields.get("models") or [], ensure_ascii=False),
        str(fields.get("status", "disabled")),
        float(fields.get("cost_rate", 0) or 0),
    )
    row = await db.fetchrow("SELECT * FROM providers WHERE id=$1", pid)
    return _row_to_provider(row) if row else {"id": pid}


async def delete_provider(pid: str) -> None:
    await db.execute("DELETE FROM providers WHERE id=$1", pid)


async def set_health(pid: str, health: dict[str, Any]) -> None:
    await db.execute(
        "UPDATE providers SET health=$2::jsonb, updated_at=NOW() WHERE id=$1",
        pid, json.dumps(health, ensure_ascii=False),
    )


def _cost_score(cost_rate: float) -> float:
    """成本越低分越高（0 表示免费/未定价，给满分）。"""
    if cost_rate <= 0:
        return 1.0
    return max(0.0, 1.0 - cost_rate / 100.0)


async def route(
    task_type: str,
    *,
    quality: float = 1.0,
    speed: float = 1.0,
    cost: float = 1.0,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """按评分排序返回可用 Provider 链（首选→备用→第三）。"""
    rows = await db.fetch(
        "SELECT * FROM providers WHERE type=$1 AND status='enabled'", task_type
    )
    scored: list[tuple[float, dict[str, Any]]] = []
    for r in rows:
        d = _row_to_provider(r)
        health = d.get("health") or {}
        q = float(health.get("quality_score", 0.5) or 0.5)
        s = float(health.get("speed_score", 0.5) or 0.5)
        c = _cost_score(float(d.get("cost_rate", 0) or 0))
        score = q * quality + s * speed + c * cost
        d["_score"] = round(score, 4)
        scored.append((score, d))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [d for _, d in scored[:limit]]


async def best_provider(task_type: str, **kw: Any) -> dict[str, Any] | None:
    chain = await route(task_type, **kw)
    return chain[0] if chain else None
