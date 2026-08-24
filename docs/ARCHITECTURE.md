# 绵绣 LumiWeave — 总体架构

## 定位
把 infinite-canvas 升级为「多智能体 AI 创作平台」：Canvas → Task → Agent → Skill → Prompt → Renderer → Result → Usage → History 全链路闭环，每个环节贯穿统一 `taskId`。

## 服务拓扑（Docker Compose）

| 服务 | 镜像 | 宿主端口 | 职责 |
|---|---|---|---|
| postgres | postgres:16.4-alpine | 5435→5432 | 主库（业务 + token + 任务） |
| redis | redis:7.4-alpine | 6385→6379 | 缓存/会话（预留） |
| backend | python:3.12.5-slim | 8900→8000 | FastAPI 主服务 |
| frontend | nginx | 3010→80 | 静态资源 + `/api` 反代到 backend |

## 后端模块结构

```
app/
├── main.py            # FastAPI 入口：中间件、路由挂载、lifespan 启动加载
├── config.py          # Settings + AI_OVERRIDES 运行时覆盖层
├── db.py              # asyncpg 连接池封装（execute/fetch/fetchrow）
├── auth.py            # OTP/TOTP + HMAC-SHA256 会话 token（spec #70）
├── scheduler.py       # APScheduler（飞书日报等）
├── task_service.py    # 统一 taskId：create_task/add_event/set_status/set_result
├── ai/                # AI 模型层（04 guide）
│   ├── client.py      # chat/chat_full/stream_chat，token 计量埋点
│   ├── config.py / registry.py / auto_best.py / persist.py / routes.py
├── agent/             # Phase 2：Agent Core
│   ├── types.py / adapter.py / provider.py / registry.py / router.py / routes.py
├── skills/            # Phase 3：Skill Core（平台级，不绑单 Agent）
│   ├── manifest.py / loader.py / manager.py / runtime.py / permissions.py / routes.py
├── renderers/         # Phase 5：ComfyUI 等 Renderer
│   ├── registry.py / comfyui.py / routes.py
├── prompt_learning/   # Phase 7：Prompt 学习 / RAG
│   ├── embedder.py / store.py / source.py / extractor.py / retriever.py / routes.py
└── token_usage/       # Token 统计与计费
```

## 全链路数据流

```
用户/Canvas 请求（带 taskId）
  → /api/agents/chat
  → AgentRouter 解析 → 选择 Agent
  → (可选) SkillManager.execute 执行平台 Skill
  → (可选) Prompt Learning 检索知识库并动态注入
  → AgentAdapter.chat 调用 LLM（带 timeout + 错误处理 + token 计量）
  → task_events 记录每个环节，task_results 落结果
  → Token Usage 异步落库
```

## 关键设计决策
- **统一 taskId**：`tasks/task_events/task_results` 三表贯穿全部环节，WebSocket 断开不判失败（rule #16）。
- **统一 Adapter/Manifest/Provider**：Agent、Skill、Renderer 各自统一接口，新增能力不改核心（rule #10/#11/#12）。
- **第三方调用全部 timeout + 错误处理**（rule #13/#14），长任务支持 retry（rule #15）。
- **无 Mock**：所有按钮/统计/技能均接真实 API（rule #1/#2）。
