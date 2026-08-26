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

-- V2.1：Token 关联 task/workflow/node + 计费预留（规格书 §32/§33）
ALTER TABLE token_usage_log ADD COLUMN IF NOT EXISTS task_id TEXT NOT NULL DEFAULT '';
ALTER TABLE token_usage_log ADD COLUMN IF NOT EXISTS workflow_id TEXT NOT NULL DEFAULT '';
ALTER TABLE token_usage_log ADD COLUMN IF NOT EXISTS node_id TEXT NOT NULL DEFAULT '';
ALTER TABLE token_usage_log ADD COLUMN IF NOT EXISTS cost NUMERIC(12,6) NOT NULL DEFAULT 0;
ALTER TABLE token_usage_log ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

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

-- MCP 客户端注册（MCP 改造：记录 Codex/Claude/WorkBuddy 等外部编程智能体）
CREATE TABLE IF NOT EXISTS mcp_clients (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'generic',
    token       TEXT NOT NULL DEFAULT '',
    permissions JSONB NOT NULL DEFAULT '[]',
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
    params      JSONB NOT NULL DEFAULT '[]',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 已有 skills 表补 params 列（幂等）
ALTER TABLE skills ADD COLUMN IF NOT EXISTS params JSONB NOT NULL DEFAULT '[]';

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

-- ============ V2 起死回生重构新增 ============

-- Canvas 对象（V2 Issue #002：画布上的文字/图片/视频/提示词等对象）
CREATE TABLE IF NOT EXISTS canvas_objects (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL DEFAULT '',
    type        TEXT NOT NULL DEFAULT 'text',
    content     JSONB NOT NULL DEFAULT '{}',
    position    JSONB NOT NULL DEFAULT '{"x":0,"y":0}',
    size        JSONB NOT NULL DEFAULT '{}',
    layer       INTEGER NOT NULL DEFAULT 0,
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_canvas_objects_project ON canvas_objects (project_id);

-- Canvas 连线（V2.1 工作流画布：节点间的有向边，持久化）
CREATE TABLE IF NOT EXISTS canvas_edges (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL DEFAULT '',
    source          TEXT NOT NULL,
    target          TEXT NOT NULL,
    source_handle   TEXT,
    target_handle   TEXT,
    type            TEXT NOT NULL DEFAULT 'workflow',
    animated        BOOLEAN NOT NULL DEFAULT TRUE,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_canvas_edges_project ON canvas_edges (project_id);
CREATE INDEX IF NOT EXISTS idx_canvas_edges_source ON canvas_edges (source);
CREATE INDEX IF NOT EXISTS idx_canvas_edges_target ON canvas_edges (target);

-- Canvas 视口（保存画布缩放/平移状态）
CREATE TABLE IF NOT EXISTS canvas_viewports (
    project_id  TEXT PRIMARY KEY,
    x           DOUBLE PRECISION NOT NULL DEFAULT 0,
    y           DOUBLE PRECISION NOT NULL DEFAULT 0,
    zoom        DOUBLE PRECISION NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Provider 商业接口（V2 Issue #006：LLM/Image/Video/TTS 等统一抽象）
CREATE TABLE IF NOT EXISTS providers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'llm',
    endpoint    TEXT NOT NULL DEFAULT '',
    api_key     TEXT NOT NULL DEFAULT '',
    models      JSONB NOT NULL DEFAULT '[]',
    status      TEXT NOT NULL DEFAULT 'disabled',
    health      JSONB NOT NULL DEFAULT '{}',
    cost_rate   NUMERIC(12,6) NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 素材库（V2 Issue #009：AI 生成结果与历史素材）
CREATE TABLE IF NOT EXISTS assets (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL DEFAULT '',
    type        TEXT NOT NULL DEFAULT 'image',
    url         TEXT NOT NULL DEFAULT '',
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_task ON assets (task_id);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';

-- tasks 表补 V2 字段（project_id / type / cost）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cost NUMERIC(12,6) NOT NULL DEFAULT 0;
-- tasks 表补 V2.1 字段（workflow_id：结果可追溯到具体工作流）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_id TEXT NOT NULL DEFAULT '';

-- ============ V2.1 核心链路：工作流 DAG 持久化 ============

-- 工作流（DAG）主表：把前端 React Flow 的 nodes + edges 完整落库，
-- 打通「保存 → 刷新 → 重启 → 恢复」闭环（规格书 §5.5/§23）。
CREATE TABLE IF NOT EXISTS workflows (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL DEFAULT '',
    name        TEXT NOT NULL DEFAULT '',
    graph       JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows (project_id);

-- ============ V2.5 Render Kernel：模型能力注册表 ============
-- 记录各渲染引擎/模型支持的 capability 标签，用于智能路由（规格书 §5）。
CREATE TABLE IF NOT EXISTS model_capabilities (
    id           TEXT PRIMARY KEY,
    engine       TEXT NOT NULL,            -- comfyui | cloud | minimax-video
    model_name   TEXT NOT NULL DEFAULT '',
    capability   TEXT NOT NULL,            -- video_generation | ip_adapter | controlnet | ...
    max_resolution TEXT,                    -- "1024x1024" 等
    video_duration_max REAL,               -- 视频最大时长（秒），NULL=不支持
    cost_per_1k_tokens REAL,               -- 计费用
    priority     INTEGER NOT NULL DEFAULT 100,
    enabled      BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_capabilities_engine ON model_capabilities (engine);
CREATE INDEX IF NOT EXISTS idx_capabilities_cap ON model_capabilities (capability);

-- 预置记录（可按需增删）
INSERT INTO model_capabilities (id, engine, model_name, capability, max_resolution, video_duration_max, cost_per_1k_tokens, priority)
VALUES
    ('minimax-h3-cloud',    'cloud',          'MiniMax-H3',         'video_generation', '1280x720',  60, 0.001,  90),
    ('minimax-h3-cloud-img', 'cloud',          'MiniMax-H3',         'image_generation', '1024x1024', NULL, 0.0005, 80),
    ('comfyui-sdxl',         'comfyui',        'SDXL',               'image_generation', '2048x2048', NULL, 0.001,  70),
    ('comfyui-sdxl-ip',      'comfyui',        'SDXL+IP-Adapter',    'ip_adapter',       '2048x2048', NULL, 0.0015, 65),
    ('comfyui-sdxl-cn',      'comfyui',        'SDXL+ControlNet',   'controlnet',       '2048x2048', NULL, 0.0015, 65),
    ('comfyui-animatediff',  'comfyui',        'SDXL+AnimateDiff',  'video_generation', '1024x1024', 30,  0.002,  60)
ON CONFLICT (id) DO NOTHING;

-- ============ V2.5 Render Kernel：渲染任务表 ============
-- 记录每次渲染提交的 RenderJob 生命周期（规格书 §4 + §6）。
CREATE TABLE IF NOT EXISTS render_jobs (
    job_id       TEXT PRIMARY KEY,
    plan_id      TEXT NOT NULL DEFAULT '',
    canvas_id    TEXT NOT NULL DEFAULT '',
    node_id      TEXT NOT NULL DEFAULT '',
    engine       TEXT NOT NULL DEFAULT 'cloud',
    status       TEXT NOT NULL DEFAULT 'queued',  -- queued|running|completed|failed|cancelled
    progress     REAL NOT NULL DEFAULT 0.0,
    output_urls  JSONB NOT NULL DEFAULT '[]',
    error        TEXT,
    plan_data    JSONB,                              -- RenderPlan 完整快照
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_render_jobs_canvas ON render_jobs (canvas_id);
CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON render_jobs (status);
CREATE INDEX IF NOT EXISTS idx_render_jobs_created ON render_jobs (created_at DESC);

-- ============ V2.5 Render Kernel：渲染任务事件流 ============
-- 记录 RenderJob 生命周期事件（created/progress/completed/failed/cancelled）。
CREATE TABLE IF NOT EXISTS render_job_events (
    id          BIGSERIAL PRIMARY KEY,
    job_id      TEXT NOT NULL,
    event       TEXT NOT NULL,              -- created|progress|completed|failed|cancelled
    payload     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_render_events_job ON render_job_events (job_id, created_at);
