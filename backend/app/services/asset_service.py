"""素材服务层（MCP 改造：backend/services）。

Asset 是所有生成结果的中心。封装素材列表 / 绑定画布 / 删除 / 改名，
供 MCP 工具（asset.*）与 /api/v2 复用。
"""
from __future__ import annotations

from typing import Any

from app import db
from app.assets import service as _assets
from app.canvas import service as _canvas


class AssetService:
    async def list(self, asset_type: str = "", limit: int = 100) -> list[dict[str, Any]]:
        """素材列表（asset.list）。"""
        return await _assets.list_assets(asset_type, limit)

    async def get(self, aid: str) -> dict[str, Any] | None:
        row = await db.fetchrow("SELECT * FROM assets WHERE id=$1", aid)
        if not row:
            return None
        d = dict(row)
        return d

    async def attach(self, aid: str, project_id: str) -> dict[str, Any]:
        """把素材绑定到画布，生成一个 image 画布对象（asset.attach）。"""
        asset = await self.get(aid)
        if not asset:
            return {"ok": False, "error": "素材不存在"}
        oid = await _canvas.create_object(
            project_id,
            "image",
            content={"url": asset.get("url", ""), "asset_id": aid},
            metadata={"source": "asset", "asset_id": aid},
        )
        return {"ok": True, "object_id": oid, "asset_id": aid}

    async def delete(self, aid: str) -> bool:
        """删除素材（asset.delete）。"""
        return await _assets.delete_asset(aid)

    async def rename(self, aid: str, name: str) -> dict[str, Any] | None:
        """改名素材。"""
        return await _assets.rename_asset(aid, name)


asset_service = AssetService()
