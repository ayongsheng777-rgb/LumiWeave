"""Provider 商业接口统一抽象（V2 Issue #006/#013）。

把 LLM / Image / Video / TTS / Embedding / Search 等商业 API 统一抽象成 Provider，
按 task_type + 质量/速度/成本偏好做评分路由，自动选商 + 故障转移。
"""
from __future__ import annotations

import json
import time
from typing import Any

import httpx

from app import db
from app.ai.config import mask_key

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
    # 脱敏 api_key（§19）：只返回掩码，绝不泄露明文
    raw_key = d.get("api_key") or ""
    d["api_key"] = mask_key(raw_key)
    d["has_api_key"] = bool(raw_key)
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
    incoming_key = str(fields.get("api_key") or "")
    # 前端回传掩码（**** 开头）说明用户没改 key，保留原值不覆盖
    if incoming_key.startswith("****"):
        existing = await db.fetchrow("SELECT api_key FROM providers WHERE id=$1", pid)
        incoming_key = existing["api_key"] if existing else ""
    await db.execute(
        """INSERT INTO providers (id, name, type, endpoint, api_key, models, status, cost_rate)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
           ON CONFLICT (id) DO UPDATE SET
             name=EXCLUDED.name, type=EXCLUDED.type, endpoint=EXCLUDED.endpoint,
             api_key=EXCLUDED.api_key, models=EXCLUDED.models, status=EXCLUDED.status,
             cost_rate=EXCLUDED.cost_rate, updated_at=NOW()""",
        pid, name, ptype,
        str(fields.get("endpoint", "")),
        incoming_key,
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


async def test_provider(pid: str) -> dict[str, Any]:
    """真实调用 Provider 测试链路连通：llm 发一句对话、embedding 向量化、
    其它类型做 /models 连通检查（验证 key 有效 + endpoint 可达）。"""
    row = await db.fetchrow("SELECT * FROM providers WHERE id=$1", pid)
    if not row:
        return {"ok": False, "error": "Provider 不存在"}
    d = dict(row)
    endpoint = (d.get("endpoint") or "").rstrip("/")
    key = d.get("api_key") or ""
    ptype = d.get("type", "llm")
    models = _parse_json(d.get("models"), [])
    model = models[0] if models else (d.get("model") or "")
    if not endpoint or not key:
        return {"ok": False, "error": "endpoint 或 api_key 未配置"}
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(40.0, connect=10.0)) as client:
            if ptype == "llm":
                resp = await client.post(
                    f"{endpoint}/chat/completions", headers=headers,
                    json={"model": model, "messages": [{"role": "user", "content": "你好，请只回复两个字：正常"}], "max_tokens": 10},
                )
                latency = int((time.monotonic() - t0) * 1000)
                if resp.status_code == 200:
                    data = resp.json()
                    content = (data.get("choices", [{}])[0].get("message", {}) or {}).get("content", "")
                    return {"ok": True, "type": "llm", "model": model, "latency_ms": latency, "reply": content[:50]}
                return {"ok": False, "type": "llm", "model": model, "error": f"HTTP {resp.status_code}: {resp.text[:150]}"}
            if ptype == "embedding":
                resp = await client.post(
                    f"{endpoint}/embeddings", headers=headers,
                    json={"model": model, "input": "测试"},
                )
                latency = int((time.monotonic() - t0) * 1000)
                if resp.status_code == 200:
                    data = resp.json()
                    dim = len((data.get("data", [{}])[0] or {}).get("embedding", []))
                    return {"ok": True, "type": "embedding", "model": model, "latency_ms": latency, "dim": dim}
                return {"ok": False, "type": "embedding", "model": model, "error": f"HTTP {resp.status_code}: {resp.text[:150]}"}
            # 其它类型（image/video/tts/stt/reranker 等）：检查 /models 连通 + 模型存在
            resp = await client.get(f"{endpoint}/models", headers=headers)
            latency = int((time.monotonic() - t0) * 1000)
            if resp.status_code == 200:
                return {"ok": True, "type": ptype, "model": model, "latency_ms": latency, "endpoint_reachable": True}
            return {"ok": False, "type": ptype, "model": model, "error": f"HTTP {resp.status_code}: {resp.text[:150]}"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
