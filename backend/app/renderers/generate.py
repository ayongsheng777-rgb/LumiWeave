"""统一媒体生成路由（节点按钮 + engine + MCP 共用）。

把「云端 API / 本地 ComfyUI / 云端 video-api（MiniMax 多参考）」几种出图/出视频
方式收敛到一个入口，正确读取 render_mode / provider_id / model / renderer_id，
并返回结构化 logs。

生视频三种模式（按 params 自动判定）：
  - 文生视频：无 image_url / reference
  - 首帧生视频：单个 image_url（走云端 I2V 或 ComfyUI）
  - 多参考生视频：多张 reference_images（角色图+场景图+道具图）→ 走 video-api 渲染器（MiniMax H3）
"""
from __future__ import annotations

import time
from typing import Any


def _refs(params: dict[str, Any]) -> list[str]:
    raw = params.get("reference_images") or params.get("reference") or []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple)):
        return []
    return [str(u).strip() for u in raw if u and str(u).strip()]


async def _render_via_video_api(params: dict[str, Any], logs: list[dict[str, Any]]) -> dict[str, Any]:
    """走云端 video-api 渲染器（MiniMax H3 多参考图 / 可灵 / 硅基流动视频）。"""
    from app.renderers import renderer_registry
    r = None
    for rr in renderer_registry._renderers.values():
        if rr.cfg.type == "video-api" and rr.cfg.enabled:
            r = rr
            break
    if r is None:
        return {"ok": False, "error": "多参考生视频需要「video-api」渲染器（如 MiniMax H3），请在「设置-出图配置」添加并启用", "logs": logs}
    logs.append({"step": "route", "message": f"路由：video-api 渲染器（{r.cfg.name}）", "renderer_id": r.cfg.id})
    t0 = time.monotonic()
    try:
        result = await r.generate({"params": params})
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"video-api 执行异常：{exc}", "logs": logs + [{"step": "error", "message": str(exc)}]}
    duration_ms = int((time.monotonic() - t0) * 1000)
    result["logs"] = logs + (result.get("logs") or [])
    return result


async def render_media(
    kind: str,
    params: dict[str, Any],
    *,
    render_mode: str = "comfyui",
    provider_id: str = "",
    model: str = "",
    renderer_id: str = "",
) -> dict[str, Any]:
    """kind: 'image' | 'video'。params 含 prompt/negative/ratio/seed/steps/duration/reference_images 等。"""
    kind = "video" if kind == "video" else "image"
    logs: list[dict[str, Any]] = []
    refs = _refs(params)
    image_url = str(params.get("image_url") or "")

    # ── 多参考生视频：多张参考图走 video-api 渲染器（MiniMax） ──────
    if kind == "video" and len(refs) > 1:
        return await _render_via_video_api(params, logs)

    # ── 云端 API ────────────────────────────────────────────────
    if render_mode == "cloud":
        # 智能路由：provider_id 为空或 "auto" 时，按能力+质量/速度/成本评分自动选路
        actual_provider_id = provider_id
        if not provider_id or provider_id == "auto":
            logs.append({"step": "route", "message": "智能路由：自动匹配最佳云端 Provider"})
            from app.providers.service import route as provider_route
            task_type = "image" if kind == "image" else "video"
            try:
                chain = await provider_route(task_type, quality=1.0, speed=1.0, cost=1.0, limit=1)
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"智能路由查询失败：{exc}", "logs": logs}
            if not chain:
                return {"ok": False, "error": f"未找到可用的云端 {task_type} Provider，请先在「Provider 管理」中配置并启用", "logs": logs}
            actual_provider_id = str(chain[0].get("id") or "")
            logs.append({"step": "route", "message": f"智能路由选中：{chain[0].get('name') or actual_provider_id}（评分 {chain[0].get('_score')}）", "provider_id": actual_provider_id})
        else:
            logs.append({"step": "route", "message": f"路由：云端 API（{actual_provider_id}）"})
        prompt = str(params.get("prompt") or "").strip()
        if not prompt:
            return {"ok": False, "error": "提示词为空", "logs": logs}
        negative = str(params.get("negative") or "")
        ratio = str(params.get("ratio") or "16:9")
        native = params.get("native") if isinstance(params.get("native"), dict) else {}
        if kind == "image":
            from app.providers.cloud_gen import cloud_image_generate
            size = str(params.get("size") or "1024x1024")
            steps = int(params.get("steps") or 20)
            res = await cloud_image_generate(
                actual_provider_id, prompt, negative=negative, size=size, steps=steps,
                model=model, reference_images=refs, native=native,
            )
        else:
            from app.providers.cloud_gen import cloud_video_generate
            first = image_url or (refs[0] if refs else "")
            res = await cloud_video_generate(
                actual_provider_id, prompt,
                image_url=first,
                duration=int(params.get("duration") or 10),
                ratio=ratio, negative=negative, model=model, native=native,
            )
        res["logs"] = logs + (res.get("logs") or [])
        return res

    # ── 本地 ComfyUI ────────────────────────────────────────────
    logs.append({"step": "route", "message": "路由：本地 ComfyUI"})
    from app.renderers import renderer_registry

    r = None
    if renderer_id:
        r = renderer_registry.get(renderer_id)
    if r is None:
        # 自动挑第一个启用的 comfyui 渲染器（endpoint 可填局域网地址）
        for rr in renderer_registry._renderers.values():
            if rr.cfg.type == "comfyui" and rr.cfg.enabled and rr.cfg.endpoint:
                r = rr
                break
    if r is None:
        return {
            "ok": False,
            "error": "未找到可用的 ComfyUI 渲染器，请在「设置-出图配置」添加并启用（endpoint 填 ComfyUI 地址，局域网填 http://192.168.x.x:8188）",
            "logs": logs,
        }
    logs.append({"step": "renderer", "message": f"渲染器：{r.cfg.name}（{r.cfg.id}）", "renderer_id": r.cfg.id, "endpoint": r.cfg.endpoint})

    from app.renderers.workflow_builder import build_workflow
    mode = "text2video" if kind == "video" else "text2image"
    workflow = build_workflow(params, mode, model=model)
    logs.append({"step": "build", "message": f"已构建 {mode} 工作流", "model": model or "默认"})

    t0 = time.monotonic()
    try:
        result = await r.generate(workflow)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"ComfyUI 执行异常：{exc}", "logs": logs + [{"step": "error", "message": str(exc)}]}

    duration_ms = int((time.monotonic() - t0) * 1000)
    if result.get("ok") is False:
        logs.append({"step": "error", "message": f"生成失败：{result.get('error')}", "duration_ms": duration_ms})
    else:
        logs.append({"step": "done", "message": "ComfyUI 生成完成", "duration_ms": duration_ms})
    result["logs"] = logs
    return result
