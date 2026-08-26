"""场景引擎 REST API（V2.5 规格书 §58）。

路由前缀 /api/scenes（在 main.py 挂载）。
project_id 通过查询参数传递，默认 "default"。
"""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request, File, UploadFile
from fastapi.responses import JSONResponse

from app.config import DATA_DIR
from app.scene import service, plans, templates
from app.scene.actions import execute_action
from app.scene.registry import OBJECT_LIBRARY, registry

router = APIRouter()


def _ok(data: Any = None, **kw: Any) -> dict:
    return {"ok": True, **(data if isinstance(data, dict) else {"data": data}), **kw}


def _err(msg: str, code: int = 400) -> JSONResponse:
    return JSONResponse(status_code=code, content={"ok": False, "error": msg})


def _pid(request: Request) -> str:
    return str(request.query_params.get("project_id") or "default")


# ─────────────────────────────────────────────────────────────────────────────
# Scene 实例 CRUD
# ─────────────────────────────────────────────────────────────────────────────

@router.get("")
async def list_scenes(request: Request):
    scenes = await service.list_scenes(_pid(request))
    return _ok(scenes=scenes)


@router.post("")
async def create_scene(request: Request):
    data = await request.json()
    scene_type = str(data.get("scene_type") or data.get("type") or "").strip()
    if not scene_type:
        return _err("scene_type 必填")
    # 商业化配额（§73 / P2-03）：免费版场景数上限
    ok, msg = await plans.check_scene_quota(_pid(request))
    if not ok:
        return _err(msg)
    sdef = registry.get(scene_type)
    name = str(data.get("name") or (sdef.name if sdef else scene_type))
    sid = await service.create_scene(_pid(request), scene_type, name, data.get("data") or {})
    return _ok(scene=await service.get_scene(sid))


@router.get("/types")
async def scene_types():
    """注册表里的场景定义（前端动态渲染工具条/Inspector 用）。"""
    defs = []
    for s in registry.list():
        d = s.model_dump()
        d["object_library"] = {ot: OBJECT_LIBRARY.get(ot, {"label": ot, "color": "#64748b"}) for ot in s.object_types}
        defs.append(d)
    return _ok(types=defs, object_library=OBJECT_LIBRARY)


@router.get("/templates")
async def scene_templates():
    """场景模板（§39）。一个场景类型即一个模板。"""
    tpls = []
    for s in registry.list():
        tpls.append({
            "id": s.id,
            "version": s.version,
            "name": s.name,
            "category": s.category,
            "canvas": {"type": "infinite"},
            "objects": s.object_types,
            "actions": s.actions,
            "timeline": s.timeline_enabled,
        })
    return _ok(templates=tpls)


@router.get("/plans")
async def get_plans():
    """商业化套餐（§73 / P2-03）。"""
    return _ok(plans=plans.list_plans(), current=await plans.current_plan())


@router.post("/plans")
async def set_plan(request: Request):
    """切换当前套餐（深度增强 #4：套餐可配置，持久化 app_kv）。"""
    data = await request.json()
    pid = str(data.get("plan") or "")
    if not await plans.set_plan(pid):
        return _err(f"未知套餐: {pid}")
    return _ok(current=await plans.current_plan())


@router.get("/{scene_id}")
async def get_scene(scene_id: str):
    scene = await service.get_scene(scene_id)
    if not scene:
        return _err("场景不存在", 404)
    objects = await service.list_objects(scene_id)
    edges = await service.list_edges(scene_id)
    return _ok(scene=scene, objects=objects, edges=edges)


@router.put("/{scene_id}")
async def update_scene(scene_id: str, request: Request):
    data = await request.json()
    scene = await service.update_scene(scene_id, **data)
    if not scene:
        return _err("场景不存在", 404)
    return _ok(scene=scene)


@router.delete("/{scene_id}")
async def delete_scene(scene_id: str):
    await service.delete_scene(scene_id)
    return _ok()


# ─────────────────────────────────────────────────────────────────────────────
# SceneObject CRUD
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{scene_id}/objects")
async def list_objects(scene_id: str):
    return _ok(objects=await service.list_objects(scene_id))


@router.post("/{scene_id}/objects")
async def create_object(scene_id: str, request: Request):
    data = await request.json()
    obj_type = str(data.get("type") or "text")
    # 商业化配额（§73 / P2-03）：单场景对象数上限
    ok, msg = await plans.check_object_quota(scene_id)
    if not ok:
        return _err(msg)
    meta = OBJECT_LIBRARY.get(obj_type, {})
    default_data = dict(meta.get("default_data") or {})
    default_data.update(data.get("data") or {})
    oid = await service.create_object(
        scene_id, obj_type,
        x=float(data.get("x", 0)), y=float(data.get("y", 0)),
        width=float(data.get("width", 300)), height=float(data.get("height", 200)),
        rotation=float(data.get("rotation", 0)), z_index=int(data.get("z_index", 0)),
        data=default_data, oid=(str(data["id"]) if data.get("id") else None),
    )
    return _ok(object=await service.get_object(oid))


@router.put("/{scene_id}/objects/{object_id}")
async def update_object(scene_id: str, object_id: str, request: Request):
    data = await request.json()
    obj = await service.update_object(object_id, **data)
    if not obj:
        return _err("对象不存在", 404)
    return _ok(object=obj)


@router.delete("/{scene_id}/objects/{object_id}")
async def delete_object(scene_id: str, object_id: str):
    await service.delete_object(object_id)
    return _ok()


# ─────────────────────────────────────────────────────────────────────────────
# SceneEdge（连线）
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{scene_id}/edges")
async def create_edge(scene_id: str, request: Request):
    data = await request.json()
    eid = await service.create_edge(
        scene_id, str(data.get("source", "")), str(data.get("target", "")),
        edge_type=str(data.get("edge_type") or data.get("type") or "default"),
        data=data.get("data") or {},
    )
    return _ok(edge={"id": eid})


@router.delete("/{scene_id}/edges/{edge_id}")
async def delete_edge(scene_id: str, edge_id: str):
    await service.delete_edge(edge_id)
    return _ok()


# ─────────────────────────────────────────────────────────────────────────────
# 场景版本（§35）
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{scene_id}/versions")
async def save_version(scene_id: str, request: Request):
    data = await request.json()
    label = str(data.get("label", ""))
    vid = await service.create_version(scene_id, label)
    return _ok(version=await service.get_version(vid))


@router.get("/{scene_id}/versions")
async def list_versions(scene_id: str):
    return _ok(versions=await service.list_versions(scene_id))


@router.post("/{scene_id}/versions/{version_id}/restore")
async def restore_version(scene_id: str, version_id: str):
    scene = await service.restore_version(scene_id, version_id)
    if not scene:
        return _err("版本不存在", 404)
    return _ok(scene=scene)


# ─────────────────────────────────────────────────────────────────────────────
# 素材库（§37/§38，按场景检索，复用 V2 assets 表）
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{scene_id}/assets")
async def list_scene_assets(scene_id: str, request: Request):
    atype = request.query_params.get("type", "")
    return _ok(assets=await service.list_scene_assets(scene_id, atype))


# ─────────────────────────────────────────────────────────────────────────────
# 影视拉片：视频上传 + 拆镜（§14/§15/§68）
# ─────────────────────────────────────────────────────────────────────────────

VIDEO_EXTS = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"}
VIDEO_UPLOAD_DIR = DATA_DIR / "uploads"


@router.post("/{scene_id}/film/upload")
async def upload_film_video(scene_id: str, file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in VIDEO_EXTS:
        return _err(f"不支持的视频格式：{ext or '未知'}")
    data = await file.read()
    if not data:
        return _err("空文件")
    VIDEO_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"film_{uuid.uuid4().hex[:16]}{ext}"
    (VIDEO_UPLOAD_DIR / fname).write_bytes(data)
    return _ok(url=f"/uploads/{fname}")


@router.post("/{scene_id}/film/analyze")
async def analyze_film(scene_id: str, request: Request):
    data = await request.json()
    result = await execute_action(scene_id, "analyze_video", [], {"video_url": str(data.get("video_url", ""))})
    if not result.get("ok"):
        return _err(result.get("error", "拆镜失败"))
    return _ok(**result)


# ─────────────────────────────────────────────────────────────────────────────
# 营销模板（§26 / P2-01）
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{scene_id}/templates")
async def scene_marketing_templates(scene_id: str, request: Request):
    category = request.query_params.get("category", "")
    return _ok(templates=templates.list_templates(category))


@router.post("/{scene_id}/templates/{template_id}/apply")
async def apply_marketing_template(scene_id: str, template_id: str):
    try:
        created = await templates.apply_template(scene_id, template_id)
    except ValueError as exc:
        return _err(str(exc))
    return _ok(created=created, message=f"套用模板成功（{len(created)} 个对象）")


# ─────────────────────────────────────────────────────────────────────────────
# 异步任务进度（§54 / P2-06）
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{scene_id}/tasks/{task_id}")
async def get_task_progress(scene_id: str, task_id: str):
    from app import db
    row = await db.fetchrow(
        "SELECT id, status, done, total, type FROM tasks WHERE id=$1 AND canvas_id=$2",
        task_id, scene_id,
    )
    if not row:
        return _err("任务不存在", 404)
    return _ok(task=dict(row))


# ─────────────────────────────────────────────────────────────────────────────
# 动作 / 分析 / 生成 / 批量
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{scene_id}/actions")
async def run_action(scene_id: str, request: Request):
    data = await request.json()
    action = str(data.get("action") or "").strip()
    if not action:
        return _err("action 必填")
    result = await execute_action(scene_id, action, data.get("object_ids") or [], data.get("parameters") or {})
    if not result.get("ok"):
        return _err(result.get("error", "动作执行失败"))
    return _ok(**result)


@router.post("/{scene_id}/analyze")
async def analyze(scene_id: str, request: Request):
    data = await request.json()
    # analyze 默认走 analyze_product / analyze_shot，由场景类型决定
    scene = await service.get_scene(scene_id)
    action = "analyze_shot" if (scene and scene.get("scene_type") == "film-analysis") else "analyze_product"
    result = await execute_action(scene_id, action, data.get("object_ids") or [], data.get("parameters") or {})
    if not result.get("ok"):
        return _err(result.get("error", "分析失败"))
    return _ok(**result)


@router.post("/{scene_id}/generate")
async def generate(scene_id: str, request: Request):
    data = await request.json()
    action = str(data.get("action") or "generate_main_image")
    result = await execute_action(scene_id, action, data.get("object_ids") or [], data.get("parameters") or {})
    if not result.get("ok"):
        return _err(result.get("error", "生成失败"))
    return _ok(**result)


@router.post("/{scene_id}/batch")
async def batch_generate(scene_id: str, request: Request):
    data = await request.json()
    result = await execute_action(scene_id, "batch_generate", data.get("object_ids") or [], data.get("parameters") or {})
    if not result.get("ok"):
        return _err(result.get("error", "批量生成失败"))
    return _ok(**result)
