"""WebSocket 连接管理器（规格书 §6 实时推送）。"""
from app.render_kernel.websocket.connection_manager import (
    ConnectionManager,
    get_ws_manager,
)

__all__ = ["ConnectionManager", "get_ws_manager"]
