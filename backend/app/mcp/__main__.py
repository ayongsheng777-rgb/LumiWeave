"""MCP Server 入口。

- stdio 模式（默认）：`python -m app.mcp`
  供 Codex / Claude Code / WorkBuddy 通过 .mcp/*.json 配置后本地直连。

- streamable-http 模式：`python -m app.mcp --http [--port 8901]`
  独立进程跑 HTTP MCP（供远程客户端接入）。
"""
from __future__ import annotations

import sys

from app.mcp.server import server

if __name__ == "__main__":
    if "--http" in sys.argv:
        port = 8901
        if "--port" in sys.argv:
            try:
                port = int(sys.argv[sys.argv.index("--port") + 1])
            except (IndexError, ValueError):
                pass
        server.run(transport="streamable-http", host="0.0.0.0", port=port)
    else:
        server.run(transport="stdio")
