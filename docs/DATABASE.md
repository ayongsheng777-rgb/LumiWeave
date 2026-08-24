# 数据库设计

PostgreSQL（asyncpg）。Schema 定义在 `backend/init_db.sql`，全部 `IF NOT EXISTS`（可重复部署，rule #17）。

## 表清单

| 表 | 用途 | 关键列 |
|---|---|---|
| `token_usage_log` | token 用量 | model/provider/scenario/prompt_tokens/completion_tokens/success/latency_ms |
| `model_pricing` | 模型计费 | model/provider/input·output_per_million/source/active |
| `app_kv` | 键值（AI 覆盖配置、日报幂等） | key/value |
| `agents` | Agent 注册（Phase 2） | id/name/provider(JSONB)/enabled |
| `skills` | Skill 中央仓库（Phase 3） | id/version/runtime/entry/permissions(JSONB)/tags(JSONB)/content/source |
| `renderers` | Renderer（Phase 5） | id/type/endpoint/api_key/client_id/enabled/timeout |
| `tasks` | 全链路任务（Phase 8） | id/user_id/canvas_id/agent_id/skill_id/renderer_id/status |
| `task_events` | 任务事件时间线 | task_id/type/payload(JSONB)/ts |
| `task_results` | 任务结果 | task_id/content/data(JSONB)/ts |
| `prompt_sources` | 知识源（Phase 7） | kind/uri/status/last_sync |
| `prompt_knowledge` | 知识块 + 向量 | source/title/content/embedding(float8[]) |

## 约定
- **JSONB**：asyncpg 默认以字符串往返，写入用 `json.dumps(...)`，读取用 `json.loads(...)`（见 skills/__init__ 的 `_parse_json_list`）。
- **向量**：`prompt_knowledge.embedding` 用 `float8[]`，不用 pgvector 扩展，余弦相似度在 Python 计算（保证 docker 从零启动）。
- **索引**：token（ts、model+ts）、tasks（status、agent_id）、task_events（task_id）、prompt_knowledge（source）。
- **时区**：`TIMESTAMPTZ`，默认 `now()`。

## 迁移
- 首次：postgres 容器启动执行 `/docker-entrypoint-initdb.d/01_init.sql`（bind mount `./backend/init_db.sql`）。
- 已有卷：`docker compose exec -T postgres psql -U lumiweave -d lumiweave -f /docker-entrypoint-initdb.d/01_init.sql` 增量应用（幂等）。
