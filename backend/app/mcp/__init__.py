"""MCP Server 模块（MCP 改造核心）。

对外部编程智能体（Codex / Claude Code / WorkBuddy / Cursor 等）暴露
LumiWeave 的创作能力，通过 MCP 协议标准接入。

- server.py   MCPServer 实例 + 工具注册（stdio + streamable-http 双模式）
- registry.py ToolRegistry 工具注册表（含权限声明）
- tools/      canvas / workflow / asset / provider / project 五类工具
- auth/       token 验证 + 权限模型
- schemas/    数据模型
"""
