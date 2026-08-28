"""AI 导演台编排器（Director Orchestrator）。

把「故事节点 → 影视生产骨架」串成一条可跟踪的异步任务：
    INIT → ANALYZING → ASSET_GENERATING → SHOT_GENERATING → REVIEWING → APPROVED / FAILED

「骨架搭建」模式（阿勇 2026-08-28 定稿）：
  故事节点 ──► 分镜脚本节点(storyboard, 13 列全字段)
                  ├─► 人物/道具/场景 图片生成节点（image，purpose 标注，待生成）
                  └─► 分镜视频生成节点（video，每镜一个，带素材库连线，待生成）
  所有节点一次搭好、字段齐全、无成品（url 为空），用户逐个审核后点「生成」。

每一步更新 director_task 的 status / progress / current_step / log / result，
前端 DirectorPanel 轮询展示进度与结果审核。
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from app import db
from app.director import service as ds
from app.scene import service as ss

# ─────────────────────────────────────────────────────────────────────────────
# LLM 工具（复用 scene.actions 的 chat_full 封装）
# ─────────────────────────────────────────────────────────────────────────────

async def _chat_json(system: str, user: str) -> dict | None:
    from app.scene.actions import _chat_full
    r = await _chat_full(system, user, json_mode=True, temperature=0.4, max_tokens=3000)
    if not r.ok or not r.content:
        return None
    m = re.search(r"\{.*\}", r.content, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:  # noqa: BLE001
        return None


def _place(existing: list[dict], idx: int, row: int = 0) -> tuple[float, float]:
    base_y = 80 + row * 420
    return 80 + (idx % 5) * 340, base_y


# ─────────────────────────────────────────────────────────────────────────────
# 步骤 1：分析故事 + 时长/分镜数约束
# ─────────────────────────────────────────────────────────────────────────────

async def _step_analyze(task_id: str, scene_id: str, story_id: str, opts: dict | None = None) -> dict:
    """ANALYZING：取故事上下文（三幕式/剧本/梗概）+ duration/shotCount 约束。"""
    opts = opts or {}
    await ds.update_task(task_id, status="ANALYZING", progress=10,
                         current_step="读取故事", append_log={"step": "analyze", "message": "读取故事节点…"})
    obj = await ss.get_object(story_id) if story_id else None
    ctx = ""
    duration = int(opts.get("duration") or 0)
    shot_count = int(opts.get("shot_count") or 0)
    if obj and obj["object_type"] == "story":
        d = obj["data"]
        ctx = (str(d.get("script") or "") or str(d.get("story") or "")
               or str(d.get("summary") or "") or str(d.get("text") or "")).strip()
        if not duration:
            try:
                duration = int(float(d.get("duration") or 0))
            except Exception:  # noqa: BLE001
                duration = 0
        if not shot_count:
            try:
                shot_count = int(float(d.get("shotCount") or 0))
            except Exception:  # noqa: BLE001
                shot_count = 0
    if not ctx:
        # 场景内找第一个 story
        for o in await ss.list_objects(scene_id):
            if o["object_type"] == "story":
                story_id = o["id"]
                d = o["data"]
                ctx = (str(d.get("script") or "") or str(d.get("story") or "")
                       or str(d.get("summary") or "") or str(d.get("text") or "")).strip()
                if not duration:
                    try:
                        duration = int(float(d.get("duration") or 0))
                    except Exception:  # noqa: BLE001
                        duration = 0
                if not shot_count:
                    try:
                        shot_count = int(float(d.get("shotCount") or 0))
                    except Exception:  # noqa: BLE001
                        shot_count = 0
                break
    if not ctx:
        raise RuntimeError("没有可用的故事——请先「从文本生成故事」或填写剧情节点")
    if not shot_count:
        shot_count = 6
    if not duration:
        duration = shot_count * 5
    await ds.update_task(task_id, progress=15, current_step="故事就绪",
                         append_log={"step": "analyze",
                                     "message": f"故事就绪（{len(ctx)} 字）· 目标 {duration} 秒 / {shot_count} 分镜"})
    return {"story_id": story_id, "ctx": ctx, "duration": duration, "shot_count": shot_count}


# ─────────────────────────────────────────────────────────────────────────────
# 步骤 2：分镜生成（严格 N 镜、13 列全字段）
# ─────────────────────────────────────────────────────────────────────────────

async def _step_storyboard(task_id: str, scene_id: str, story_id: str,
                           duration: int, shot_count: int) -> dict:
    """SHOT_GENERATING：全字段分镜 → 写回 story + 返回 shots。"""
    await ds.update_task(task_id, status="SHOT_GENERATING", progress=45,
                         current_step="生成分镜", append_log={"step": "shots", "message": "AI 生成全字段分镜…"})
    from app.scene.actions import _act_generate_storyboard
    r = await _act_generate_storyboard(scene_id, [story_id],
                                       {"duration": duration, "shot_count": shot_count})
    if not r.get("ok"):
        raise RuntimeError(r.get("error") or "分镜生成失败")
    shots = r.get("storyboard") or []
    await ds.update_task(task_id, progress=60, current_step=f"分镜就绪（{len(shots)}）",
                         append_log={"step": "shots", "message": f"分镜就绪：{len(shots)} 个镜头（目标 {shot_count}）"})
    return {"shots": shots}


# ─────────────────────────────────────────────────────────────────────────────
# 资产提示词生成（LLM：为全局资产补出图提示词）
# ─────────────────────────────────────────────────────────────────────────────

async def _gen_asset_prompts(ctx: str, char_names: list[str], scene_names: list[str],
                             prop_names: list[str]) -> dict:
    """LLM 一次生成全部资产出图提示词（省 token）。失败返回空 dict，由调用方兜底拼接。"""
    sys = (
        "你是影视美术指导。为下列影视资产各写一条可直接用于 AI 出图的中文提示词（含风格/光影/细节），"
        "严格只输出 JSON：\n"
        '{\n'
        '  "characters": {"人物名": "人物视觉提示词(外貌+服装+气质)"},\n'
        '  "scenes": {"场景名": "场景视觉提示词(地点+氛围+光线+美术风格)"},\n'
        '  "props": {"道具名": "道具视觉提示词(外观+质感+特征)"}\n'
        "}\n"
        "要求：全部中文，贴合故事基调，电影感。"
    )
    user = f"【故事】\n{ctx[:2500]}\n\n【人物】{'、'.join(char_names) or '无'}\n【场景】{'、'.join(scene_names) or '无'}\n【道具】{'、'.join(prop_names) or '无'}"
    r = await _chat_json(sys, user)
    if not r:
        return {}
    out: dict[str, dict[str, str]] = {"characters": {}, "scenes": {}, "props": {}}
    for key in ("characters", "scenes", "props"):
        block = r.get(key)
        if isinstance(block, dict):
            for k, v in block.items():
                if isinstance(v, dict):
                    v = str(v.get("prompt") or v.get("description") or "")
                out[key][str(k).strip()] = str(v or "").strip()
    return out


def _extract_assets(shots: list[dict]) -> tuple[list[str], list[str], list[str]]:
    """从分镜表提取全局人物/场景/道具名（去重保序）。"""
    chars: list[str] = []
    scenes: list[str] = []
    props: list[str] = []
    for s in shots:
        c = str(s.get("character") or "").strip()
        if c and c not in chars:
            chars.append(c)
        sc = str(s.get("scene") or "").strip()
        if sc and sc not in scenes:
            scenes.append(sc)
        for p in (s.get("props") or []):
            name = str(p).strip()
            if name and name not in props:
                props.append(name)
    return chars, scenes, props


# ─────────────────────────────────────────────────────────────────────────────
# 步骤 3：骨架搭建（storyboard + image 资产节点 + video 分镜节点 + 全链连线）
# ─────────────────────────────────────────────────────────────────────────────

async def build_film_skeleton(scene_id: str, story_id: str, shots: list[dict],
                              opts: dict | None = None,
                              assets: dict | None = None) -> dict:
    """影视生产骨架搭建（导演台 + MCP 共用）。

    1) storyboard 节点：13 列全字段分镜表（有则更新、无则创建）
    2) image 资产节点：从分镜去重提取人物/场景/道具 → 各建一个图片生成节点
       （purpose=人物/道具/场景，title=资产名，prompt=出图提示词，url="" 待生成）
    3) video 分镜节点：每个分镜一个视频生成节点（带镜头内容/提示词/音频配置，url="" 待生成）
    4) 连线：story→storyboard→image、storyboard→video、video→该镜头资产图（供素材库）
    """
    opts = opts or {}
    shots = shots or []
    existing = await ss.list_objects(scene_id)
    story_obj = next((o for o in existing if o["object_type"] == "story"), None)
    story_oid = story_obj["id"] if story_obj else (story_id or "")

    # 1) storyboard 节点
    sb_obj = next((o for o in existing if o["object_type"] == "storyboard"), None)
    if sb_obj:
        await ss.update_object(sb_obj["id"], data={**sb_obj["data"], "title": "分镜脚本", "shots": shots})
        sb_oid = sb_obj["id"]
    else:
        sb_oid = await ss.create_object(scene_id, "storyboard", x=80, y=80,
                                        width=420, height=520,
                                        data={"title": "分镜脚本", "shots": shots})
    if story_oid and sb_oid:
        try:
            await ss.create_edge(scene_id, story_oid, sb_oid, "default", {"kind": "storyboard"})
        except Exception:  # noqa: BLE001
            pass

    # 2) image 资产节点（去重提取 + LLM 提示词）
    char_names, scene_names, prop_names = _extract_assets(shots)
    prompts = (assets or {}) or await _gen_asset_prompts(
        str(story_obj["data"].get("script") or "")[:2500] if story_obj else "",
        char_names, scene_names, prop_names,
    )
    pchars = prompts.get("characters") or {}
    pscenes = prompts.get("scenes") or {}
    pprops = prompts.get("props") or {}
    image_map: dict[str, dict[str, str]] = {"人物": {}, "场景": {}, "道具": {}}
    image_ids: list[str] = []
    idx = 0
    for name in char_names:
        prompt = pchars.get(name) or f"电影感人物定妆图，{name}，符合故事基调，cinematic lighting"
        nid = await ss.create_object(scene_id, "image",
                                     x=80 + (idx % 5) * 340, y=300, width=280, height=280,
                                     data={"title": name, "selected": name, "name": name,
                                           "purpose": "人物", "prompt": prompt, "url": "",
                                           "model": "", "size": "1024x1024"})
        image_map["人物"][name] = nid
        image_ids.append(nid)
        idx += 1
    for name in scene_names:
        prompt = pscenes.get(name) or f"电影感场景概念图，{name}，符合故事氛围，cinematic atmosphere"
        nid = await ss.create_object(scene_id, "image",
                                     x=80 + (idx % 5) * 340, y=300, width=280, height=280,
                                     data={"title": name, "selected": name, "name": name,
                                           "purpose": "场景", "prompt": prompt, "url": "",
                                           "model": "", "size": "1024x1024"})
        image_map["场景"][name] = nid
        image_ids.append(nid)
        idx += 1
    for name in prop_names:
        prompt = pprops.get(name) or f"电影感道具特写图，{name}，细节丰富，cinematic lighting"
        nid = await ss.create_object(scene_id, "image",
                                     x=80 + (idx % 5) * 340, y=300, width=280, height=280,
                                     data={"title": name, "selected": name, "name": name,
                                           "purpose": "道具", "prompt": prompt, "url": "",
                                           "model": "", "size": "1024x1024"})
        image_map["道具"][name] = nid
        image_ids.append(nid)
        idx += 1
    # storyboard → image 资产连线
    for nid in image_ids:
        try:
            await ss.create_edge(scene_id, sb_oid, nid, "default", {"kind": "asset"})
        except Exception:  # noqa: BLE001
            pass

    # 3) video 分镜节点（每镜一个）
    video_ids: list[str] = []
    for i, s in enumerate(shots):
        if not isinstance(s, dict):
            continue
        dlg = s.get("dialogue") or ""
        sfx = s.get("sound_effect") or ""
        vdata = {
            "prompt": str(s.get("prompt") or s.get("description") or ""),
            "url": "",
            "duration": int(float(s.get("duration") or 5)),
            "shot_no": s.get("shot_no", i + 1),
            "desc": str(s.get("description") or ""),
            "aspect_ratio": str(opts.get("ratio") or "16:9"),
            "camera_motion": str(s.get("camera_motion") or "固定镜头"),
            "resolution": str(opts.get("resolution") or "1080p"),
            "style": str(opts.get("style") or ""),
            "dialogue_script": [str(dlg)] if dlg else [],
            "sfx_desc": [str(sfx)] if sfx else [],
            "subtitle_enabled": False,
        }
        vid = await ss.create_object(scene_id, "video",
                                     x=80 + (i % 5) * 340, y=720, width=320, height=280,
                                     data=vdata)
        video_ids.append(vid)
        # storyboard → video 连线
        try:
            await ss.create_edge(scene_id, sb_oid, vid, "default", {"kind": "shot_video"})
        except Exception:  # noqa: BLE001
            pass
        # video → 该镜头用到的资产图（素材库同源：SceneVideoEditor 读 e.target===id 的 image）
        # 方向语义：左进右出 —— image 资产作为 source（输出）流入 video 节点（target 接收做参考）
        for name in _shot_asset_names(s):
            for purpose, by_name in image_map.items():
                if name in by_name:
                    try:
                        await ss.create_edge(scene_id, by_name[name], vid, "default",
                                             {"kind": "asset_ref", "purpose": purpose})
                    except Exception:  # noqa: BLE001
                        pass

    return {"storyboard_id": sb_oid, "image_ids": image_ids, "video_ids": video_ids,
            "assets": {"characters": char_names, "scenes": scene_names, "props": prop_names},
            "shots": shots}


def _shot_asset_names(shot: dict) -> list[str]:
    """该镜头用到的资产名：character / scene / props。"""
    out: list[str] = []
    for key in ("character", "scene"):
        name = str(shot.get(key) or "").strip()
        if name and name not in out:
            out.append(name)
    for p in (shot.get("props") or []):
        name = str(p).strip()
        if name and name not in out:
            out.append(name)
    return out


async def _step_skeleton(task_id: str, scene_id: str, story_id: str,
                         shots: list[dict], ctx: str, opts: dict | None = None) -> dict:
    """ASSET_GENERATING：骨架搭建（storyboard + 资产图节点 + 分镜视频节点 + 连线）。"""
    opts = opts or {}
    await ds.update_task(task_id, status="ASSET_GENERATING", progress=70,
                         current_step="搭建生产骨架", append_log={"step": "assets", "message": "搭建节点骨架（资产图/分镜视频）…"})
    result = await build_film_skeleton(scene_id, story_id, shots, opts)
    char_n = len(result["assets"]["characters"])
    scene_n = len(result["assets"]["scenes"])
    prop_n = len(result["assets"]["props"])
    await ds.update_task(task_id, progress=90, current_step="骨架就绪",
                         append_log={"step": "assets",
                                     "message": f"骨架就绪：人物图{char_n} / 场景图{scene_n} / 道具图{prop_n} / 分镜视频{len(result['video_ids'])}"},
                         result={"assets": result["assets"],
                                 "shots": shots,
                                 "video_ids": result["video_ids"],
                                 "image_ids": result["image_ids"]})
    return result


# ─────────────────────────────────────────────────────────────────────────────
# 编排入口
# ─────────────────────────────────────────────────────────────────────────────

async def run_director(task_id: str, scene_id: str, story_id: str = "",
                       opts: dict | None = None) -> None:
    """异步执行导演编排（骨架搭建模式，独立任务，不阻塞请求）。"""
    opts = opts or {}
    try:
        await ds.update_task(task_id, status="ANALYZING", current_step="启动导演编排",
                             append_log={"step": "start", "message": "导演台启动…"})
        # 1) 分析故事 + 时长/分镜数
        info = await _step_analyze(task_id, scene_id, story_id, opts)
        # 2) 分镜（严格 N 镜 13 列）
        sb = await _step_storyboard(task_id, scene_id, info["story_id"],
                                    info["duration"], info["shot_count"])
        # 3) 骨架搭建（storyboard + 资产图 + 分镜视频节点 + 连线）
        skel = await _step_skeleton(task_id, scene_id, info["story_id"],
                                    sb["shots"], info["ctx"], opts)
        # 4) 完成 → 待人工审核
        await ds.update_task(task_id, status="REVIEWING", progress=100,
                             current_step="待人工审核",
                             append_log={"step": "done",
                                         "message": "骨架搭建完成：请逐个双击节点审核，达到要求后点「生成」出图/出视频"})
    except Exception as exc:  # noqa: BLE001
        try:
            await ds.update_task(task_id, status="FAILED",
                                 append_log={"step": "error", "message": f"编排失败：{exc}"})
        except Exception:  # noqa: BLE001
            pass
