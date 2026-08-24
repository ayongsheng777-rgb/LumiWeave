# AGENTS.md — 绵绣 LumiWeave 维护手册

> 本文是项目交接与长期维护的总入口。动手前先读这里。
> 架构细节拆在 `docs/` 下 12 篇，本文只放「最快能上手」的东西。

## 一、项目定位

V2 目标：**AI 原生无限画布创作平台**——画布是主产品，AI 是画布的操作系统（Canvas → Chat → Agent → Skill → Provider → Renderer → Result → Asset 全链路闭环）。

> 🔴 当前在 `feature/v2-rebirth` 分支做 V2 重构（见「V2 重构进度」章节）。master 还是上一版「多智能体 + 工作流节点编辑器」形态。

⚠️ 真实项目是 **Python FastAPI 后端**（`backend/`），不是 Node/TS 的 `infinite-canvas`。旧 TS 参考方案见 `绵绣LumiWeave项目文档.md`（仅供参考，已不适用）。

## 一·五、V2 重构进度（2026-08-24，进行中）

V2 按《LumiWeave V2 起死回生重构实施总规格书》10 个 Issue 推进，分支 `feature/v2-rebirth`。

**已完成 ✅**
- 数据库：`canvas_objects` / `providers` / `assets` 三张新表；`tasks` 补 `project_id`/`type`/`cost` 字段（`init_db.sql` 幂等，已落库）。
- 后端新模块：`app/canvas/`（画布对象 CRUD）、`app/providers/`（Provider 抽象 + 评分路由）、`app/assets/`（素材库）、`app/layout/`（排版引擎）、`app/tools/canvas_tools.py`（AI 画布工具，register_tool 接入 skill 运行时）。
- 新路由：`/api/canvas`、`/api/providers`、`/api/assets`、`/api/layout`。
- 前端：`src/canvas/`（CanvasCore/CanvasToolbar/LayerPanel/objectNodes）+ `store/canvasStore.ts`（对象 + 撤销重做 + 图层）；`ChatWorkspace` 改成「画布为主 + AI 助手侧栏」。
- 前端画布对象 CSS + 构建验证（tsc + vite build 通过，v2-workspace/obj-node/layer-panel 样式齐全）。
- Chat↔Canvas 双向联动（AI 回复自动落 ai_result 对象；用户消息「展开到画布」落 prompt 对象）。
- Provider / Asset 管理面板接入 Dashboard（新增「接口」「素材」两个 tab）。
- Layout 引擎前端接入（CanvasToolbar「一键排版」下拉已接 /api/layout/apply）。
- 后端 V2 模块已 build 进镜像，/api/canvas /providers /assets /layout 回归全部通过。
- Token Dashboard 降级为 Project Usage（新增 `/api/token-usage/project-usage` 聚合 AI 调用/图片/视频/任务/Token/成本；前端「计费」tab 改「项目用量」总览卡片，Token 明细降级到下方）。

**待办（外部条件）**：真实出图需配 Image/Video Provider（api_key），ComfyUI 实例等。

> 重构原则：**保留 FastAPI/React/PG/Redis/Agent/Skill/Provider/Renderer/Knowledge，不推倒重写**；Workflow 不删，降级为「高级模式」；旧 `WorkflowCanvas.tsx`（节点连线）不再是主画布。

## 二、服务拓扑与端口

| 服务 | 镜像 | 宿主端口 → 容器 | 说明 |
|---|---|---|---|
| postgres | postgres:16.4-alpine | 5435 → 5432 | 主库 |
| redis | redis:7.4-alpine | 6385 → 6379 | 缓存 |
| backend | python:3.12.5-slim | 8900 → 8000 | FastAPI 主服务 |
| frontend | nginx | 3010 → 80 | 静态 + `/api` 反代 |

数据库：`postgresql://lumiweave:lumiweave2026@postgres:5432/lumiweave`（容器内），宿主连 `localhost:5435`。

数据表：`agents` / `skills` / `renderers` / `tasks` / `task_events` / `task_results` / `token_usage_log` / `model_pricing` / `app_kv` / `prompt_sources` / `prompt_knowledge`；【V2 新增】`canvas_objects` / `providers` / `assets`。

## 三、启动 / 重启 SOP

```bash
cd 绵绣LumiWeave

# 从零启动
cp .env.example .env
docker compose up -d --build

# 只改 backend/app/*.py 或 backend/skills/*  → 重建 backend（无 bind mount，必须 build）
docker compose build backend && docker compose up -d backend

# 只改环境变量（.env / docker-compose.yml）→ 重建对应服务
docker compose up -d --build backend

# 改前端 frontend/ → 重建 frontend
docker compose build frontend && docker compose up -d frontend
```

🔴 **已有数据卷加新表**（`init_db.sql` 只在容器首次创建时执行，之后不再自动跑）：

```bash
docker compose exec -T postgres psql -U lumiweave -d lumiweave -f /docker-entrypoint-initdb.d/01_init.sql
```

（所有表 `IF NOT EXISTS`，幂等，可反复执行。）

## 四、登录与认证

- 首次登录：`GET /api/auth/setup` 返回密钥 + 二维码；未设 `OTP_SECRET` 时展示。
- 登录：`POST /api/auth/login` 传 `{"otp":"6位动态码"}` → 返回 `{token, expires, ttl}`。
- 其它接口带 `Authorization: Bearer <token>`，白名单只有 `/api/health` 和 `/api/auth/*`。
- 重置 OTP：`POST /api/auth/otp-reset`（需有效 token + 当前动态码；固定 `OTP_SECRET` 模式禁止在线重置）。
- 验证器：Google Authenticator / 1Password / Authy，RFC 6238 TOTP（HMAC-SHA1，30s，6 位）。

## 五、后端模块地图

```
backend/
├── app/
│   ├── main.py          入口：中间件 + 路由挂载 + lifespan 启动加载
│   ├── config.py        Settings + AI_OVERRIDES 运行时覆盖层
│   ├── db.py            asyncpg 连接池（execute/fetch/fetchrow）
│   ├── auth.py          OTP/TOTP + 会话 token
│   ├── task_service.py  统一 taskId：create_task/add_event/set_status/set_result
│   ├── ai/              AI 模型层（client/registry/auto_best/persist/routes）
│   ├── agent/           Agent Core（adapter/registry/router/provider/routes + engine/workflow_routes）
│   ├── skills/          Skill Core（manifest/loader/manager/runtime/permissions/routes）
│   ├── renderers/       ComfyUI（registry/comfyui/routes）
│   ├── prompt_learning/ RAG（embedder/store/source/extractor/retriever/routes）
│   ├── canvas/          【V2】画布对象 CRUD（service/routes）
│   ├── providers/       【V2】Provider 抽象 + 质量/速度/成本评分路由（service/routes）
│   ├── assets/          【V2】素材库（service/routes）
│   ├── layout/          【V2】专业排版引擎：对齐/分布/网格 + 海报/小红书/PPT/电商/杂志模板（engine/routes）
│   ├── tools/           【V2】AI 画布工具 canvas.create/list/update/delete/move/resize/layout（canvas_tools）
│   └── token_usage/     Token 统计计费（V2 将降级为 Project Usage）
├── skills/              平台技能目录（builtin/external/learned）
├── init_db.sql          建表（幂等）
└── Dockerfile           多阶段；COPY app + skills + init_db.sql
```

## 六、设计决策（为什么这么做）

1. **统一 taskId**：`tasks/task_events/task_results` 三表贯穿所有环节，WebSocket 断开不判失败（spec rule #16）。
2. **统一 Adapter/Manifest/Provider**：Agent、Skill、Renderer 各自统一接口，新增能力不改核心（rule #10/#11/#12）。
3. **第三方调用全部 timeout + 错误处理**，长任务支持 retry（rule #13/#14/#15）。
4. **无 mock**：所有统计/技能/Agent 都接真实 API（rule #1/#2）。
5. **Prompt RAG 不用 pgvector 扩展**：向量存 `float8[]`，余弦相似度在 Python 算，保证 docker 从零启动（rule #18）。
6. **AI 覆盖层**：`AI_OVERRIDES` 只改 model/active、不动 API Key，持久化到 `app_kv(key=ai_overrides)`。

## 七、踩坑记录（已修，别再犯）

1. **asyncpg 的 jsonb 是「字符串透传」**：写入必须 `json.dumps(obj)`，读取必须 `json.loads(str)`。直接传 Python list/dict 会报 `DataError: expected str, got list`。skills 的 permissions/tags 读取用了 `_parse_json_list`。
2. **skills 目录路径差一级**：`loader.py` 在 `/app/app/skills/`，`parent.parent` = `/app/app` 是错的；skills 在 `/app/skills`（与 app 同级）。用 `APP_DIR.parent / "skills"`。
3. **单例放错模块**：`skill_manager` 在 `app.skills.__init__`（不是 `app.skills.manager`）；`embedder` 单例在 `app.prompt_learning.embedder`。
4. **Windows 下别把 `/d/...` 路径传给 python**：Git Bash 的 `/d/` 映射 python 不认，要用盘符 `D:/...`。
5. **改代码必须 build**：backend 无 bind mount，改 `.py` 或 skills 只 restart 不生效，必须 `build backend`。
6. **nginx 反代走 IPv6 导致页面加载失败**：Docker Desktop 会给容器分配 IPv6（`fd7c:...`），nginx `proxy_pass http://backend:8000` 优先解析 IPv6，但 backend 的 uvicorn 只监听 IPv4 → `connect() failed (111: Connection refused)`，间歇性导致前端卡在「加载中」。修法（frontend/nginx.conf）：`resolver 127.0.0.11 ipv6=off valid=30s; set $backend_upstream http://backend:8000; proxy_pass $backend_upstream;` 强制 IPv4。
7. **asyncpg 的 `($1 || ' days')::interval` 传 int 报错**：`DataError: expected str, got int`，改 `make_interval(days => $1)` 传整型；`pricing.summary` 里 LATERAL join 的 `p.input_per_million/p.output_per_million` 必须加进 `GROUP BY`，否则报 `GroupingError`。
8. **React Flow 死循环（React error #185）**：`CanvasCore` 里 `useCanvasStore()` 无参订阅整个 store，`onSelectionChange` 里 `setSelected` 改 `selectedIds` → 组件重渲染 → ReactFlow 又回调 `onSelectionChange` → 无限循环，主界面白屏。修法：① 用 selector 精确订阅（`useCanvasStore((s)=>s.objects)` 等），**不订阅 selectedIds**；② 不要把 `selected` 塞进受控 node（选区由 ReactFlow 内部管理，仅经 onSelectionChange 同步回 store）。排查手段：用 puppeteer-core + 系统 Chrome headless 登录抓 `pageerror`（Minified React error #185 = 死循环）。

## 八、常用命令速查

```bash
# 看状态 / 日志
docker compose ps
docker compose logs --tail=50 backend

# 容器内 import 冒烟（快速定位导入错误，不用反复起服务）
docker compose exec -T backend python -c "import app.main; print('IMPORT_OK')"

# 全链路验收脚本（真实 TOTP 登录 + 端点回归）
SECRET=$(docker compose exec -T backend cat /app/data/otp_secret | tr -d '\r\n ') \
  OTP_SECRET="$SECRET" python D:/WorkBuddy/tmp/verify_lumiweave_phases.py
```

## 九、文档索引（docs/）

`ACCEPTANCE_REPORT`（验收）、`ARCHITECTURE`、`AGENT_ARCHITECTURE`、`SKILL_ARCHITECTURE`、`COMFYUI_ARCHITECTURE`、`PROMPT_LEARNING`、`AUTH_SECURITY`、`TOKEN_USAGE`、`API_REFERENCE`、`DATABASE`、`DEPLOYMENT`、`TEST_PLAN`。

## 十、待办（外部条件启用，非缺陷）

- 真实 LLM 出字：配 `AI_API_KEY`。
- Claude/Hermes/Workbuddy 实调：各自 key（`ANTHROPIC_API_KEY`/`HERMES_*`/`WORKBUDDY_*`）。
- ComfyUI 实产图：配可访问实例 + 启用 renderer。
- 语义向量：配 `EMBEDDING_BASE_URL` + `EMBEDDING_API_KEY`（现在本地哈希降级）。
- 前端 3010 尚未接 Agent/Skill/Renderer 新面板（后端接口已就绪）。
