from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Protocol


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


class RendererProvider(Protocol):
    """统一 Renderer Provider 抽象（规格书 §13/§14）。

    submit / status / cancel / result 分离，长任务可异步轮询、可取消、
    可重取结果。所有实现必须遵守，不允许只提供 generate 一体化。
    """

    async def health(self) -> dict[str, Any]:
        ...

    async def submit(self, workflow: dict[str, Any], *, task_id: str) -> dict[str, Any]:
        ...

    async def status(self, remote_task_id: str) -> dict[str, Any]:
        ...

    async def cancel(self, remote_task_id: str) -> dict[str, Any]:
        ...

    async def result(self, remote_task_id: str) -> dict[str, Any]:
        ...


class BaseRenderer:
    """所有 Renderer 的基类（rule #12 统一 Provider）。"""

    def __init__(self, cfg: RendererConfig):
        self.cfg = cfg
        self.last_error: str = ""

    async def health_check(self) -> bool:
        """兼容旧接口：返回是否健康（布尔）。"""
        return bool((await self.health()).get("healthy"))

    async def health(self) -> dict[str, Any]:
        """结构化健康检查（规格书 §17）。未配置 endpoint 时明确给出 reason，不伪造 healthy。"""
        if not self.cfg.enabled:
            return {"enabled": False, "healthy": False, "reason": "renderer 未启用"}
        if not self.cfg.endpoint:
            return {"enabled": True, "healthy": False, "reason": "endpoint 未配置"}
        return {"enabled": True, "healthy": False, "reason": "health() 未实现"}

    async def generate(self, workflow: dict[str, Any]) -> dict[str, Any]:
        """便捷封装：submit -> 轮询 status -> result。子类可按需覆写。"""
        submitted = await self.submit(workflow, task_id="")
        remote_id = submitted.get("remote_task_id") or submitted.get("prompt_id")
        if not submitted.get("ok") or not remote_id:
            return {"ok": False, "images": [], "error": submitted.get("error") or "提交失败"}
        return await self.result(remote_id)

    async def submit(self, workflow: dict[str, Any], *, task_id: str) -> dict[str, Any]:
        raise NotImplementedError

    async def status(self, remote_task_id: str) -> dict[str, Any]:
        raise NotImplementedError

    async def cancel(self, remote_task_id: str) -> dict[str, Any]:
        raise NotImplementedError

    async def result(self, remote_task_id: str) -> dict[str, Any]:
        raise NotImplementedError

    def capabilities(self) -> list[str]:
        """能力清单（规格书 §17）。"""
        return {
            "comfyui": ["text_to_image", "image_to_image"],
            "image-api": ["text_to_image"],
            "video-api": ["text_to_video", "image_to_video"],
        }.get(self.cfg.type, [])


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
                "capabilities": r.capabilities(),
            }
            for r in self._renderers.values()
        ]
