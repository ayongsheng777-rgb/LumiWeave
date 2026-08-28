from __future__ import annotations

from decimal import Decimal
from typing import Any

from app import db
from app.config import settings

OFFICIAL_PRICING: dict[tuple[str, str], tuple[Decimal, Decimal]] = {
    ("dashscope", "qwen3.7-flash"): (Decimal("0.4"), Decimal("1.2")),
    ("dashscope", "qwen3.7-plus"): (Decimal("2.0"), Decimal("6.0")),
    ("dashscope", "qwen3.7-max"): (Decimal("8.0"), Decimal("24.0")),
    ("deepseek", "deepseek-chat"): (Decimal("1.0"), Decimal("2.0")),
    ("deepseek", "deepseek-reasoner"): (Decimal("2.0"), Decimal("8.0")),
    ("deepseek", "deepseek-v4-flash"): (Decimal("0.5"), Decimal("1.0")),
    ("deepseek", "deepseek-v4-pro"): (Decimal("2.0"), Decimal("8.0")),
    ("openai", "gpt-3.5-turbo"): (Decimal("3.0"), Decimal("6.0")),
    ("openai", "gpt-4o"): (Decimal("30.0"), Decimal("60.0")),
}


def provider_of(base_url: str) -> str:
    return settings._provider_of(base_url)


async def sync_pricing(models: list[dict[str, Any]]) -> dict[str, int]:
    seen: set[tuple[str, str]] = set()
    added = official = pending = 0
    for m in models:
        model = (m.get("model") or "").strip()
        if not model:
            continue
        provider = provider_of(m.get("base_url") or "")
        seen.add((model, provider))
        kb = OFFICIAL_PRICING.get((provider, model)) or OFFICIAL_PRICING.get(("", model))
        if kb:
            await upsert_pricing(
                {
                    "model": model,
                    "provider": provider,
                    "input_per_million": kb[0],
                    "output_per_million": kb[1],
                    "source": "official",
                    "note": "官方价自动预填，可改",
                },
                only_if_absent=True,
            )
            added += 1
            official += 1
        else:
            existed = await fetch_pricing(model=model, provider=provider)
            if not existed:
                await upsert_pricing(
                    {
                        "model": model,
                        "provider": provider,
                        "input_per_million": Decimal("0"),
                        "output_per_million": Decimal("0"),
                        "source": "pending",
                        "note": "中转站待手动录入计费",
                    },
                    only_if_absent=True,
                )
                added += 1
                pending += 1

    deactivated = await deactivate_absent(seen)
    return {"added": added, "official": official, "pending": pending, "deactivated": deactivated}


async def upsert_pricing(item: dict[str, Any], only_if_absent: bool = False) -> bool:
    model = item["model"]
    provider = item.get("provider", "")
    if only_if_absent:
        existing = await fetch_pricing(model=model, provider=provider)
        if existing:
            return False
    await db.execute(
        """
        INSERT INTO model_pricing (model, provider, input_per_million, output_per_million, source, note, active)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        ON CONFLICT (model, provider) DO UPDATE SET
            input_per_million = EXCLUDED.input_per_million,
            output_per_million = EXCLUDED.output_per_million,
            source = EXCLUDED.source,
            note = EXCLUDED.note,
            active = TRUE,
            updated_at = NOW()
        """,
        model,
        provider,
        Decimal(item.get("input_per_million", 0)),
        Decimal(item.get("output_per_million", 0)),
        item.get("source", "manual"),
        item.get("note", ""),
    )
    return True


async def fetch_pricing(model: str | None = None, provider: str | None = None) -> list[dict[str, Any]]:
    if model and provider is not None:
        rows = await db.fetch(
            "SELECT * FROM model_pricing WHERE model=$1 AND provider=$2 ORDER BY updated_at DESC",
            model,
            provider,
        )
    else:
        rows = await db.fetch("SELECT * FROM model_pricing ORDER BY active DESC, updated_at DESC")
    return [dict(r) for r in rows]


async def deactivate_absent(seen: set[tuple[str, str]]) -> int:
    rows = await db.fetch(
        "SELECT id, model, provider, source FROM model_pricing WHERE active=TRUE"
    )
    deactivated = 0
    for row in rows:
        if row["source"] == "manual":
            continue
        if (row["model"], row["provider"]) not in seen:
            await db.execute(
                "UPDATE model_pricing SET active=FALSE, note='模型库已移除', updated_at=NOW() WHERE id=$1",
                row["id"],
            )
            deactivated += 1
    return deactivated


async def refresh_official_pricing() -> dict[str, int]:
    refreshed = skipped = 0
    for (provider, model), (inp, out) in OFFICIAL_PRICING.items():
        row = await db.fetchrow(
            "SELECT id, source FROM model_pricing WHERE model=$1 AND provider=$2",
            model,
            provider,
        )
        if row and row["source"] == "official":
            await db.execute(
                """UPDATE model_pricing SET input_per_million=$1, output_per_million=$2,
                   source='official', note='官方价参考，可改', active=TRUE, updated_at=NOW() WHERE id=$3""",
                inp,
                out,
                row["id"],
            )
            refreshed += 1
        else:
            skipped += 1
    return {"refreshed": refreshed, "skipped": skipped}


async def delete_pricing(pricing_id: int) -> bool:
    row = await db.fetchrow("SELECT source FROM model_pricing WHERE id=$1", pricing_id)
    if not row:
        return False
    if row["source"] == "official":
        return False
    await db.execute("DELETE FROM model_pricing WHERE id=$1", pricing_id)
    return True


async def summary(days: int = 30) -> list[dict[str, Any]]:
    rows = await db.fetch(
        """
        SELECT date_trunc('day', l.ts AT TIME ZONE 'Asia/Shanghai') AS day,
            l.model, l.provider,
            SUM(l.prompt_tokens) AS prompt_tokens,
            SUM(l.completion_tokens) AS completion_tokens,
            COUNT(*) AS calls,
            ROUND(SUM(l.prompt_tokens)/1000000.0 * COALESCE(p.input_per_million,0) +
                  SUM(l.completion_tokens)/1000000.0 * COALESCE(p.output_per_million,0), 4) +
                  COALESCE(SUM(l.cost), 0) AS cost_yuan
        FROM token_usage_log l
        LEFT JOIN LATERAL (
            SELECT input_per_million, output_per_million FROM model_pricing mp
            WHERE (mp.model=l.model AND mp.provider=l.provider)
               OR (mp.model=l.model AND mp.provider='') OR (mp.model='*')
            ORDER BY (mp.model=l.model AND mp.provider=l.provider) DESC,
                     (mp.model=l.model) DESC,
                     (mp.model='*') DESC
            LIMIT 1
        ) p ON TRUE
        WHERE l.ts >= now() - make_interval(days => $1)
        GROUP BY 1,2,3,p.input_per_million,p.output_per_million ORDER BY 1 DESC, cost_yuan DESC
        """,
        days,
    )
    return [dict(r) for r in rows]


async def by_scenario(days: int = 30) -> list[dict[str, Any]]:
    rows = await db.fetch(
        """
        SELECT date_trunc('day', l.ts AT TIME ZONE 'Asia/Shanghai') AS day,
            l.scenario,
            SUM(l.prompt_tokens) AS prompt_tokens,
            SUM(l.completion_tokens) AS completion_tokens,
            COUNT(*) AS calls
        FROM token_usage_log l
        WHERE l.ts >= now() - make_interval(days => $1)
        GROUP BY 1,2 ORDER BY 1 DESC, calls DESC
        """,
        days,
    )
    return [dict(r) for r in rows]


async def today_overview() -> dict[str, Any]:
    row = await db.fetchrow(
        """
        SELECT
            COUNT(*) AS calls,
            SUM(CASE WHEN success THEN 0 ELSE 1 END) AS fails,
            SUM(l.prompt_tokens) AS prompt_tokens,
            SUM(l.completion_tokens) AS completion_tokens,
            COALESCE(SUM(c.cost_yuan), 0) + COALESCE(SUM(l.cost), 0) AS cost_yuan
        FROM token_usage_log l
        LEFT JOIN LATERAL (
            SELECT ROUND(l.prompt_tokens/1000000.0 * COALESCE(p.input_per_million,0) +
                         l.completion_tokens/1000000.0 * COALESCE(p.output_per_million,0), 4) AS cost_yuan
            FROM model_pricing p
            WHERE (p.model=l.model AND p.provider=l.provider) OR (p.model=l.model AND p.provider='')
            ORDER BY (p.model=l.model AND p.provider=l.provider) DESC
            LIMIT 1
        ) c ON TRUE
        WHERE l.ts >= date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
        """
    )
    if not row:
        return {"calls": 0, "fails": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost_yuan": "0", "failure_rate": 0.0}
    data = dict(row)
    for k in ["calls", "fails", "prompt_tokens", "completion_tokens"]:
        data[k] = int(data.get(k) or 0)
    data["cost_yuan"] = str(data.get("cost_yuan") or "0")
    calls = data["calls"]
    fails = data["fails"]
    data["failure_rate"] = round(fails / calls, 4) if calls else 0.0
    return data
