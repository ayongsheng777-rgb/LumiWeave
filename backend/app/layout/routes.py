"""排版引擎 REST API（V2 Issue #008）。"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.canvas import service as canvas_service
from app.layout import engine

router = APIRouter()


@router.post("/apply")
async def apply_layout(request: Request):
    data = await request.json()
    project_id = str(data.get("canvas_id", "") or data.get("project_id", ""))
    template = str(data.get("template", "poster"))
    if template not in engine.TEMPLATES:
        return JSONResponse(status_code=400, content={"error": f"未知模板: {template}"})

    objects = await canvas_service.list_objects(project_id)
    if not objects:
        return JSONResponse(status_code=404, content={"error": "画布为空"})

    for o in objects:
        o["position"] = o.get("position") or {"x": 0, "y": 0}
        o["size"] = o.get("size") or {}

    result = engine.apply_template(objects, template)

    # 写回 position/size
    for o in result["objects"]:
        await canvas_service.update_object(
            o["id"], position=o["position"], size=o["size"]
        )

    return {"width": result["width"], "height": result["height"],
            "objects": result["objects"]}
