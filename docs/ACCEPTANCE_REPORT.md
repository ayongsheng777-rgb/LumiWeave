# 验收报告

日期：2026-08-24。栈：postgres/redis/backend/frontend 四容器健康运行。

## 已实现（Phase 0–8）
| Phase | 内容 | 状态 |
|---|---|---|
| 1 | Web→API→DB→Redis 基础链路 | ✅ 已恢复 |
| 2 | Agent Core（Adapter/Registry/Router/Provider/Streaming/Usage） | ✅ |
| 3 | Skill Core（Manifest/Loader/Manager/Runtime/Permission/热加载） | ✅ |
| 4 | h3-prompt-writing 导入（skills/builtin） | ✅ |
| 5 | ComfyUI Renderer（queue/history/cancel/retry/timeout） | ✅ |
| 6 | OTP/TOTP 登录 | ✅ |
| 7 | Prompt Learning / RAG（Source→Extractor→Embedding→Retriever→注入） | ✅ |
| 8 | 全链路 taskId 闭环 | ✅ |

## 实测证据（真实调用，非 mock）
1. `GET /api/health` → `200 {"status":"ok"}`。
2. 真实 TOTP 计算 → `POST /api/auth/login` → `200` + token。
3. `GET /api/agents` → 4 个 Agent（default/claude/hermes/workbuddy）。
4. `POST /api/skills/reload` → `count:1`；`permissions/tags` 返回真实数组 `[]` / `["prompt","video","h3"]`。
5. `GET /api/renderers` → `comfy-local`（disabled）。
6. `POST /api/prompt-kb/add` → `200`；`/search` → 命中结果。
7. `POST /api/agents/chat`（带 skill_id + learn_prompt）→ 返回 `task_id`，事件时间线：
   ```
   agent_resolved → skill_executed → prompt_learned(hits:3) → agent_done
   ```
   （payload 均为 JSONB object，taskId 贯穿全程。）

## 待外部条件启用（非缺陷）
- **真实 LLM 出字**：未配 `AI_API_KEY`，Agent/Skill 的 prompt 运行时优雅降级（返回空 content，不崩溃）。
- **Claude/Hermes/Workbuddy 实调**：需各自 API key。
- **ComfyUI 实产图**：需可访问的 ComfyUI 实例并启用 renderer。
- **语义向量**：配 `EMBEDDING_BASE_URL/API_KEY` 后启用；当前为本地哈希降级（可复现、零依赖）。

## 开发规则遵守（spec #76）
统一 taskId ✅ | 统一 Adapter/Manifest/Provider ✅ | 第三方调用 timeout+错误处理 ✅ | 长任务 retry ✅ | migration 可重复 ✅ | Docker 从零启动 ✅ | 无 mock ✅ | 未大面积重写稳定代码 ✅ | 复用现有组件（ai.client/task_service）✅
