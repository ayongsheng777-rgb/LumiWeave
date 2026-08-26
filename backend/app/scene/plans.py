"""商业化套餐（规格书 §73）：Free / Pro / Business / Enterprise 的配额与限制。

当前未接入用户体系，默认按免费版计；提供场景数/对象数/每日生成次数软限制，
路由层在 create_scene / 对象创建时调用 check_* 做校验。
"""
from __future__ import annotations

from typing import Any

PLANS: dict[str, dict[str, Any]] = {
    "free": {
        "name": "免费版",
        "price": 0,
        "limits": {"scenes": 10, "objects_per_scene": 300, "generations_per_day": 20},
        "features": ["3 个专业场景", "基础 AI 生成（限额内）", "云端出图/生视频（按量）"],
    },
    "pro": {
        "name": "专业版",
        "price": 99,
        "limits": {"scenes": 100, "objects_per_scene": 1000, "generations_per_day": 200},
        "features": ["全部 P0 能力", "多模型自动优选", "批量 SKU 加速", "素材库不限量"],
    },
    "business": {
        "name": "企业版",
        "price": 499,
        "limits": {"scenes": 500, "objects_per_scene": 5000, "generations_per_day": 1000},
        "features": ["团队协作预留", "更高并发与超时配额", "专属模型路由", "优先支持"],
    },
    "enterprise": {
        "name": "旗舰版",
        "price": 0,  # 商务洽谈
        "limits": {"scenes": 999999, "objects_per_scene": 99999, "generations_per_day": 999999},
        "features": ["私有化部署", "全功能无限制", "SLA 保障", "定制开发"],
    },
}

# 当前生效套餐（默认 free；可经 POST /api/scenes/plans 切换，持久化在 app_kv —— 深度增强 #4）
_PLAN_KV_KEY = "current_plan"
_DEFAULT_PLAN = "free"


async def current_plan() -> dict:
    """读 app_kv 里的当前套餐（重启不丢）。"""
    pid = _DEFAULT_PLAN
    try:
        from app import db
        row = await db.fetchrow("SELECT value FROM app_kv WHERE key=$1", _PLAN_KV_KEY)
        if row and row["value"] in PLANS:
            pid = row["value"]
    except Exception:  # noqa: BLE001
        pass
    plan = PLANS.get(pid, PLANS["free"])
    return {"id": pid, **plan}


async def set_plan(pid: str) -> bool:
    """切换当前套餐（持久化 app_kv）。"""
    if pid not in PLANS:
        return False
    from app import db
    await db.execute(
        """INSERT INTO app_kv (key, value, updated_at) VALUES ($1,$2,NOW())
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()""",
        _PLAN_KV_KEY, pid,
    )
    return True


def list_plans() -> list[dict]:
    return [{"id": k, **v} for k, v in PLANS.items()]


async def check_scene_quota(project_id: str) -> tuple[bool, str]:
    """新建场景前检查配额（按当前套餐）。"""
    p = await current_plan()
    limit = int(p["limits"].get("scenes", 10))
    from app.scene import service
    count = len(await service.list_scenes(project_id))
    if count >= limit:
        return False, f"{p['name']}场景数已达上限（{limit} 个），请升级套餐"
    return True, ""


async def check_object_quota(scene_id: str) -> tuple[bool, str]:
    """场景内对象数软限制。"""
    p = await current_plan()
    limit = int(p["limits"].get("objects_per_scene", 300))
    from app.scene import service
    count = len(await service.list_objects(scene_id))
    if count >= limit:
        return False, f"{p['name']}单场景对象数已达上限（{limit}）"
    return True, ""
