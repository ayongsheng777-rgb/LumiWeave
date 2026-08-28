"""场景模板（规格书 §26 / §39 / §40）：12 类电商营销模板，JSON 化、可扩展。

模板 = 一组初始对象（type/x/y/width/height/data）+ 动作链提示。
新增模板只需在此加一条，前端「模板」面板自动出现（不改 Canvas Core）。
"""
from __future__ import annotations

from typing import Any

from app.scene import service

# 对象简写：("type", x, y, width, height, {data})
TEMPLATES: dict[str, dict[str, Any]] = {
    "main-image": {
        "name": "主图速出",
        "platform": "通用",
        "category": "ecommerce-material",
        "description": "商品 + 提示词 → 一键生成 3 张主图",
        "objects": [
            ("product", 0, 0, 300, 220, {"name": "新品", "brand": "", "category": "", "selling_points": ["高清", "大容量"]}),
            ("prompt", 360, 0, 300, 160, {"text": "电商主图，商品居中，干净浅色背景，商业摄影"}),
            ("image", 0, 280, 280, 280, {"url": "", "prompt": ""}),
        ],
        "actions": ["analyze_product", "generate_main_image"],
    },
    "scene-image": {
        "name": "场景图生成",
        "platform": "通用",
        "category": "ecommerce-material",
        "description": "商品 + 使用场景 → 生活化场景图",
        "objects": [
            ("product", 0, 0, 300, 220, {"name": "商品", "category": ""}),
            ("prompt", 360, 0, 300, 160, {"text": "商品放在真实使用场景，自然光，生活化"}),
            ("image", 0, 280, 280, 280, {"url": "", "prompt": ""}),
        ],
        "actions": ["generate_scene_image"],
    },
    "poster": {
        "name": "营销海报",
        "platform": "通用",
        "category": "ecommerce-material",
        "description": "商品 + 卖点 → 竖版海报",
        "objects": [
            ("product", 0, 0, 300, 220, {"name": "商品", "selling_points": []}),
            ("poster", 360, 0, 280, 400, {"prompt": "", "url": ""}),
        ],
        "actions": ["generate_poster"],
    },
    "detail-page": {
        "name": "详情页",
        "platform": "淘宝",
        "category": "ecommerce-material",
        "description": "商品 → AI 卖点 + 模块化详情页文案",
        "objects": [
            ("product", 0, 0, 300, 220, {"name": "商品", "category": "", "selling_points": []}),
            ("text", 360, 0, 420, 200, {"name": "详情页", "text": "", "detail_page": True}),
        ],
        "actions": ["generate_detail_page"],
    },
    "vertical-video": {
        "name": "9:16 短视频",
        "platform": "抖音",
        "category": "ecommerce-material",
        "description": "商品 + 剧情 → 竖版带货短视频",
        "objects": [
            ("product", 0, 0, 300, 220, {"name": "商品"}),
            ("story", 360, 0, 320, 200, {"title": "", "summary": "", "text": ""}),
            ("video", 0, 280, 320, 260, {"url": "", "prompt": ""}),
        ],
        "actions": ["generate_story", "generate_video"],
    },
    "batch-sku": {
        "name": "批量 SKU",
        "platform": "淘宝",
        "category": "ecommerce-material",
        "description": "一个商品带 2 个 SKU → 主图/场景图/海报批量生成",
        "objects": [
            ("product", 0, 0, 300, 220,
             {"name": "多规格商品", "sku": [{"name": "白色款"}, {"name": "黑色款"}]}),
            ("text", 360, 0, 320, 160, {"name": "批量计划", "text": "按 SKU 生成主图/场景图/海报"}),
        ],
        "actions": ["batch_generate"],
    },
    "selling-points": {
        "name": "卖点提炼",
        "platform": "通用",
        "category": "ecommerce-material",
        "description": "商品 → AI 提炼 3-5 条核心卖点 + 营销方案",
        "objects": [
            ("product", 0, 0, 300, 220, {"name": "商品", "description": "简要描述你的商品"}),
            ("analysis", 360, 0, 340, 220, {"text": ""}),
        ],
        "actions": ["analyze_product"],
    },
    "live-script": {
        "name": "直播脚本",
        "platform": "抖音",
        "category": "ecommerce-material",
        "description": "商品 → AI 生成直播话术脚本",
        "objects": [
            ("product", 0, 0, 300, 220, {"name": "商品", "selling_points": []}),
            ("text", 360, 0, 420, 260, {"name": "直播脚本", "text": ""}),
        ],
        "actions": ["generate_voiceover"],
    },
    "coupon": {
        "name": "优惠券素材",
        "platform": "淘宝",
        "category": "ecommerce-material",
        "description": "商品 + 优惠信息 → 券面素材",
        "objects": [
            ("product", 0, 0, 300, 220, {"name": "商品"}),
            ("material", 360, 0, 300, 200, {"name": "优惠券", "url": ""}),
            ("image", 0, 280, 280, 280, {"url": "", "prompt": ""}),
        ],
        "actions": ["generate_main_image"],
    },
    "comparison": {
        "name": "对比图",
        "platform": "通用",
        "category": "ecommerce-material",
        "description": "本品 vs 竞品 → 对比主图",
        "objects": [
            ("product", 0, 0, 300, 220, {"name": "本品"}),
            ("product", 360, 0, 300, 220, {"name": "竞品"}),
            ("image", 0, 300, 340, 280, {"url": "", "prompt": ""}),
        ],
        "actions": ["generate_main_image"],
    },
    "unboxing": {
        "name": "开箱视频",
        "platform": "抖音",
        "category": "ecommerce-drama",
        "description": "商品 + 分镜 → 开箱短视频",
        "objects": [
            ("product", 0, 0, 300, 220, {"name": "商品"}),
            ("storyboard", 360, 0, 320, 220, {"scene": 1, "shot": 1, "description": "开箱过程", "dialogue": ""}),
            ("video", 0, 300, 320, 260, {"url": "", "prompt": ""}),
        ],
        "actions": ["generate_story", "generate_storyboard", "generate_video", "compose_final"],
    },
    "product-card": {
        "name": "商品卡",
        "platform": "小红书",
        "category": "ecommerce-material",
        "description": "商品 + 主图 + 卖点 → 信息流商品卡",
        "objects": [
            ("product", 0, 0, 300, 220, {"name": "商品", "selling_points": []}),
            ("image", 0, 280, 280, 280, {"url": "", "prompt": ""}),
            ("text", 340, 280, 300, 200, {"name": "卖点文案", "text": ""}),
        ],
        "actions": ["analyze_product", "generate_main_image"],
    },
}


def list_templates(category: str = "") -> list[dict]:
    out = []
    for tid, t in TEMPLATES.items():
        if category and t.get("category") != category:
            continue
        out.append({
            "id": tid, "name": t["name"], "category": t.get("category", ""),
            "platform": t.get("platform", "通用"),
            "description": t.get("description", ""),
            "object_types": [o[0] for o in t.get("objects", [])],
            "actions": t.get("actions", []),
        })
    return out


async def apply_template(scene_id: str, template_id: str) -> list[str]:
    """把模板的初始对象创建到场景里，返回新建对象 id 列表。"""
    t = TEMPLATES.get(template_id)
    if not t:
        raise ValueError(f"模板不存在: {template_id}")
    created = []
    for item in t.get("objects", []):
        obj_type, x, y, w, h, data = item
        oid = await service.create_object(
            scene_id, obj_type, x=float(x), y=float(y),
            width=float(w), height=float(h), data=dict(data),
        )
        created.append(oid)
    return created
