"""scene/actions 包纯逻辑单元测试（2026-08-29 拆分后补网）。

覆盖：_parse_script 全格式（人物/道具/场景行/分镜/关键画面/对白）、
_cn_num/_parse_cn_num、_shot_bgm、_cosine、_label、_run_action 未知动作分发。
全部为纯逻辑，不调 LLM、不依赖外部服务（db 连接池在 lifespan 里，import 不触发）。
"""
import asyncio

from app.scene.actions import _run_action  # dispatch 兼容路径（re-export）
from app.scene.actions.shared import (
    _cn_num,
    _cosine,
    _label,
    _parse_cn_num,
    _parse_script,
    _shot_bgm,
)

# ── 剧本样本 ──────────────────────────────────────────────────────────────

SCRIPT_SUBLINE = """# 视频剧本：测试片

# 出场元素
- 人物：
  - 林晓（女，28岁）：都市白领，疲惫但坚韧
  - 陈默（男，30岁）：林晓同事
- 道具：奶茶（大杯、去冰）、旧手机
- 场景：步行街 / 小巷
# 场景一：小巷（约 15 秒）
- 场景目标：引出主角困境
- 情绪基调：压抑
- 背景音乐：低沉弦乐+风声采样
- 画面正文：深夜小巷，林晓独行。
- 关键画面：
  - 镜头1-1：路灯下林晓的背影
  - 镜头1-2：手中的奶茶特写
- 对白 / 旁白：
  - [旁白] "她已经三天没合眼了。"
  - 林晓（疲惫）："就快到了。"
# 场景二：步行街（约 10 秒）
- 场景目标：转折
- 情绪基调：希望
- 背景音乐：钢琴渐强
- 关键画面：
  - 霓虹灯牌亮起
- 对白 / 旁白：
  - 陈默："你来了。"
"""

SCRIPT_INLINE = """# 出场元素
- 人物：林晓（女，28岁）、陈默
- 道具：奶茶
# 场景一：小巷（约 8 秒）
- 场景目标：开场
"""


# ── _parse_script：人物 ────────────────────────────────────────────────────

def test_parse_characters_subline_format():
    p = _parse_script(SCRIPT_SUBLINE)
    assert "林晓" in p["characters"]
    assert "陈默" in p["characters"]


def test_parse_characters_inline_format():
    """同行格式：- 人物：林晓（女，28岁）、陈默（括号内顿号不拆）。"""
    p = _parse_script(SCRIPT_INLINE)
    assert "林晓" in p["characters"]
    assert "陈默" in p["characters"]


# ── _parse_script：道具（2026-08-29 修复点）────────────────────────────────

def test_parse_props_no_scene_line_swallow():
    """道具段不得吞掉「- 场景：」行。"""
    p = _parse_script(SCRIPT_SUBLINE)
    assert all("步行街" not in x and "小巷" != x for x in p["props"])
    assert not any(x.startswith("场景") for x in p["props"])


def test_parse_props_paren_protected():
    """括号内的顿号/逗号不得拆散道具。"""
    p = _parse_script(SCRIPT_SUBLINE)
    assert "奶茶（大杯、去冰）" in p["props"]
    assert "旧手机" in p["props"]


# ── _parse_script：分镜块 ─────────────────────────────────────────────────

def test_parse_shots_meta():
    p = _parse_script(SCRIPT_SUBLINE)
    assert len(p["shots"]) == 2
    s1 = p["shots"][0]
    assert s1["no"] == 1
    assert "小巷" in s1["location"]
    assert s1["goal"] == "引出主角困境"
    assert s1["mood"] == "压抑"
    assert s1["bgm"] == "低沉弦乐+风声采样"
    assert s1["duration"] == "15"


def test_parse_shots_key_frames():
    p = _parse_script(SCRIPT_SUBLINE)
    s1 = p["shots"][0]
    descs = [x["desc"] for x in s1["shots"]]
    assert any("背影" in d for d in descs)
    assert any("奶茶特写" in d for d in descs)
    # 关键画面区不得吞对白
    assert not any("旁白" in d for d in descs)
    # 镜头编号解析
    assert s1["shots"][0]["no"] == "1-1"


def test_parse_shots_dialogue():
    p = _parse_script(SCRIPT_SUBLINE)
    dlg = p["shots"][0]["dialogue"]
    speakers = [d["speaker"] for d in dlg]
    assert "[旁白]" in speakers
    assert "林晓" in speakers
    lx = next(d for d in dlg if d["speaker"] == "林晓")
    assert lx["emotion"] == "疲惫"
    assert "就快到了" in lx["line"]


def test_speaker_merged_into_characters_but_not_tags():
    """对白说话人归入人物名单；[旁白] 等标签不算人物。"""
    p = _parse_script(SCRIPT_SUBLINE)
    assert "林晓" in p["characters"]
    assert "旁白" not in p["characters"]
    assert not any("[" in c for c in p["characters"])


def test_parse_empty_script():
    p = _parse_script("")
    assert p == {"characters": [], "props": [], "shots": []}


# ── 数字工具 ───────────────────────────────────────────────────────────────

def test_parse_cn_num():
    assert _parse_cn_num("一") == 1
    assert _parse_cn_num("十") == 10
    assert _parse_cn_num("十一") == 11
    assert _parse_cn_num("二十") == 20
    assert _parse_cn_num("三十") == 30
    assert _parse_cn_num("二十五") == 25
    assert _parse_cn_num("3") == 3
    assert _parse_cn_num(" abc ") == 0


def test_cn_num():
    assert _cn_num(1) == "一"
    assert _cn_num(10) == "十"


# ── _shot_bgm ─────────────────────────────────────────────────────────────

def test_shot_bgm_extract():
    script = "## 分镜1：开场\n- 背景音乐：轻快钢琴\n## 分镜2：发展\n- 背景音乐：紧张鼓点\n"
    assert _shot_bgm(script, 1) == "轻快钢琴"
    assert _shot_bgm(script, 2) == "紧张鼓点"
    assert _shot_bgm(script, 99) == ""
    assert _shot_bgm("", 1) == ""


# ── _cosine / _label ───────────────────────────────────────────────────────

def test_cosine():
    assert abs(_cosine([1.0, 0.0], [1.0, 0.0]) - 1.0) < 1e-6
    assert abs(_cosine([1.0, 0.0], [0.0, 1.0])) < 1e-6
    assert _cosine([], [1.0]) == 0.0
    assert _cosine([1.0], [1.0, 2.0]) == 0.0


def test_label_fallback():
    """注册表存在的类型取 label；不存在的原样返回。"""
    assert _label("definitely_not_a_type") == "definitely_not_a_type"
    assert isinstance(_label("story"), str) and _label("story")


# ── 分发器 ─────────────────────────────────────────────────────────────────

def test_run_action_unknown_action_friendly_error():
    """未知动作：友好中文报错，不抛异常、不 500。"""
    r = asyncio.run(_run_action("scene_x", "no_such_action_xyz", [], {}))
    assert r["ok"] is False
    assert "未支持的动作" in r["error"]


def test_run_action_never_raises():
    """分发器兜底：即便场景不存在，也返回 dict 而非异常栈。"""
    r = asyncio.run(_run_action("scene_not_exist", "generate_music", [], {}))
    assert isinstance(r, dict)
    assert "ok" in r
