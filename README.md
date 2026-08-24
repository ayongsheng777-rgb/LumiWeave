# 绵绣 LumiWeave

个人 AI 创客工作台：以 **React Flow DAG 画布**为主产品，AI 是画布的操作系统。前端拖拽节点连线，后端解析 DAG → 拓扑执行 → 异构算力分发（本地 ComfyUI / 云端大显存实例），全链路打通创作闭环。

## 功能特性

- **DAG 工作流画布**：React Flow + Zustand 数据驱动，6 类节点（输入 / LLM 推理 / 提示词模板 / 技能调用 / 出图算力 / 输出），拖拽落点、平滑连线、节点运行状态呼吸灯与结果回显。
- **异构算力路由**：`asyncio.Queue` 本地队列 + 常驻 worker，大显存任务（Flux / Wan2.2 / 视频）自动抛云端，基础生图留本地串行，防止爆显存。
- **统一 DAG 协议**：`app/schemas/workflow.py` 定义前后端唯一契约，`to_engine_graph()` 转换到执行层。
- **LLM 统一网关**：`provider_gateway.py` 统一调用出口，自动拦截并记录 Token。
- **Token 追踪与计费**：`tracker.py` + PostgreSQL 记录，按日/模型/场景汇总、费用折算、官方价同步、飞书日报（可选）。
- **多智能体 Agent**：统一 Adapter/Registry/Router，自动路由或手动切换，流式 + token 计量。
- **Skill 中央仓库**：平台级技能，自动发现 + 热加载 + 权限控制，已内置 h3-prompt-writing。
- **Prompt 学习 / RAG**：知识源 → 抽取 → 向量检索 → 动态注入提示词模板节点。
- **现代化 UI**：Tailwind 暗色优先 + 浅色主题可切换，右侧智能体抽屉、悬浮工具条、灯箱预览、设置管理面板（模型/接口/出图/技能/知识库/素材/计费）。
- **OTP/TOTP 认证**：纯标准库 RFC 6238，支持验证器扫码登录。
- **独立 Docker 部署**：PostgreSQL + Redis + FastAPI 后端 + React 前端，一键启动。

> 维护手册见 `AGENTS.md`，架构/接口等细节文档见 `docs/`。

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
├── docs/              架构/接口/数据库/部署文档
├── backend/           FastAPI 后端
│   ├── app/
│   │   ├── auth.py           OTP/TOTP + 会话令牌
│   │   ├── main.py           入口与鉴权中间件 + lifespan（算力 worker 挂载）
│   │   ├── task_service.py   统一 taskId（tasks/task_events/task_results）
│   │   ├── schemas/          【V2】统一 DAG 协议（workflow.py）
│   │   ├── ai/               AI 模型面板 + provider_gateway（统一 LLM 网关）
│   │   ├── agent/            多智能体 Agent + engine（DAG 执行引擎）
│   │   ├── skills/           Skill 中央仓库
│   │   ├── renderers/        ComfyUI Renderer + dispatcher（异构算力路由）
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
