# 绵绣 LumiWeave

个人 AI 创客工作台：以 **React Flow DAG 画布**为主产品，AI 是画布的操作系统。前端拖拽节点连线，后端解析 DAG → 拓扑执行 → 异构算力分发（本地 ComfyUI / 云端大显存实例），全链路打通创作闭环。

## 功能特性

- **DAG 工作流画布**：React Flow + Zustand 数据驱动，节点可连线、可持久化（刷新不丢）、可真实执行；左侧节点库拖拽、右侧参数面板、AI 一句话自动搭建整条工作流。
- **异构算力路由**：`asyncio.Queue` 本地队列 + 常驻 worker，大显存任务（Flux / Wan2.2 / 视频）自动抛云端，基础生图留本地串行，防止爆显存。
- **统一 DAG 协议**：`app/schemas/workflow.py` 定义前后端唯一契约，`to_engine_graph()` 转换到执行层。
- **LLM 统一网关**：`provider_gateway.py` 统一调用出口，自动拦截并记录 Token。
- **Token 追踪与计费**：`tracker.py` + PostgreSQL 记录，按日/模型/场景汇总、费用折算、官方价同步、飞书日报（可选）。
- **MCP Server（外部 AI 驱动）**：暴露 canvas/workflow/asset/provider/project 五类 21 个 MCP 工具，Codex / Claude Code / WorkBuddy / Cursor 等编程智能体经 MCP 协议（stdio + streamable-http）操控画布与工作流。
- **Skill 中央仓库**：平台级技能，自动发现 + 热加载 + 权限控制，已内置 h3-prompt-writing。
- **Prompt 学习 / RAG**：知识源 → 抽取 → 向量检索 → 动态注入提示词模板节点。
- **现代化 UI**：Tailwind 暗色优先 + 浅色主题可切换，悬浮工具条、灯箱预览、设置管理面板（模型/接口/出图/技能/知识库/素材/计费/安全/MCP）。
- **OTP/TOTP 认证**：纯标准库 RFC 6238，支持验证器扫码登录。
- **独立 Docker 部署**：PostgreSQL + Redis + FastAPI 后端 + React 前端，一键启动。

### V2.1 核心链路（2026-08-25）

- **工作流持久化**：DAG 落库 `workflows` 表，`/api/workflow/save|list|load|delete`，刷新/重启不丢，前端自动恢复上次工作流。
- **统一 Task 体系**：`/api/tasks` 六端点（创建+执行/查询/列表/取消/重试/事件），状态机 `queued→running→completed|failed|cancelled|timeout`。
- **Result 回写画布**：render/llm/skill/output 节点执行后自动落 `ai_result`/`image` 对象，保留 task_id/workflow_id/node_id/prompt/model 全链路可追溯。
- **Node Registry**：11 类节点统一注册（含 schema），`/api/workflow/nodes` 供前端节点库消费。
- **结构化节点结果**：`NodeResult`（ok/status/output/error/usage/duration），节点级超时与取消。
- **Renderer Provider 抽象**：`submit/status/cancel/result` 分离 + 配置式 ComfyUI 模板（模板 + 输入映射）。
- **AI 统一错误码**：`INVALID_API_KEY/MODEL_NOT_FOUND/RATE_LIMIT/TIMEOUT/PROVIDER_ERROR/NETWORK_ERROR/INVALID_RESPONSE`。
- **Token 关联计费**：`token_usage_log` 记录 task_id/workflow_id/node_id/cost/currency；Provider api_key 脱敏返回。

### V2.2 MCP 改造（2026-08-25）

- **删除内部 Agent 中心**：`app/agent/` 移除，`/api/agents` 下线，`agents` 表删除；workflow 执行核心迁到 `app/workflow/`。
- **新增 MCP Server**：`app/mcp/`（MCPServer + 21 个工具 + token/权限），stdio（`python -m app.mcp`）+ streamable-http（`--http`）双模式。
- **新增服务层 + API v2**：`app/services/` 四服务层；`/api/v2/` 端点（canvas/workflow/provider/mcp 客户端管理）。
- **数据库**：`mcp_clients` 表（外部客户端 token + permissions）。
- **前端**：智能体组件删除，对话面板改纯 LLM；新增 MCP 状态/工具面板；`.mcp/` 三份客户端配置（Codex/Claude/WorkBuddy）。

> 维护手册见 `AGENTS.md`（唯一维护文档，2026-08-25 起 `docs/` 已清理）。

## 快速开始

1. 复制环境变量示例：
   ```bash
   cp .env.example .env
   ```

2. 编辑 `.env`，至少填写：
   - `AI_API_KEY`：默认模型 API Key
   - `AI_BASE_URL` / `AI_MODEL`：默认模型地址与名称
   - （可选）`OTP_SECRET`：固定 OTP 密钥，避免首屏展示二维码
   - （可选）`FEISHU_WEBHOOK_URL`：飞书群机器人 Webhook，用于每日汇报

3. 启动服务：
   ```bash
   docker compose up --build -d
   ```

4. 打开前端：
   ```
   http://localhost:3010
   ```

5. 首次登录：
   - 若未设置 `OTP_SECRET`，登录页会展示二维码与密钥，用验证器扫描后输入 6 位动态码。
   - 若已设置 `OTP_SECRET`，直接输入验证器动态码登录。

## 后端健康检查

```bash
curl http://localhost:8900/api/health
```

## 多模型库配置

在 `.env` 中通过 `AI_MODELS_JSON` 配置多模型，示例：

```env
AI_MODELS_JSON=[
  {"id":"deepseek","name":"DeepSeek","base_url":"https://api.deepseek.com/v1","model":"deepseek-chat","api_key":"sk-xxx"},
  {"id":"dashscope","name":"通义千问","base_url":"https://dashscope.aliyuncs.com/compatible-mode/v1","model":"qwen3.7-plus","api_key":"sk-yyy"}
]
AI_ACTIVE=deepseek
```

## 目录结构

```
绵绣LumiWeave/
├── AGENTS.md          维护手册（先读这个）
├── backend/           FastAPI 后端
│   ├── app/
│   │   ├── auth.py           OTP/TOTP + 会话令牌
│   │   ├── main.py           入口与鉴权中间件 + lifespan（算力 worker 挂载）
│   │   ├── task_service.py   统一 taskId（tasks/task_events/task_results）
│   │   ├── task_runner.py    【V2.1】工作流执行绑定 TaskId + 结果回写
│   │   ├── tasks/            【V2.1】Task API（创建/查/取消/重试/事件）
│   │   ├── schemas/          【V2】统一 DAG 协议（workflow.py）
│   │   ├── ai/               AI 模型面板 + provider_gateway（统一 LLM 网关）+ errors（统一错误码）
│   │   ├── workflow/         工作流执行核心（engine/node_registry/types/routes，MCP 改造时从 agent/ 迁来）
│   │   ├── skills/           Skill 中央仓库
│   │   ├── renderers/        ComfyUI Renderer + dispatcher（异构算力路由）
│   │   ├── canvas/           画布对象 CRUD + workflow_adapter + result_writer
│   │   ├── prompt_learning/  Prompt 学习 / RAG
│   │   └── token_usage/      Token 统计与计费 + tracker
│   ├── skills/           平台技能目录（builtin/external/learned）
│   ├── Dockerfile
│   ├── requirements.txt
│   └── init_db.sql           PostgreSQL 初始化（幂等）
├── frontend/          React + TypeScript + Vite + Tailwind
│   ├── src/
│   │   ├── components/      登录 / Workspace / TopHeader / 抽屉 / 设置面板 / 节点
│   │   ├── canvas/          无限画布（CanvasCore 等）
│   │   ├── store/           workflowStore / uiStore / canvasStore
│   │   └── api.ts           API 封装
│   ├── public/logo.jpg      项目 Logo
│   └── Dockerfile
├── docker-compose.yml
└── .env.example
```

## 关键端口

| 服务       | 宿主端口 |
|------------|----------|
| 前端       | 3010     |
| 后端       | 8900     |
| PostgreSQL | 5435     |
| Redis      | 6385     |

## 重置 OTP

登录后进入设置，输入当前动态码可重置并生成新密钥。固定密钥模式（设置了 `OTP_SECRET`）不可在线重置。
