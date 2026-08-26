"""ModelCapability — 模型能力注册表（规格书 §5）。"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field
from dataclasses import dataclass, field


@dataclass
class ModelCapability:
    """
    单个渲染引擎/模型的能力描述。
    """
    provider_id: str
    engine: str                       # comfyui | cloud | minimax-video | ...
    display_name: str
    supports_image: bool = True
    supports_video: bool = False
    supports_ip_adapter: bool = False
    supports_controlnet: bool = False
    supports_inpainting: bool = False
    max_resolution: int = 2048        # px
    video_max_duration: float = 10.0  # 秒
    special_tags: list[str] = field(default_factory=list)  # ["flux", "sdxl", " anime" ...]


class CapabilityRegistry:
    """
    全局能力注册表（内存单例）。
    启动时从 DB 表 model_capabilities 加载，可运行时动态刷新。
    """

    def __init__(self) -> None:
        self._caps: dict[str, ModelCapability] = {}

    def register(self, cap: ModelCapability) -> None:
        key = f"{cap.provider_id}:{cap.engine}"
        self._caps[key] = cap

    def get(self, provider_id: str, engine: str) -> Optional[ModelCapability]:
        return self._caps.get(f"{provider_id}:{engine}")

    def list_all(self) -> list[ModelCapability]:
        return list(self._caps.values())

    def filter(self, **kw) -> list[ModelCapability]:
        """按字段过滤，例如 filter(supports_video=True)。"""
        return [
            c for c in self._caps.values()
            if all(getattr(c, k, None) == v for k, v in kw.items())
        ]

    def load_from_db(self, rows: list[dict]) -> None:
        """从 DB rows 批量加载。"""
        for r in rows:
            self.register(ModelCapability(**r))


# ── 全局单例 ───────────────────────────────────────────────────────────────────
_registry = CapabilityRegistry()

# 默认内置能力（可在 init_db.sql 中覆盖）
_registry.register(ModelCapability(
    provider_id="minimax",
    engine="cloud",
    display_name="MiniMax 云端渲染",
    supports_image=True,
    supports_video=True,
    max_resolution=4096,
    video_max_duration=60.0,
    special_tags=["minimax-h3", "video-v2"],
))
_registry.register(ModelCapability(
    provider_id="comfyui",
    engine="comfyui",
    display_name="ComfyUI (本地/云)",
    supports_image=True,
    supports_ip_adapter=True,
    supports_controlnet=True,
    supports_inpainting=True,
    max_resolution=4096,
    special_tags=["sdxl", "flux", "sd3", "animatediff"],
))
_registry.register(ModelCapability(
    provider_id="minimax",
    engine="minimax-video",
    display_name="MiniMax 视频生成",
    supports_video=True,
    max_resolution=1920,
    video_max_duration=60.0,
    special_tags=["minimax-video", "h3-protocol"],
))


def get_registry() -> CapabilityRegistry:
    return _registry


def resolve_capabilities(required: list[str]) -> list[ModelCapability]:
    """
    根据 capability_required 列表（["video_generation", "ip_adapter"...]），
    返回满足全部条件的 ModelCapability 列表（按优先级排序）。
    """
    caps = _registry.list_all()
    results = []
    for cap in caps:
        satisfied = all(
            _match_cap_tag(tag, cap) for tag in required
        )
        if satisfied:
            results.append(cap)
    # 优先云端（cloud），再本地（comfyui），再专业视频
    def sort_key(c: ModelCapability) -> int:
        if c.engine == "cloud":
            return 0
        if c.engine == "comfyui":
            return 1
        return 2
    results.sort(key=sort_key)
    return results


def _match_cap_tag(tag: str, cap: ModelCapability) -> bool:
    """判断单个 capability tag 是否被该 ModelCapability 满足。"""
    mapping = {
        "video_generation": "supports_video",
        "image_generation": "supports_image",
        "ip_adapter": "supports_ip_adapter",
        "controlnet": "supports_controlnet",
        "inpainting": "supports_inpainting",
    }
    field = mapping.get(tag)
    if field:
        return bool(getattr(cap, field, False))
    # 兜底：tag 直接匹配 special_tags
    return tag in cap.special_tags
