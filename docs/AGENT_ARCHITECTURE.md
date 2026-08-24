# Agent 架构（Phase 2）

## 目标
Claude / Hermes / Workbuddy 三个 Agent 都能调用，且新增 Gemini/Qwen/DeepSeek/Ollama 不改 Agent Core。

## 核心组件

### 1. AgentAdapter（统一接口，spec #5.1）
`app/agent/adapter.py` — 所有 Agent 必须实现同一接口：
- `chat(request) -> AgentResponse`（含 taskId / agent / content / toolCalls / usage / finishReason）
- `stream(request, on_event)`（逐 token 事件）
- `health_check() -> bool`

实现 `LLMAgentAdapter`：按 `protocol` 分流到 OpenAI 兼容 `/chat/completions`（复用 `ai.client`）或 Anthropic `/v1/messages`，统一带 timeout + 错误处理 + token 计量。

### 2. AgentRegistry（强类型，spec #6）
`app/agent/registry.py` — 不使用 `Map<AgentType, any>`，改为 `dict[str, AgentAdapter]`。`get()` 未注册时抛 `KeyError`。

### 3. AgentRouter（分类 + 手动锁定，spec #8）
`app/agent/router.py` — `classify(message)` 关键字分类（coding/prompt/image/video/search/copywriting/general）→ `resolve(agent_id, message)`：
- `agent_id != "auto"` 且已注册 → 手动锁定该 Agent
- `auto` → 按分类映射偏好 Agent，兜底 `default`

### 4. AgentProviderConfig（统一 Provider，spec #7）
`app/agent/provider.py` — `protocol: anthropic | openai-compatible | custom-http`，持久化在 `agents` 表（`provider` JSONB）。首次启动 `seed_default_agents()` 播种 default/claude/hermes/workbuddy 四行。

## 数据库
`agents(id, name, provider JSONB, enabled, created_at)`

## 接口
- `GET /api/agents` — 列出已注册 Agent
- `GET /api/agents/{id}/health` — 健康检查
- `POST /api/agents/reload` — 从 DB 重载
- `POST /api/agents/chat` — 同步对话（创建 task，贯穿 taskId）
- `POST /api/agents/chat/stream` — SSE 流式对话

## 验证证据（本会话实测）
- `/api/agents` 返回 4 个 Agent：default / claude / hermes / workbuddy。
- `/api/agents/chat` 返回 `task_id`，`agent` 解析为 `default`，事件链 `agent_resolved → … → agent_done` 正确落库。
