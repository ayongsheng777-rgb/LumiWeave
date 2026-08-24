from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class RendererConfig:
    """统一 Renderer 配置（spec #18 / rule #12）。新增 image-api/video-api 不改核心。"""

    id: str
    name: str
    type: str = "comfyui"  # comfyui | image-api | video-api
    endpoint: str = ""
    api_key: str = ""
    client_id: str = ""
    enabled: bool = False
    timeout: int = 600

    @classmethod
    def from_db(cls, row: dict[str, Any]) -> "RendererConfig":
        return cls(
            id=row["id"], name=row.get("name", row["id"]),
            type=row.get("type", "comfyui"), endpoint=row.get("endpoint", ""),
            api_key=row.get("api_key", ""), client_id=row.get("client_id", ""),
            enabled=bool(row.get("enabled", False)), timeout=int(row.get("timeout", 600)),
        )


class BaseRenderer:
    """所有 Renderer 的基类（rule #12 统一 Provider）。"""

    def __init__(self, cfg: RendererConfig):
        self.cfg = cfg
        self.last_error: str = ""

    async def health_check(self) -> bool:
        raise NotImplementedError

    async def generate(self, workflow: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError


class RendererRegistry:
    """统一 Provider 注册中心（spec #18）。"""

    def __init__(self) -> None:
        self._renderers: dict[str, "BaseRenderer"] = {}

    def register(self, renderer: "BaseRenderer") -> None:
        self._renderers[renderer.cfg.id] = renderer

    def get(self, renderer_id: str) -> Optional["BaseRenderer"]:
        return self._renderers.get(renderer_id)

    def list(self) -> list[dict[str, Any]]:
        return [
            {
                "id": r.cfg.id, "name": r.cfg.name, "type": r.cfg.type,
                "enabled": r.cfg.enabled, "endpoint": r.cfg.endpoint,
            }
            for r in self._renderers.values()
        ]
