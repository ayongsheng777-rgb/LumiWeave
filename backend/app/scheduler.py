from __future__ import annotations

import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app import db
from app.config import settings
from app.token_usage import pricing

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler(timezone="Asia/Shanghai")

REPORT_PUSHED_KEY = "token_report_pushed_date"


async def _get_kv(key: str) -> str | None:
    row = await db.fetchrow("SELECT value FROM app_kv WHERE key=$1", key)
    return row["value"] if row else None


async def _set_kv(key: str, value: str) -> None:
    await db.execute(
        """
        INSERT INTO app_kv (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
        """,
        key,
        value,
    )


async def _yesterday_summary() -> dict:
    rows = await db.fetch(
        """
        SELECT
            COUNT(*) AS calls,
            SUM(CASE WHEN success THEN 0 ELSE 1 END) AS fails,
            SUM(prompt_tokens) AS prompt_tokens,
            SUM(completion_tokens) AS completion_tokens,
            ROUND(SUM(prompt_tokens)/1000000.0 * COALESCE(p_in.input_per_million,0) +
                  SUM(completion_tokens)/1000000.0 * COALESCE(p_out.output_per_million,0), 4) AS cost_yuan
        FROM token_usage_log l
        LEFT JOIN LATERAL (SELECT input_per_million FROM model_pricing WHERE model='*' LIMIT 1) p_in ON TRUE
        LEFT JOIN LATERAL (SELECT output_per_million FROM model_pricing WHERE model='*' LIMIT 1) p_out ON TRUE
        WHERE l.ts >= date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai' - interval '1 day') AT TIME ZONE 'Asia/Shanghai'
          AND l.ts < date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
        """
    )
    data = dict(rows[0]) if rows else {}
    top = await db.fetch(
        """
        SELECT model, COUNT(*) AS calls
        FROM token_usage_log
        WHERE ts >= date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai' - interval '1 day') AT TIME ZONE 'Asia/Shanghai'
          AND ts < date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
        GROUP BY model ORDER BY calls DESC LIMIT 3
        """
    )
    return {
        "calls": int(data.get("calls") or 0),
        "fails": int(data.get("fails") or 0),
        "prompt_tokens": int(data.get("prompt_tokens") or 0),
        "completion_tokens": int(data.get("completion_tokens") or 0),
        "cost_yuan": str(data.get("cost_yuan") or "0"),
        "top_models": [dict(r) for r in top],
    }


async def daily_feishu_report() -> None:
    if not settings.feishu_webhook_url:
        logger.info("FEISHU_WEBHOOK_URL not set, skip daily report")
        return
    today_str = datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")
    pushed = await _get_kv(REPORT_PUSHED_KEY)
    if pushed == today_str:
        logger.info("Daily report already pushed for %s", today_str)
        return

    summary = await _yesterday_summary()
    card = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": "绵绣 LumiWeave 昨日 Token 用量"},
                "template": "purple",
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": (
                            f"**调用次数**：{summary['calls']}（失败 {summary['fails']}）\n"
                            f"**输入 Token**：{summary['prompt_tokens']}\n"
                            f"**输出 Token**：{summary['completion_tokens']}\n"
                            f"**折算费用**：¥{float(summary['cost_yuan']):.4f}\n"
                            f"**TOP3 模型**：{', '.join(m['model'] for m in summary['top_models'])}"
                        ),
                    },
                }
            ],
        },
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(settings.feishu_webhook_url, json=card)
            response.raise_for_status()
        await _set_kv(REPORT_PUSHED_KEY, today_str)
        logger.info("Daily Feishu report pushed for %s", today_str)
    except Exception:
        logger.exception("Failed to push Feishu report")


def start_scheduler() -> None:
    scheduler.add_job(daily_feishu_report, "cron", hour=6, minute=0)
    scheduler.start()
    logger.info("Scheduler started")


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
