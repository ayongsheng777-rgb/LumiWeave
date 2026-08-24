# 绵绣 LumiWeave

基于 Docker 的独立项目，融合 OTP/TOTP 认证、AI 模型面板、自动模型优选与 Token 统计/费用计算面板。

## 功能特性

- **OTP/TOTP 认证**：纯标准库实现 RFC 6238，支持 Google Authenticator / 1Password / Authy；支持自动密钥与固定密钥两种模式。
- **AI 模型面板**：多模型库配置、OpenAI 兼容统一客户端、模型连通探测、自动优选最快可用模型、模型能力推荐。
- **多智能体 Agent**：统一 Adapter/Registry/Router，Claude / Hermes / Workbuddy / 默认 Agent 可切换或自动路由，支持流式与 token 计量。
- **Skill 中央仓库**：平台级技能（不绑单 Agent），自动发现 + 热加载 + 权限控制，已内置 h3-prompt-writing。
- **ComfyUI Renderer**：本地/云端 ComfyUI 队列/进度/取消/重试，结果回写 Canvas。
- **Prompt 学习 / RAG**：Markdown / GitHub / 手动知识源 → 抽取 → 向量检索 → 动态注入。
- **Token 统计面板**：按日/模型/场景汇总、实时费用折算、官方价自动同步、自定义计费公式、ECharts 趋势图、飞书每日汇报（可选）。
- **独立 Docker 部署**：PostgreSQL + Redis + FastAPI 后端 + React 前端，一键启动。

> 维护手册见 `AGENTS.md`，架构/接口等 12 篇细节文档见 `docs/`。

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
├── docs/              12 篇架构/接口/数据库/部署文档
├── backend/           FastAPI 后端
│   ├── app/
│   │   ├── auth.py           OTP/TOTP + 会话令牌
│   │   ├── main.py           入口与鉴权中间件
│   │   ├── task_service.py   统一 taskId（tasks/task_events/task_results）
│   │   ├── ai/               AI 模型面板
│   │   ├── agent/            多智能体 Agent
│   │   ├── skills/           Skill 中央仓库
│   │   ├── renderers/        ComfyUI 等 Renderer
│   │   ├── prompt_learning/  Prompt 学习 / RAG
│   │   └── token_usage/      Token 统计与计费
│   ├── skills/           平台技能目录（builtin/external/learned）
│   ├── Dockerfile
│   ├── requirements.txt
│   └── init_db.sql           PostgreSQL 初始化（幂等）
├── frontend/          React + TypeScript + Vite
│   ├── src/
│   │   ├── components/      Login / Dashboard / ModelPanel / TokenPanel
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
