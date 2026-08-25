"""画布对象 REST API（V2 Issue #002）。"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.canvas import service

router = APIRouter()


@router.post("/object")
async def create_object(request: Request):
    data = await request.json()
    obj_type = str(data.get("type", "text"))
    if obj_type not in service.OBJECT_TYPES:
        return JSONResponse(status_code=400, content={"error": f"不支持的对象类型: {obj_type}"})
    oid = await service.create_object(
        project_id=str(data.get("project_id", "")),
        obj_type=obj_type,
        content=data.get("content") or {},
        position=data.get("position") or {},
        size=data.get("size") or {},
        layer=int(data.get("layer", 0)),
        metadata=data.get("metadata") or {},
    )
    return {"id": oid}


@router.post("/object/batch")
async def batch_create(request: Request):
    data = await request.json()
    objects = data.get("objects")
    if not isinstance(objects, list):
        return JSONResponse(status_code=400, content={"error": "objects 必须是数组"})
    ids = await service.batch_create(objects, str(data.get("project_id", "")))
    return {"ids": ids}


@router.get("/{project_id}")
async def list_objects(project_id: str):
    objects = await service.list_objects(project_id)
    return {"objects": objects}


@router.put("/object/{oid}")
async def update_object(oid: str, request: Request):
    data = await request.json()
    obj = await service.update_object(oid, **data)
    if not obj:
        return JSONResponse(status_code=404, content={"error": "对象不存在"})
    return obj


@router.delete("/object/{oid}")
async def delete_object(oid: str):
    await service.delete_object(oid)
    return {"ok": True}


# ==================== 连线（Edge）与 Graph ====================

@router.get("/{project_id}/graph")
async def get_graph(project_id: str):
    """返回画布完整图（节点 + 连线），供刷新恢复与 AI 自动搭建。"""
    objects = await service.list_objects(project_id)
    edges = await service.list_edges(project_id)
    return {"nodes": objects, "edges": edges}


@router.post("/edge")
async def create_edge(request: Request):
    data = await request.json()
    eid = await service.create_edge(
        project_id=str(data.get("project_id", "")),
        source=str(data.get("source", "")),
        target=str(data.get("target", "")),
        source_handle=data.get("source_handle"),
        target_handle=data.get("target_handle"),
        edge_type=str(data.get("type", "workflow")),
        metadata=data.get("metadata") or {},
    )
    return {"id": eid}


@router.delete("/edge/{edge_id}")
async def delete_edge(edge_id: str):
    await service.delete_edge(edge_id)
    return {"ok": True}


@router.post("/{project_id}/graph/save")
async def save_graph(project_id: str, request: Request):
    """整体保存画布（先删旧再建新，保证 nodes + edges 一致）。"""
    data = await request.json()
    nodes = data.get("nodes") or []
    edges = data.get("edges") or []
    for o in await service.list_objects(project_id):
        await service.delete_object(o["id"])
    for e in await service.list_edges(project_id):
        await service.delete_edge(e["id"])
    for n in nodes:
        await service.create_object(
            project_id,
            str(n.get("type", "text")),
            n.get("content") or n.get("data") or {},
            n.get("position") or {"x": 0, "y": 0},
            n.get("size") or {},
            int(n.get("layer", 0)),
            n.get("metadata") or {},
            oid=str(n.get("id") or ""),
        )
    for e in edges:
        await service.create_edge(
            project_id, str(e.get("source", "")), str(e.get("target", "")),
            e.get("source_handle"), e.get("target_handle"),
        )
    return {"ok": True, "nodes": len(nodes), "edges": len(edges)}


@router.post("/build")
async def build_workflow(request: Request):
    """AI 自动搭建工作流：输入一句话，AI 生成 nodes + edges。"""
    data = await request.json()
    prompt = str(data.get("prompt") or "").strip()
    if not prompt:
        return JSONResponse(status_code=400, content={"error": "prompt 必填"})
    from app.ai.client import chat_json
    result = await chat_json(
        system=(
            "你是工作流规划器。根据用户需求生成节点式工作流，直接输出 JSON。"
            "节点类型：input(故事输入)、analyze(AI解析)、asset(资产)、image(生图)、video(生视频)、"
            "prompt(提示词)、skill(技能)、agent(智能体)、output(输出)。"
            '格式：{"nodes":[{"id":"n1","type":"input","data":{"text":"..."}}],'
            '"edges":[{"source":"n1","target":"n2"}]}。'
            "id 按 n1/n2 顺序，边按数据流方向连接，data 里填好默认参数。"
        ),
        user=prompt,
        temperature=0.3, max_tokens=2000, scenario="canvas_build",
    )
    if not result or not isinstance(result, dict):
        return JSONResponse(status_code=500, content={"error": "AI 生成工作流失败"})
    return {"nodes": result.get("nodes") or [], "edges": result.get("edges") or []}
