"""Canvas MCP 工具（canvas.*）：画布对象的查看 / 创建 / 修改 / 移动 / 删除 / 生成 / 导出。"""
from __future__ import annotations

import json
from typing import Any

import httpx

from app import db
from app.assets import service as _assets
from app.mcp.registry import tool_registry
from app.services.canvas_service import canvas_service


def register(server: Any) -> None:
    @server.tool(
        name="canvas.list",
        description="列出画布上的所有对象（按图层顺序）。project_id 为空时返回全部。",
    )
    async def canvas_list(project_id: str = "") -> dict[str, Any]:
        objects = await canvas_service.list_objects(project_id)
        return {"objects": objects}

    @server.tool(
        name="canvas.create",
        description="在画布上创建一个对象。type 可为 text/note/prompt/image/video 等，"
                    "content 是文本或图片地址，x/y 是画布坐标。",
    )
    async def canvas_create(
        project_id: str,
        type: str = "text",
        content: str = "",
        x: float = 0,
        y: float = 0,
    ) -> dict[str, Any]:
        if type in ("image", "video"):
            data: dict[str, Any] = {"url": content, "prompt": content}
        else:
            data = {"text": content}
        oid = await canvas_service.create_object(
            project_id, type, data, {"x": x, "y": y},
        )
        return {"id": oid, "status": "created"}

    @server.tool(
        name="canvas.update",
        description="修改画布对象。changes 可含 content（dict）、position（dict）、type（str）等字段。",
    )
    async def canvas_update(obj_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        obj = await canvas_service.update_object(obj_id, changes)
        return {"id": obj_id, "status": "updated", "object": obj}

    @server.tool(
        name="canvas.move",
        description="把画布对象移动到新坐标 (x, y)。",
    )
    async def canvas_move(obj_id: str, x: float, y: float) -> dict[str, Any]:
        obj = await canvas_service.move_object(obj_id, x, y)
        return {"id": obj_id, "status": "moved", "position": (obj or {}).get("position")}

    @server.tool(
        name="canvas.delete",
        description="删除画布对象。",
    )
    async def canvas_delete(obj_id: str) -> dict[str, Any]:
        await canvas_service.delete_object(obj_id)
        return {"id": obj_id, "status": "deleted"}

    @server.tool(
        name="canvas.generate",
        description="AI 生成资源（图片/视频）并落到画布：路由到 image/video Provider 生成，"
                    "结果存入素材库并创建一个画布对象。provider 传 'auto' 表示自动选择。",
    )
    async def canvas_generate(
        project_id: str,
        type: str = "image",
        prompt: str = "",
        provider: str = "auto",
    ) -> dict[str, Any]:
        if type not in ("image", "video"):
            return {"ok": False, "error": "type 仅支持 image / video"}
        if not prompt:
            return {"ok": False, "error": "缺少 prompt"}
        # 取 image/video provider（真实 key 需查库，list 接口是脱敏的）
        rows = await db.fetch(
            "SELECT id, endpoint, api_key, models FROM providers WHERE type=$1 AND status='enabled' ORDER BY id",
            type,
        )
        if provider != "auto":
            rows = [r for r in rows if r["id"] == provider] or rows
        if not rows:
            return {"ok": False, "error": f"没有可用的 {type} Provider"}
        p = rows[0]
        endpoint = (p["endpoint"] or "").rstrip("/")
        key = p["api_key"] or ""
        models = json.loads(p["models"]) if isinstance(p["models"], str) else (p["models"] or [])
        model = models[0] if models else ""
        if not endpoint or not key:
            return {"ok": False, "error": "Provider 缺少 endpoint 或 api_key"}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=10)) as c:
                if type == "image":
                    r = await c.post(
                        f"{endpoint}/images/generations",
                        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                        json={"model": model, "prompt": prompt},
                    )
                else:
                    r = await c.post(
                        f"{endpoint}/videos/generations",
                        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                        json={"model": model, "prompt": prompt},
                    )
            if r.status_code != 200:
                return {"ok": False, "error": f"生成失败 HTTP {r.status_code}: {r.text[:200]}"}
            data = r.json()
            imgs = data.get("images") or data.get("data") or []
            url = ""
            if imgs:
                first = imgs[0]
                url = first.get("url") or first.get("b64_json") or ""
            if not url:
                return {"ok": False, "error": "生成成功但未返回资源地址", "raw": data}
            # 存素材库 + 建画布对象
            aid = await _assets.add_asset("", type, url, {"prompt": prompt, "provider": p["id"]}, name=prompt[:40])
            oid = await canvas_service.create_object(
                project_id, type, {"url": url, "prompt": prompt},
                metadata={"source": "mcp.generate", "asset_id": aid},
            )
            return {"ok": True, "asset_id": aid, "object_id": oid, "url": url}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}

    @server.tool(
        name="canvas.export",
        description="导出画布。format 当前支持 json（返回完整画布结构），png/jpg/pdf/svg/pptx 预留。",
    )
    async def canvas_export(project_id: str, format: str = "json") -> dict[str, Any]:
        return await canvas_service.export_canvas(project_id, format)

    # 登记工具元信息
    tool_registry.register("canvas.list", "列出画布对象", "canvas")
    tool_registry.register("canvas.create", "创建画布对象", "canvas")
    tool_registry.register("canvas.update", "修改画布对象", "canvas")
    tool_registry.register("canvas.move", "移动画布对象", "canvas")
    tool_registry.register("canvas.delete", "删除画布对象", "canvas")
    tool_registry.register("canvas.generate", "AI 生成资源并落画布", "canvas")
    tool_registry.register("canvas.export", "导出画布", "canvas")
