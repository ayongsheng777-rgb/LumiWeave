"""场景注册表（V2.5 规格书 §7）。

集中注册三大 P0 场景 + 专业对象元数据，前端动态读取以渲染工具条 / Inspector。
新增场景只需在此 register，不改动 Canvas Core（§40）。

V2.6 节点整合：对象精简为 7 类 —— 文本 / 图片 / 视频 / 音频 / 剧情 / 导演台 / 商品。
- 商品 = 剧本引子（商品链接 + SKU + 主图），连线剧情后围绕商品生成剧本。
- 图片节点带「用途」（人物 / 场景 / 道具），音频节点带「类型」（配音 / BGM / 音效），
  连线剧情后按顺序自动编号，连到视频节点的作为参考资料带进生产。
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
    # ── 通用 ──────────────────────────────────────────────────────
    "text": {"label": "文本", "color": "#64748b", "icon": "T",
             "default_data": {"text": ""}, "fields": {"text": "文本"}},
    "image": {"label": "图片", "color": "#0ea5e9", "icon": "🖼",
              "default_data": {"prompt": "", "url": "", "purpose": "人物", "model": ""},
              "fields": {"prompt": "提示词", "url": "图片地址", "purpose": "用途", "model": "模型"}},
    "video": {"label": "视频", "color": "#8b5cf6", "icon": "▶",
              "default_data": {
                  "prompt": "", "url": "", "duration": 10, "model": "",
                  "shot_no": "", "desc": "",
                  "aspect_ratio": "16:9", "camera_motion": "固定镜头",
                  "resolution": "1080p", "style": "",
                  "dialogue_script": "", "sfx_desc": "", "subtitle_enabled": False,
              },
              "fields": {"prompt": "提示词", "url": "视频地址", "duration": "时长", "model": "模型",
                         "shot_no": "分镜序号", "desc": "分镜内容", "aspect_ratio": "画面比例",
                         "camera_motion": "运镜", "resolution": "清晰度", "style": "风格",
                         "dialogue_script": "对白/画内画外音", "sfx_desc": "特效音效", "subtitle_enabled": "生成字幕"}},
    "audio": {"label": "音频", "color": "#f59e0b", "icon": "♪",
              "default_data": {
                  "text": "", "audio_type": "配音", "url": "",
                  "prompt": "", "shot_no": "", "desc": "", "style": "", "instruments": "",
              },
              "fields": {"text": "文本", "audio_type": "音频类型", "url": "音频地址",
                         "prompt": "音乐提示词", "shot_no": "分镜序号", "desc": "分镜描述",
                         "style": "音乐风格", "instruments": "乐器设定"}},

    # ── 剧情（剧本）────────────────────────────────────────────────
    "story": {"label": "剧情", "color": "#a855f7", "icon": "📖",
              "default_data": {"title": "", "summary": "", "text": "", "script": ""},
              "fields": {"title": "标题", "summary": "梗概", "text": "正文", "script": "剧本"}},

    # ── 导演台（分镜 / 镜头 / 台词统筹节点）────────────────────────
    "director": {"label": "导演台", "color": "#6366f1", "icon": "🎬",
                 "default_data": {"storyboard": [], "notes": ""},
                 "fields": {"notes": "导演备注"}},

    # ── 商品（剧本引子：链接 + SKU + 主图）────────────────────────
    "product": {"label": "商品", "color": "#ef4444", "icon": "🛍",
                "default_data": {"name": "", "product_url": "", "sku": "", "main_image": "", "info": ""},
                "fields": {"name": "商品名称", "product_url": "商品链接", "sku": "SKU 码", "main_image": "主图地址", "info": "商品信息"}},
}

# 通用字段选项（供前端渲染下拉，不进数据库）
FIELD_OPTIONS: Dict[str, Dict[str, list[str]]] = {
    "image": {"purpose": ["人物", "场景", "道具"]},
    "audio": {"audio_type": ["配音", "BGM", "音效"]},
}


# ─────────────────────────────────────────────────────────────────────────────
# 三大场景（节点统一为 7 类）
# ─────────────────────────────────────────────────────────────────────────────

COMMON_OBJECT_TYPES = ["text", "image", "video", "audio", "story", "director", "product"]
COMMON_TOOLBAR = ["select", "text", "product", "story", "image", "video", "audio", "director", "ai", "timeline", "zoom"]

registry.register(SceneDefinition(
    id="ecommerce-material",
    name="电商商品营销物料",
    category="ecommerce",
    description="商品→剧情→图片/视频/音频→导演台统筹→成片。",
    object_types=COMMON_OBJECT_TYPES,
    actions=[
        "analyze_product", "generate_main_image", "generate_scene_image",
        "generate_poster", "generate_detail_page", "batch_generate",
    ],
    toolbar=COMMON_TOOLBAR,
    inspector=COMMON_OBJECT_TYPES,
    timeline_enabled=False,
))

registry.register(SceneDefinition(
    id="ecommerce-drama",
    name="电商短剧带货",
    category="ecommerce",
    description="商品→剧情→图片/视频/音频→导演台统筹→成片。",
    object_types=COMMON_OBJECT_TYPES,
    actions=[
        "generate_story", "generate_characters", "generate_scenes",
        "generate_storyboard", "generate_shots", "generate_images", "generate_video",
        "generate_voiceover", "generate_music", "generate_subtitle", "compose_final",
    ],
    toolbar=COMMON_TOOLBAR,
    inspector=COMMON_OBJECT_TYPES,
    timeline_enabled=True,
))

registry.register(SceneDefinition(
    id="film-analysis",
    name="影视拉片",
    category="film",
    description="视频→剧情→图片/视频/音频→导演台统筹→成片。",
    object_types=COMMON_OBJECT_TYPES,
    actions=[
        "analyze_video", "detect_shots", "extract_frames",
        "analyze_shot", "generate_prompt", "generate_reference", "generate_video",
    ],
    toolbar=COMMON_TOOLBAR,
    inspector=COMMON_OBJECT_TYPES,
    timeline_enabled=True,
))
