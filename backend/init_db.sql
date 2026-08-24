CREATE TABLE IF NOT EXISTS token_usage_log (
    id                BIGSERIAL PRIMARY KEY,
    ts                TIMESTAMPTZ NOT NULL DEFAULT now(),
    model             TEXT        NOT NULL,
    provider          TEXT        NOT NULL DEFAULT '',
    scenario          TEXT        NOT NULL DEFAULT '',
    prompt_tokens     INT         NOT NULL DEFAULT 0,
    completion_tokens INT         NOT NULL DEFAULT 0,
    success           BOOLEAN     NOT NULL DEFAULT TRUE,
    latency_ms        INT         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_token_usage_ts    ON token_usage_log (ts);
CREATE INDEX IF NOT EXISTS idx_token_usage_model ON token_usage_log (model, ts);

CREATE TABLE IF NOT EXISTS app_kv (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_pricing (
    id                 BIGSERIAL PRIMARY KEY,
    model              TEXT NOT NULL,
    provider           TEXT NOT NULL DEFAULT '',
    input_per_million  NUMERIC(12,6) NOT NULL DEFAULT 0,
    output_per_million NUMERIC(12,6) NOT NULL DEFAULT 0,
    source             TEXT NOT NULL DEFAULT 'manual',
    active             BOOLEAN NOT NULL DEFAULT TRUE,
    note               TEXT NOT NULL DEFAULT '',
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (model, provider)
);

-- Agent 注册中心（Phase 2）
CREATE TABLE IF NOT EXISTS agents (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    provider    JSONB NOT NULL DEFAULT '{}',
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Skills 中央仓库（Phase 3，平台级，非绑单 Agent）
CREATE TABLE IF NOT EXISTS skills (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    version     TEXT NOT NULL DEFAULT '1.0.0',
    description TEXT NOT NULL DEFAULT '',
    runtime     TEXT NOT NULL DEFAULT 'prompt',
    entry       TEXT NOT NULL DEFAULT 'SKILL.md',
    permissions JSONB NOT NULL DEFAULT '[]',
    tags        JSONB NOT NULL DEFAULT '[]',
    content     TEXT NOT NULL DEFAULT '',
    source      TEXT NOT NULL DEFAULT 'builtin',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Renderers（ComfyUI 等，Phase 5）
CREATE TABLE IF NOT EXISTS renderers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'comfyui',
    endpoint    TEXT NOT NULL DEFAULT '',
    api_key     TEXT NOT NULL DEFAULT '',
    client_id   TEXT NOT NULL DEFAULT '',
    enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    timeout     INT NOT NULL DEFAULT 600,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 全链路统一任务（Phase 8：taskId 贯穿所有环节）
CREATE TABLE IF NOT EXISTS tasks (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL DEFAULT '',
    canvas_id        TEXT NOT NULL DEFAULT '',
    agent_id         TEXT NOT NULL DEFAULT '',
    skill_id         TEXT NOT NULL DEFAULT '',
    renderer_id      TEXT NOT NULL DEFAULT '',
    provider_task_id TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent  ON tasks (agent_id);

CREATE TABLE IF NOT EXISTS task_events (
    id        BIGSERIAL PRIMARY KEY,
    task_id   TEXT NOT NULL,
    type      TEXT NOT NULL,
    payload   JSONB NOT NULL DEFAULT '{}',
    ts        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events (task_id);

CREATE TABLE IF NOT EXISTS task_results (
    task_id   TEXT PRIMARY KEY,
    content   TEXT NOT NULL DEFAULT '',
    data      JSONB NOT NULL DEFAULT '{}',
    ts        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prompt Learning 知识库（Phase 7；不使用 pgvector 扩展，保证 docker 可从零启动）
CREATE TABLE IF NOT EXISTS prompt_sources (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL DEFAULT 'markdown',
    uri         TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',
    last_sync   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prompt_knowledge (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    embedding   float8[],
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prompt_knowledge_src ON prompt_knowledge (source);

-- 默认 Renderer（Phase 5；默认禁用，配置 endpoint 后启用）
INSERT INTO renderers (id, name, type, endpoint, enabled, timeout)
SELECT 'comfy-local', '本地 ComfyUI', 'comfyui', '', FALSE, 600
WHERE NOT EXISTS (SELECT 1 FROM renderers WHERE id='comfy-local');
