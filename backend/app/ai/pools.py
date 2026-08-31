"""场景模型候选池（scene_pools）+ 画布智能动作（pv_actions）。

持久化在 app_kv（key=scene_pools / pv_actions），重启后由 lifespan 重新加载。

scene_pools 结构（全局，按出图/出视频两个场景分池）：
{
  "image": {
    "default": "<candidate id>",
    "candidates": [
      {"id": "sf-llm::Qwen/Qwen-Image", "profile_id": "sf-llm", "model": "Qwen/Qwen-Image",
       "label": "硅基·Qwen-Image", "renderer": "cloud"},
      {"id": "comfyui::xxx.safetensors", "profile_id": "comfyui", "model": "xxx.safetensors",
       "label": "ComfyUI·xxx", "renderer": "comfyui"}
    ]
  },
  "video": {...}
}
🔴 profile_id="comfyui" 是特殊值：表示走本地 ComfyUI 渲染器（render_mode=comfyui），
   model 为 checkpoint 名；其余 profile_id 对应模型库（CUSTOM_MODELS）里的配置。

pv_actions 结构（画布节点悬浮工具栏的智能动作，提示词模板后期可改）：
[
  {"id": "multi_angle_grid", "label": "多机位九宫格", "kind": "image", "enabled": true,
   "prompt_template": "...{prompt}...", "scene": "image", "model": ""}
]
  - prompt_template 里的 {prompt} 会被用户在 composer 里补充的描述替换
  - model 为空 = 用场景候选池默认项；否则为候选 id（"<profile_id>::<model>"）
"""
from __future__ import annotations

import copy
import json
from typing import Any

from app import db

_POOLS_KEY = "scene_pools"
_ACTIONS_KEY = "pv_actions"

POOL_SCENES = ("image", "video")

# 内存中的当前值（原地更新，跨模块引用不失效——同 CUSTOM_MODELS 的教训）
SCENE_POOLS: dict[str, dict[str, Any]] = {}
PV_ACTIONS: list[dict[str, Any]] = []

# 画布智能动作默认集（对标 PixVerse 图片节点「智能生成」菜单；模板可被用户在设置里修改）
DEFAULT_ACTIONS: list[dict[str, Any]] = [
    {"id": "multi_angle_grid", "label": "多机位九宫格", "kind": "image", "enabled": True, "scene": "image", "model": "",
     "prompt_template": "以参考图为主体，生成 3×3 九宫格多机位视图：正面、侧面、背面、俯视、仰视、特写等九个不同角度，保持主体外观完全一致，网格整齐排列。{prompt}"},
    {"id": "plot_grid", "label": "剧情推演四宫格", "kind": "image", "enabled": True, "scene": "image", "model": "",
     "prompt_template": "以参考图为起始画面，推演后续剧情，生成 2×2 四宫格连续剧情画面，情节连贯、主体一致、画风统一。{prompt}"},
    {"id": "face_triple", "label": "角色脸部三视图", "kind": "image", "enabled": True, "scene": "image", "model": "",
     "prompt_template": "以参考图角色为准，生成脸部三视图（正面、半侧面、正侧面），五官特征完全一致，简洁背景，排列整齐。{prompt}"},
    {"id": "char_sheet", "label": "角色设定图", "kind": "image", "enabled": True, "scene": "image", "model": "",
     "prompt_template": "以参考图角色为准，生成完整角色设定图：全身正面/侧面/背面 + 常用表情集 + 服装细节特写，设定集排版风格，角色形象保持一致。{prompt}"},
    {"id": "scene_sheet", "label": "场景设定图", "kind": "image", "enabled": True, "scene": "image", "model": "",
     "prompt_template": "以参考图场景为准，生成场景设定图：全景概览、不同时间/天气版本、关键道具细节特写，风格统一，设定集排版。{prompt}"},
    {"id": "product_sheet", "label": "产品设定图", "kind": "image", "enabled": True, "scene": "image", "model": "",
     "prompt_template": "以参考图产品为准，生成产品设定图：多角度展示、材质细节特写、典型使用场景，电商级质感，产品外观保持一致。{prompt}"},
    {"id": "storyboard_25", "label": "25宫格连贯分镜", "kind": "image", "enabled": True, "scene": "image", "model": "",
     "prompt_template": "以参考图为起点，生成 5×5 二十五宫格连贯分镜，讲述一个完整小故事，画面按阅读顺序排列，情节连贯、主体一致。{prompt}"},
    {"id": "cinematic_light", "label": "电影级光影校正", "kind": "image", "enabled": True, "scene": "image", "model": "",
     "prompt_template": "保持参考图构图与内容不变，校正为电影级光影：统一光源方向、拉开明暗层次、增强氛围感与体积感。{prompt}"},
    {"id": "multi_angle", "label": "多角度", "kind": "image", "enabled": True, "scene": "image", "model": "",
     "prompt_template": "以参考图为主体，换一个拍摄角度重新构图，保持主体外观、服装、环境完全一致。{prompt}"},
    {"id": "relight", "label": "打光", "kind": "image", "enabled": True, "scene": "image", "model": "",
     "prompt_template": "保持参考图内容与构图不变，重新打光：{prompt}"},
    {"id": "smart_edit", "label": "智能编辑", "kind": "image", "enabled": True, "scene": "image", "model": "",
     "prompt_template": "按以下要求编辑参考图，其余部分保持不变：{prompt}"},
]


def default_pools() -> dict[str, dict[str, Any]]:
    return {s: {"default": "", "candidates": []} for s in POOL_SCENES}


def default_actions() -> list[dict[str, Any]]:
    return copy.deepcopy(DEFAULT_ACTIONS)


def _normalize_pools(data: Any) -> dict[str, dict[str, Any]]:
    """清洗候选池结构：只保留 image/video 两个场景，候选字段补齐。"""
    out = default_pools()
    if not isinstance(data, dict):
        return out
    for scene in POOL_SCENES:
        raw = data.get(scene)
        if not isinstance(raw, dict):
            continue
        candidates: list[dict[str, Any]] = []
        for c in (raw.get("candidates") or []):
            if not isinstance(c, dict):
                continue
            profile_id = str(c.get("profile_id") or "").strip()
            model = str(c.get("model") or "").strip()
            if not profile_id or not model:
                continue
            cid = str(c.get("id") or "").strip() or f"{profile_id}::{model}"
            candidates.append({
                "id": cid,
                "profile_id": profile_id,
                "model": model,
                "label": str(c.get("label") or model),
                "renderer": "comfyui" if profile_id == "comfyui" else "cloud",
            })
        default = str(raw.get("default") or "").strip()
        if default and all(c["id"] != default for c in candidates):
            default = ""
        if not default and candidates:
            default = candidates[0]["id"]
        out[scene] = {"default": default, "candidates": candidates}
    return out


def _normalize_actions(data: Any) -> list[dict[str, Any]]:
    """清洗动作列表；未知动作也保留（用户可能自定义），缺字段补齐。"""
    if not isinstance(data, list):
        return default_actions()
    out: list[dict[str, Any]] = []
    for a in data:
        if not isinstance(a, dict):
            continue
        aid = str(a.get("id") or "").strip()
        if not aid:
            continue
        out.append({
            "id": aid,
            "label": str(a.get("label") or aid),
            "kind": "video" if a.get("kind") == "video" else "image",
            "enabled": bool(a.get("enabled", True)),
            "scene": "video" if a.get("scene") == "video" else "image",
            "model": str(a.get("model") or ""),
            "prompt_template": str(a.get("prompt_template") or "{prompt}"),
        })
    return out or default_actions()


async def load_scene_pools() -> None:
    row = await db.fetchrow("SELECT value FROM app_kv WHERE key=$1", _POOLS_KEY)
    pools = default_pools()
    if row:
        try:
            pools = _normalize_pools(json.loads(row["value"]))
        except Exception:
            pass
    SCENE_POOLS.clear()
    SCENE_POOLS.update(pools)


async def save_scene_pools() -> None:
    await db.execute(
        """
        INSERT INTO app_kv (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
        """,
        _POOLS_KEY,
        json.dumps(SCENE_POOLS, ensure_ascii=False),
    )


async def load_pv_actions() -> None:
    row = await db.fetchrow("SELECT value FROM app_kv WHERE key=$1", _ACTIONS_KEY)
    actions = default_actions()
    if row:
        try:
            actions = _normalize_actions(json.loads(row["value"]))
        except Exception:
            pass
    PV_ACTIONS.clear()
    PV_ACTIONS.extend(actions)


async def save_pv_actions() -> None:
    await db.execute(
        """
        INSERT INTO app_kv (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
        """,
        _ACTIONS_KEY,
        json.dumps(PV_ACTIONS, ensure_ascii=False),
    )


def resolve_candidate(candidate_id: str) -> dict[str, Any] | None:
    """按候选 id 在两个场景的池里查找候选（composer 选定模型后解析用）。"""
    cid = str(candidate_id or "").strip()
    if not cid:
        return None
    for pool in SCENE_POOLS.values():
        for c in pool.get("candidates") or []:
            if c.get("id") == cid:
                return dict(c)
    return None


def scene_default_candidate(scene: str) -> dict[str, Any] | None:
    pool = SCENE_POOLS.get(scene) or {}
    return resolve_candidate(pool.get("default") or "")
