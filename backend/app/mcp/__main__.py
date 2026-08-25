"""MCP Server 入口。

- stdio 模式（默认）：`python -m app.mcp`
  供 Codex / Claude Code / WorkBuddy 通过 .mcp/*.json 配置后本地直连。

- streamable-http 模式：`python -m app.mcp --http [--port 8901]`
  独立进程跑 HTTP MCP（带 Bearer token 认证，供远程客户端接入）。
"""
from __future__ import annotations

import sys

if __name__ == "__main__":
    if "--http" in sys.argv:
        port = 8901
        if "--port" in sys.argv:
            try:
                port = int(sys.argv[sys.argv.index("--port") + 1])
            except (IndexError, ValueError):
                pass
        import asyncio

        import uvicorn

        from app.mcp.server import http_app

        async def _load_ai_config() -> None:
            """启动时恢复 AI 覆盖层与自定义模型库（film.* 工具的 LLM 调用依赖）。

            🔴 加载完必须 close_pool()：本函数跑在独立 asyncio.run 的事件循环里，
            asyncpg 连接池绑定该循环；不关闭的话 uvicorn 主循环复用同一池会报
            "another operation is in progress"。配置数据已进内存（AI_OVERRIDES/
            CUSTOM_MODELS 全局），关池不影响后续按需重建。
            """
            try:
                from app.ai.persist import load_custom_models, load_overrides
                await load_overrides()
                await load_custom_models()
            except Exception as e:  # noqa: BLE001
                print(f"[mcp] AI 配置加载失败（不影响启动）: {e}")
            finally:
                try:
                    from app.db import close_pool
                    await close_pool()
                except Exception:  # noqa: BLE001
                    pass

        asyncio.run(_load_ai_config())
        uvicorn.run(http_app(), host="0.0.0.0", port=port, log_level="info")
    else:
        from app.mcp.server import server

        server.run(transport="stdio")
