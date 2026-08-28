"""V2.9d 硅基流动模型配置修复（2026-08-28）。
在 backend 容器内执行：docker compose exec -T backend python /app/fix_siliconflow_models.py
修复内容（用户已确认）：
  1. 模型库 sf-llm：model 从 zai-org/GLM-5.2（文本模型）改回 deepseek-ai/DeepSeek-V3
  2. ai_scene_defaults：image/video 场景默认改回 sf-llm + 对应图像/视频模型（原被改成 default/deepseek 纯文本）
  3. providers.siliconflow-image：models 从 1 个扩充到官方 7 个图像模型
  4. providers.siliconflow-llm：models 加入 Qwen3-VL-32B（视觉模型，供拆镜视觉分析用）
"""
from __future__ import annotations

import asyncio
import json

from app import db

IMAGE_MODELS = [
    "Qwen/Qwen-Image",
    "Kwai-Kolors/Kolors",
    "Tongyi-MAI/Z-Image",
    "Tongyi-MAI/Z-Image-Turbo",
    "baidu/ERNIE-Image-Turbo",
    "Qwen/Qwen-Image-Edit",
    "Qwen/Qwen-Image-Edit-2509",
]
VISION_MODELS = ["Qwen/Qwen3-VL-32B-Instruct", "Qwen/Qwen3-VL-8B-Instruct"]


async def main() -> None:
    # 1. ai_models：sf-llm model 改回 DeepSeek-V3
    rows = await db.fetch("SELECT value FROM app_kv WHERE key='ai_models'")
    models = json.loads(rows[0]["value"]) if rows else []
    changed = 0
    for p in models:
        if p.get("id") == "sf-llm":
            old = p.get("model")
            p["model"] = "deepseek-ai/DeepSeek-V3"
            changed += 1
            print(f"[ai_models] sf-llm.model: {old} -> deepseek-ai/DeepSeek-V3")
        if p.get("id") == "default":
            print(f"[ai_models] default.model（不动）: {p.get('model')}")
    await db.execute(
        "UPDATE app_kv SET value=$2::jsonb WHERE key='ai_models'",
        "ai_models", json.dumps(models, ensure_ascii=False),
    )
    print(f"[ai_models] updated, sf-llm touched={changed}")

    # 2. ai_scene_defaults：image/video 场景默认改回 sf-llm + 能力匹配模型
    rows = await db.fetch("SELECT value FROM app_kv WHERE key='ai_scene_defaults'")
    d = json.loads(rows[0]["value"]) if rows else {}
    d["image"] = {"profile_id": "sf-llm", "model": "Kwai-Kolors/Kolors"}
    d["video"] = {"profile_id": "sf-llm", "model": "Wan-AI/Wan2.2-T2V-A14B"}
    await db.execute(
        "UPDATE app_kv SET value=$2::jsonb WHERE key='ai_scene_defaults'",
        "ai_scene_defaults", json.dumps(d, ensure_ascii=False),
    )
    print("[ai_scene_defaults] image->sf-llm/Kolors, video->sf-llm/Wan2.2")

    # 3. providers.siliconflow-image：models 扩充到 7 个
    await db.execute(
        """UPDATE providers SET models=$2::jsonb, updated_at=NOW() WHERE id='siliconflow-image'""",
        "siliconflow-image", json.dumps(IMAGE_MODELS, ensure_ascii=False),
    )
    print(f"[providers] siliconflow-image.models -> {len(IMAGE_MODELS)} 个")

    # 4. providers.siliconflow-llm：加入视觉模型（拆镜视觉分析用）
    row = await db.fetchrow("SELECT models FROM providers WHERE id='siliconflow-llm'")
    llm_models = json.loads(row["models"]) if row and row["models"] else []
    for m in VISION_MODELS:
        if m not in llm_models:
            llm_models.append(m)
    await db.execute(
        "UPDATE providers SET models=$2::jsonb, updated_at=NOW() WHERE id='siliconflow-llm'",
        "siliconflow-llm", json.dumps(llm_models, ensure_ascii=False),
    )
    print(f"[providers] siliconflow-llm.models -> {llm_models}")

    # 校验
    r = await db.fetch("SELECT id, models FROM providers WHERE id IN ('siliconflow-image','siliconflow-llm') ORDER BY id")
    for x in r:
        print(f"[verify] {x['id']} models={x['models']}")
    await db.close_pool()
    print("DONE")


asyncio.run(main())
