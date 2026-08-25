"""API v2 层（MCP 改造：/api/v2/）。

面向外部编程智能体的 HTTP API，与 MCP 工具共用同一套 services 层。
- Canvas API：/api/v2/canvas/{id}、/api/v2/object
- Workflow API：/api/v2/workflow、/api/v2/workflow/{id}/run、/api/v2/task/{id}
- Provider API：/api/v2/providers、/api/v2/provider/test、/api/v2/provider/route
"""
from __future__ import annotations

import json
import secrets

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app import db
from app.mcp.auth.token import create_client_token
from app.mcp.registry import tool_registry
from app.services.asset_service import asset_service
from app.services.canvas_service import canvas_service
from app.services.provider_service import provider_service
from app.services.workflow_service import workflow_service

router = APIRouter()


# ==================== Canvas API ====================


@router.get("/canvas/{pid}")
async def v2_canvas_get(pid: str):
    return {"canvas": await canvas_service.graph(pid)}


@router.post("/object")
async def v2_object_create(request: Request):
    data = await request.json()
    oid = await canvas_service.create_object(
        str(data.get("project_id", "")),
        str(data.get("type", "text")),
        data.get("content"),
        data.get("position"),
        data.get("size"),
        int(data.get("layer", 0)),
        data.get("metadata"),
    )
    return {"id": oid}


@router.put("/object/{oid}")
async def v2_object_update(oid: str, request: Request):
    data = await request.json()
    obj = await canvas_service.update_object(oid, data.get("changes") or data)
    if obj is None:
        return JSONResponse(status_code=404, content={"error": "对象不存在"})
    return {"id": oid, "object": obj}


@router.delete("/object/{oid}")
async def v2_object_delete(oid: str):
    await canvas_service.delete_object(oid)
    return {"ok": True}


# ==================== Workflow API ====================


@router.post("/workflow")
async def v2_workflow_create(request: Request):
    data = await request.json()
    wid = await workflow_service.create(
        str(data.get("name", "")),
        data.get("nodes") or [],
        data.get("edges") or [],
        str(data.get("project_id", "")),
        data.get("workflow_id") or None,
    )
    return {"workflow_id": wid}


@router.post("/workflow/{wid}/run")
async def v2_workflow_run(wid: str, request: Request):
    data = await request.json() if await request.body() else {}
    result = await workflow_service.execute(wid, str(data.get("project_id", "") or ""))
    return result


@router.get("/task/{tid}")
async def v2_task_get(tid: str):
    detail = await workflow_service.inspect(tid)
    if detail is None:
        return JSONResponse(status_code=404, content={"error": "任务不存在"})
    return detail


# ==================== Provider API ====================


@router.get("/providers")
async def v2_providers_list():
    return {"providers": await provider_service.list()}


@router.post("/provider/test")
async def v2_provider_test(request: Request):
    data = await request.json()
    return await provider_service.health(str(data.get("id", "")))


@router.post("/provider/route")
async def v2_provider_route(request: Request):
    data = await request.json()
    chain = await provider_service.route(
        str(data.get("task_type", "llm")),
        quality=float(data.get("quality", 1.0)),
        speed=float(data.get("speed", 1.0)),
        cost=float(data.get("cost", 1.0)),
    )
    return {"providers": chain}


# ==================== MCP 客户端管理 ====================


@router.get("/mcp/info")
async def v2_mcp_info():
    """MCP Server 状态 + 工具列表。"""
    return {"name": "lumiweave", "version": "2.1.0", "tools": tool_registry.list()}


@router.get("/mcp/clients")
async def v2_mcp_clients():
    rows = await db.fetch(
        "SELECT id, name, type, token, permissions, enabled, created_at FROM mcp_clients ORDER BY created_at DESC"
    )
    return {"clients": [dict(r) for r in rows]}


@router.post("/mcp/clients")
async def v2_mcp_client_create(request: Request):
    data = await request.json()
    cid = str(data.get("id", "")).strip() or ("client_" + secrets.token_hex(8))
    name = str(data.get("name", ""))
    ctype = str(data.get("type", "generic"))
    token = create_client_token()
    perms = data.get("permissions") or []
    await db.execute(
        "INSERT INTO mcp_clients (id, name, type, token, permissions) VALUES ($1,$2,$3,$4,$5::jsonb)",
        cid, name, ctype, token, json.dumps(perms, ensure_ascii=False),
    )
    return {"id": cid, "name": name, "type": ctype, "token": token, "permissions": perms}


@router.delete("/mcp/clients/{cid}")
async def v2_mcp_client_delete(cid: str):
    await db.execute("DELETE FROM mcp_clients WHERE id=$1", cid)
    return {"ok": True}
