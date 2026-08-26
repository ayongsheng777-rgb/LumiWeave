"""场景注册表（V2.5 规格书 §7）。

集中注册三大 P0 场景 + 专业对象元数据，前端动态读取以渲染工具条 / Inspector。
新增场景只需在此 register，不改动 Canvas Core（§40）。
"""
from __future__ import annotations

from typing import Any, Dict

from app.scene.schemas import SceneDefinition


class SceneRegistry:
    def __init__(self) -> None:
        self._scenes: Dict[str, SceneDefinition] = {}

    def register(self, scene: SceneDefinition) -> None:
        self._scenes[scene.id] = scene

    def get(self, scene_id: str) -> SceneDefinition | None:
        return self._scenes.get(scene_id)

    def list(self) -> list[SceneDefinition]:
        return list(self._scenes.values())


registry = SceneRegistry()


# ─────────────────────────────────────────────────────────────────────────────
# 专业对象元数据（前端工具条 / Inspector 共用）
#   label  中文名   color  主题色   icon  图标字符   default_data  新建默认字段
#   fields  Inspector 编辑字段（key -> 中文标签）
# ─────────────────────────────────────────────────────────────────────────────

OBJECT_LIBRARY: Dict[str, Dict[str, Any]] = {
    # 通用
    "text": {"label": "文字", "color": "#64748b", "icon": "T", "default_data": {"text": ""}, "fields": {"text": "文本"}},
    "image": {"label": "图片", "color": "#0ea5e9", "icon": "🖼", "default_data": {"prompt": "", "url": ""},
              "fields": {"prompt": "提示词", "url": "图片地址", "model": "模型"}},
    "video": {"label": "视频", "color": "#8b5cf6", "icon": "▶", "default_data": {"prompt": "", "url": ""},
              "fields": {"prompt": "提示词", "url": "视频地址", "duration": "时长", "model": "模型"}},
    "audio": {"label": "音频", "color": "#f59e0b", "icon": "♪", "default_data": {"text": ""}, "fields": {"text": "文本"}},
    "prompt": {"label": "提示词", "color": "#10b981", "icon": "✎", "default_data": {"text": ""}, "fields": {"text": "提示词"}},
    "note": {"label": "便签", "color": "#fbbf24", "icon": "✓", "default_data": {"text": ""}, "fields": {"text": "内容"}},
    "group": {"label": "分组", "color": "#94a3b8", "icon": "▦", "default_data": {}, "fields": {}},
    "reference": {"label": "参考图", "color": "#ec4899", "icon": "⚲", "default_data": {"url": ""}, "fields": {"url": "参考图地址"}},
    "analysis": {"label": "分析", "color": "#14b8a6", "icon": "🔍", "default_data": {"text": ""}, "fields": {"text": "分析内容"}},
    "result": {"label": "结果", "color": "#22c55e", "icon": "★", "default_data": {"url": ""}, "fields": {"url": "结果地址"}},

    # 电商
    "product": {
        "label": "商品", "color": "#ef4444", "icon": "🛍",
        "default_data": {"name": "", "brand": "", "category": "", "images": [], "selling_points": [], "attributes": {}, "sku": []},
        "fields": {"name": "商品名称", "brand": "品牌", "category": "类目", "selling_points": "卖点", "attributes": "属性"},
    },
    "poster": {"label": "海报", "color": "#f43f5e", "icon": "🖌", "default_data": {"prompt": "", "url": ""},
               "fields": {"prompt": "提示词", "url": "海报地址"}},
    "material": {"label": "物料", "color": "#fb923c", "icon": "📦", "default_data": {"name": "", "url": ""},
                 "fields": {"name": "名称", "url": "文件地址"}},

    # 短剧
    "story": {"label": "剧情", "color": "#a855f7", "icon": "📖", "default_data": {"title": "", "summary": "", "text": ""},
              "fields": {"title": "标题", "summary": "梗概", "text": "正文"}},
    "character": {"label": "人物", "color": "#d946ef", "icon": "👤", "default_data": {"name": "", "role": "", "appearance": "", "image": None},
                  "fields": {"name": "姓名", "role": "角色", "appearance": "外貌描述", "image": "形象图"}},
    "scene": {"label": "场景", "color": "#0d9488", "icon": "🎬",
              "default_data": {"scene_no": 1, "location": "", "time": "", "lighting": "", "characters": [], "description": ""},
              "fields": {"scene_no": "场号", "location": "地点", "time": "时间", "lighting": "光线", "description": "描述"}},
    "storyboard": {"label": "分镜", "color": "#6366f1", "icon": "🎞",
                   "default_data": {"scene": 1, "shot": 1, "duration": 4, "description": "", "dialogue": "", "camera": "medium shot", "motion": "push", "image": None, "video": None},
                   "fields": {"scene": "场号", "shot": "镜号", "duration": "时长", "description": "画面描述", "dialogue": "台词", "camera": "景别", "motion": "运动"}},
    "shot": {"label": "镜头", "color": "#3b82f6", "icon": "🎥",
             "default_data": {"shot_no": 1, "start": 0, "end": 0, "duration": 0, "shot_size": "", "lens": "", "camera_position": "", "camera_motion": "", "composition": "", "lighting": "", "color": "", "character": "", "emotion": "", "action": "", "analysis": "", "prompt": ""},
             "fields": {"shot_no": "镜号", "shot_size": "景别", "lens": "镜头", "camera_position": "机位", "camera_motion": "运动", "composition": "构图", "lighting": "光线", "color": "色调", "character": "人物", "emotion": "情绪", "action": "动作"}},

    # 影视拉片
    "frame": {"label": "关键帧", "color": "#06b6d4", "icon": "🖼", "default_data": {"url": "", "shot_id": ""},
              "fields": {"url": "帧地址", "shot_id": "所属镜头"}},
    "workflow": {"label": "工作流", "color": "#3b82f6", "icon": "⚙", "default_data": {"name": ""}, "fields": {"name": "名称"}},
}


# ─────────────────────────────────────────────────────────────────────────────
# 三大 P0 场景
# ─────────────────────────────────────────────────────────────────────────────

registry.register(SceneDefinition(
    id="ecommerce-material",
    name="电商商品营销物料",
    category="ecommerce",
    description="商品上传→识别→卖点→主图/场景图/海报/详情页/短视频，支持批量 SKU。",
    object_types=["product", "image", "text", "poster", "material"],
    actions=[
        "analyze_product", "generate_main_image", "generate_scene_image",
        "generate_poster", "generate_detail_page", "batch_generate",
    ],
    toolbar=["select", "text", "product", "image", "poster", "material", "ai", "group", "timeline", "zoom"],
    inspector=["product", "image", "poster", "material", "text"],
    timeline_enabled=False,
))

registry.register(SceneDefinition(
    id="ecommerce-drama",
    name="电商短剧带货",
    category="ecommerce",
    description="商品→卖点→人物→剧情→场景→分镜→镜头→图片→视频→配音→字幕→成片。",
    object_types=["product", "story", "character", "scene", "storyboard", "shot", "image", "video"],
    actions=[
        "generate_story", "generate_characters", "generate_scenes",
        "generate_storyboard", "generate_shots", "generate_images", "generate_video",
        "generate_voiceover", "generate_subtitle", "compose_final",
    ],
    toolbar=["select", "text", "product", "character", "scene", "storyboard", "shot", "image", "video", "ai", "group", "timeline", "zoom"],
    inspector=["product", "story", "character", "scene", "storyboard", "shot", "image", "video"],
    timeline_enabled=True,
))

registry.register(SceneDefinition(
    id="film-analysis",
    name="影视拉片",
    category="film",
    description="视频上传→解析→场景/镜头检测→关键帧→视觉分析→镜头语言分析→Prompt→参考图→视频重构。V2.5 旗舰差异化功能。",
    object_types=["video", "scene", "shot", "frame", "analysis", "prompt", "image", "reference"],
    actions=[
        "analyze_video", "detect_shots", "extract_frames",
        "analyze_shot", "generate_prompt", "generate_reference", "generate_video",
    ],
    toolbar=["select", "text", "video", "scene", "shot", "frame", "image", "reference", "ai", "group", "timeline", "zoom"],
    inspector=["video", "scene", "shot", "frame", "analysis", "prompt", "image", "reference"],
    timeline_enabled=True,
))
