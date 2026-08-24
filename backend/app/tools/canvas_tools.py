"""AI Canvas Tool（V2 Issue #003）：让 AI 能操作画布。

提供 canvas.create/list/update/delete/move/resize/layout 等工具，
通过 register_tool 接入平台 Skill 运行时，供 Agent 在对话中调用。
"""
from __future__ import annotations

import json
from typing import Any

from app.canvas import service as canvas_service
from app.layout import engine as layout_engine


def _ctx_project(args: dict[str, Any], context: dict[str, Any]) -> str:
    return str(args.get("project_id", "") or context.get("project_id", "") or "")


async def _canvas_create(args: dict[str, Any], context: dict[str, Any]) -> str:
    oid = await canvas_service.create_object(
        project_id=_ctx_project(args, context),
        obj_type=str(args.get("type", "text")),
        content=args.get("content") or {},
        position=args.get("position") or {},
        size=args.get("size") or {},
        layer=int(args.get("layer", 0)),
        metadata=args.get("metadata") or {},
    )
    return json.dumps({"ok": True, "id": oid}, ensure_ascii=False)


async def _canvas_list(args: dict[str, Any], context: dict[str, Any]) -> str:
    objects = await canvas_service.list_objects(_ctx_project(args, context))
    return json.dumps({"ok": True, "objects": objects}, ensure_ascii=False)


async def _canvas_update(args: dict[str, Any], context: dict[str, Any]) -> str:
    oid = str(args.get("id", ""))
    obj = await canvas_service.update_object(oid, **{k: v for k, v in args.items() if k != "id"})
    if not obj:
        return json.dumps({"ok": False, "error": "对象不存在"}, ensure_ascii=False)
    return json.dumps({"ok": True, "object": obj}, ensure_ascii=False)


async def _canvas_delete(args: dict[str, Any], context: dict[str, Any]) -> str:
    await canvas_service.delete_object(str(args.get("id", "")))
    return json.dumps({"ok": True}, ensure_ascii=False)


async def _canvas_move(args: dict[str, Any], context: dict[str, Any]) -> str:
    oid = str(args.get("id", ""))
    obj = await canvas_service.get_object(oid)
    if not obj:
        return json.dumps({"ok": False, "error": "对象不存在"}, ensure_ascii=False)
    pos = dict(obj.get("position") or {"x": 0, "y": 0})
    if "x" in args:
        pos["x"] = float(args["x"])
    if "y" in args:
        pos["y"] = float(args["y"])
    await canvas_service.update_object(oid, position=pos)
    return json.dumps({"ok": True}, ensure_ascii=False)


async def _canvas_resize(args: dict[str, Any], context: dict[str, Any]) -> str:
    oid = str(args.get("id", ""))
    obj = await canvas_service.get_object(oid)
    if not obj:
        return json.dumps({"ok": False, "error": "对象不存在"}, ensure_ascii=False)
    size = dict(obj.get("size") or {})
    if "width" in args:
        size["width"] = float(args["width"])
    if "height" in args:
        size["height"] = float(args["height"])
    await canvas_service.update_object(oid, size=size)
    return json.dumps({"ok": True}, ensure_ascii=False)


async def _canvas_layout(args: dict[str, Any], context: dict[str, Any]) -> str:
    template = str(args.get("template", "poster"))
    if template not in layout_engine.TEMPLATES:
        return json.dumps({"ok": False, "error": f"未知模板: {template}"}, ensure_ascii=False)
    objects = await canvas_service.list_objects(_ctx_project(args, context))
    for o in objects:
        o["position"] = o.get("position") or {"x": 0, "y": 0}
        o["size"] = o.get("size") or {}
    result = layout_engine.apply_template(objects, template)
    for o in result["objects"]:
        await canvas_service.update_object(o["id"], position=o["position"], size=o["size"])
    return json.dumps(
        {"ok": True, "width": result["width"], "height": result["height"],
         "count": len(result["objects"])},
        ensure_ascii=False,
    )


CANVAS_TOOLS: dict[str, Any] = {
    "canvas.create": _canvas_create,
    "canvas.list": _canvas_list,
    "canvas.update": _canvas_update,
    "canvas.delete": _canvas_delete,
    "canvas.move": _canvas_move,
    "canvas.resize": _canvas_resize,
    "canvas.layout": _canvas_layout,
}

# 供 AI 参考的工具清单（注入 system prompt 用）
CANVAS_TOOL_DESCRIPTIONS = [
    {"name": "canvas.create", "desc": "在画布创建对象", "params": "type(text/image/note/prompt/ai_result), content, position{x,y}, size{width,height}, project_id"},
    {"name": "canvas.list", "desc": "读取画布现有对象", "params": "project_id"},
    {"name": "canvas.update", "desc": "更新对象内容/位置/尺寸", "params": "id, content/position/size"},
    {"name": "canvas.delete", "desc": "删除对象", "params": "id"},
    {"name": "canvas.move", "desc": "移动对象", "params": "id, x, y"},
    {"name": "canvas.resize", "desc": "调整对象尺寸", "params": "id, width, height"},
    {"name": "canvas.layout", "desc": "按模板自动排版", "params": "project_id, template(poster/xiaohongshu/ppt/ecommerce/magazine)"},
]


async def execute_canvas_tool(name: str, args: dict[str, Any], context: dict[str, Any]) -> str:
    """统一入口：供 Agent / Orchestrator 直接调用画布工具。"""
    fn = CANVAS_TOOLS.get(name)
    if not fn:
        return json.dumps({"ok": False, "error": f"未知画布工具: {name}"}, ensure_ascii=False)
    return await fn(args, context)


def register_canvas_tools() -> None:
    """把画布工具注册进平台 Skill tool 运行时（runtime=tool 的 skill 可调用）。"""
    from app.skills.runtime import register_tool
    for name, fn in CANVAS_TOOLS.items():
        register_tool(name, fn)
