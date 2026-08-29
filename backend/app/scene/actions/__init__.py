"""场景动作执行器（V2.5 规格书 §19 / §42 / §45-§46）。

2026-08-29 起由单文件 actions.py 拆分为包：
  shared.py    共享基础（Provider/LLM/剧本解析/RAG/任务留痕）
  media.py     媒体生成（图片/视频/镜头/节点级/拉片）
  marketing.py 电商营销（商品/策略/视觉板/详情页/批量SKU）
  story.py     剧情与分镜（剧本/故事/分镜/AI引入）
  audio.py     音频与成片（BGM/配音/字幕/合成）
  dispatch.py  分发入口（execute_action 及异步）

本 __init__ 原样 re-export 全部对外名字，外部 import 路径不变：
  from app.scene.actions import execute_action / _chat_full / _act_generate_storyboard / ...
"""
from app.scene.actions.audio import (
    _act_compose_final,
    _act_generate_music,
    _act_generate_subtitle,
    _act_generate_voiceover,
)
from app.scene.actions.dispatch import (
    _act_director_start,
    _act_skill,
    _run_action,
    _run_action_task,
    _run_batch_async,
    execute_action,
)
from app.scene.actions.marketing import (
    VISUAL_BOARD_SYSTEM,
    _act_analyze_product,
    _act_batch_sku,
    _act_generate_detail_page,
    _act_generate_strategy,
    _act_generate_visual_board,
)
from app.scene.actions.media import (
    _act_analyze_shot,
    _act_film_analysis,
    _act_generate_images,
    _act_generate_node_image,
    _act_generate_node_video,
    _act_generate_prompt,
    _act_generate_shots,
    _act_generate_video,
    _auto_prompt,
    _gen_image,
)
from app.scene.actions.shared import (
    _chat_full,
    _cn_num,
    _cosine,
    _embed,
    _image_provider,
    _label,
    _llm_json,
    _llm_text,
    _log_task,
    _parse_cn_num,
    _parse_script,
    _rag_retrieve,
    _record_usage,
    _register_asset,
    _shot_bgm,
    _siliconflow_profile,
    _story_quality_context,
    _video_provider,
)
from app.scene.actions.story import (
    SCRIPT_FORMAT,
    _act_generate_story,
    _act_generate_story_from_text,
    _act_generate_storyboard,
    _act_llm_scene,
    _act_storyboard_import_ai,
)

__all__ = [n for n in dir() if n.startswith(("_act", "_gen", "_run", "_llm", "_parse", "_chat",
                                             "_rag", "_record", "_register", "_shot", "_image",
                                             "_video", "_siliconflow", "_story", "_label", "_auto",
                                             "_embed", "_cosine", "_cn", "execute_action",
                                             "SCRIPT_FORMAT", "VISUAL_BOARD_SYSTEM"))]
