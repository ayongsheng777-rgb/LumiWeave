# Infinite Canvas 商业化全链路重构与增强实施规格书

> **目标**：把当前 `infinite-canvas` 从“只有 Token 统计面板的半成品”重构为可真正运行的多智能体 AI 创作平台。
>
> **交付对象**：本文件直接交给 Codex / Claude Code / Gemini Code 等编程智能体执行。
>
> **原则**：先恢复完整主链路，再逐模块增强；禁止只做 UI 面板、Mock 数据或孤立功能。

---

## 0. 本次重构必须解决的问题

现有方案最大的问题不是“少几个功能”，而是**架构没有形成闭环**：

```text
用户
 ↓
登录 / OTP
 ↓
无限画布
 ↓
任务理解
 ↓
Agent Router
 ↓
Claude / Hermes / Workbuddy / 默认 Agent
 ↓
Skill Router
 ↓
内置 Skills
 ↓
Prompt Learning / Prompt Optimizer
 ↓
工具调用
 ├─ ComfyUI
 ├─ 图片/视频生成 API
 ├─ 文件/素材
 └─ 其他可扩展工具
 ↓
结果回写画布
 ↓
任务历史 / 素材 / Token / 成本统计
```

**禁止出现以下情况：**

1. 页面能打开，但 Agent 实际不能执行任务。
2. Token 面板有数据，但请求链路没有真正接入统计。
3. Skills 只有列表，没有实际执行能力。
4. ComfyUI 只有配置框，没有队列、进度、结果回传。
5. Agent 可以聊天，但不能调用 Skill。
6. Prompt 学习只有一个输入框，没有解析、版本、检索、注入机制。
7. OTP 只有前端页面，没有真正的服务端验证。
8. 所有功能依赖某一个 Agent，无法切换。
9. 每增加一个 Skill 都必须重新安装到 Claude / Hermes / Workbuddy。
10. Canvas、Agent、Skill、Render、Storage 之间没有统一任务 ID。

---

# 1. 产品定位

将项目定位为：

> **AI Infinite Canvas / 多智能体视觉创作工作台**

核心能力：

- 无限画布
- 多智能体
- Agent 自动路由
- Skill 中央仓库
- H3 风格 Skill
- Prompt 学习
- Prompt 优化
- ComfyUI 本地 / 云端
- 图片 / 视频生成
- Token 统计
- 成本统计
- OTP 登录
- 任务历史
- 运行日志
- 素材管理
- API / Provider 管理
- 工作流管理

---

# 2. 总体架构

推荐不要继续把所有逻辑放在前端。

```text
┌─────────────────────────────────────────────┐
│                  Web Canvas                 │
│ React / Next.js / Vite                      │
│                                             │
│ Canvas / Chat / Assets / Agents / Skills    │
└──────────────────┬──────────────────────────┘
                   │ REST / WebSocket
                   ▼
┌─────────────────────────────────────────────┐
│              AI Gateway / API               │
│                                             │
│ Auth / OTP                                  │
│ Agent Router                                │
│ Task Manager                                │
│ Skill Router                                │
│ Prompt Engine                               │
│ Usage Meter                                 │
│ ComfyUI Gateway                             │
└─────────┬─────────┬─────────┬───────────────┘
          │         │         │
          ▼         ▼         ▼
      Agents      Skills    Renderers
          │         │         │
    ┌─────┼────┐    │    ┌────┴──────┐
    │     │    │    │    │           │
 Claude Hermes Workbuddy │ Comfy Local│
                        │ Comfy Cloud│
                        │ Image APIs │
                        └────────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│                  Storage                    │
│ PostgreSQL / Redis / Object Storage         │
└─────────────────────────────────────────────┘
```

---

# 3. 推荐技术栈

## Frontend

- React
- TypeScript
- Vite 或 Next.js
- React Flow / Excalidraw / 当前 Canvas 引擎
- Zustand
- TanStack Query
- Tailwind CSS

## Backend

推荐：

- Node.js 20+
- TypeScript
- Fastify 或 NestJS
- Zod
- WebSocket
- PostgreSQL
- Redis
- Prisma 或 Drizzle

如果原项目已经存在稳定后端，不要强行替换框架，应采用**渐进式重构**。

## 部署

```text
Docker Compose
├── web
├── api
├── worker
├── postgres
├── redis
└── minio（可选）
```

---

# 4. 目录结构

最终目录至少达到：

```text
infinite-canvas/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
│
├── packages/
│   ├── agent-core/
│   ├── skill-core/
│   ├── prompt-core/
│   ├── comfyui-core/
│   ├── usage-core/
│   ├── auth-core/
│   └── shared/
│
├── skills/
│   ├── builtin/
│   │   ├── h3-prompt-writing/
│   │   ├── image-generation/
│   │   ├── video-generation/
│   │   ├── storyboard/
│   │   ├── product-ad/
│   │   └── prompt-optimizer/
│   │
│   ├── external/
│   └── learned/
│
├── workflows/
│   ├── comfyui/
│   └── templates/
│
├── prisma/
│   └── schema.prisma
│
├── docker/
├── scripts/
├── docs/
├── .env.example
├── docker-compose.yml
└── package.json
```

---

# 5. Agent 系统

## 5.1 统一 Agent 接口

所有 Agent 必须实现同一个接口。

```typescript
export interface AgentRequest {
  taskId: string;
  userId: string;
  message: string;
  systemPrompt?: string;
  skills?: SkillDescriptor[];
  context?: AgentContext;
  stream?: boolean;
}

export interface AgentResponse {
  taskId: string;
  agent: string;
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  finishReason?: string;
}

export interface AgentAdapter {
  id: string;
  name: string;

  chat(request: AgentRequest): Promise<AgentResponse>;

  stream(
    request: AgentRequest,
    onEvent: (event: AgentEvent) => void
  ): Promise<void>;

  healthCheck(): Promise<boolean>;
}
```

---

# 6. Agent Registry

不要使用原文档中：

```typescript
Map<AgentType, any>
```

必须改为强类型 Adapter。

```typescript
export type AgentType =
  | "default"
  | "claude"
  | "hermes"
  | "workbuddy";

export class AgentRegistry {
  private adapters = new Map<string, AgentAdapter>();

  register(adapter: AgentAdapter) {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): AgentAdapter {
    const adapter = this.adapters.get(id);

    if (!adapter) {
      throw new Error(`Agent ${id} not registered`);
    }

    return adapter;
  }

  list() {
    return [...this.adapters.values()].map(agent => ({
      id: agent.id,
      name: agent.name,
    }));
  }
}
```

---

# 7. Claude / Hermes / Workbuddy 接入原则

不要把三个 Agent 写死在业务代码。

使用：

```text
Agent Provider
       │
       ├── Claude
       ├── Hermes
       ├── Workbuddy
       ├── OpenAI Compatible
       ├── Custom HTTP
       └── Future Agents
```

统一配置：

```typescript
export interface AgentProviderConfig {
  id: string;
  name: string;

  protocol:
    | "anthropic"
    | "openai-compatible"
    | "custom-http";

  endpoint?: string;
  apiKey?: string;
  model: string;

  enabled: boolean;
}
```

这样未来新增：

```text
Gemini
Qwen
DeepSeek
MiniMax
GLM
OpenRouter
本地 Ollama
```

不需要改 Agent Core。

---

# 8. Agent Router

用户不应该必须手动选择 Agent。

建立：

```text
用户任务
 ↓
Task Classifier
 ↓
任务类型
 ├── 编程
 ├── Prompt
 ├── 图像
 ├── 视频
 ├── 搜索
 ├── 文案
 └── 综合任务
 ↓
Agent Router
 ↓
最佳 Agent
```

同时允许：

```text
自动
Claude
Hermes
Workbuddy
默认 Agent
```

手动锁定。

---

# 9. Skill 系统 —— 本项目核心

必须把 Skill 设计成**平台能力**，而不是某一个 Agent 的插件。

用户要求：

> 智能体可以直接调用平台已经安装的 Skill，不需要每个智能体单独安装。

因此：

```text
                    ┌─ Claude
                    │
User → Agent Router ├─ Hermes
                    │
                    └─ Workbuddy
                           │
                           ▼
                    Shared Skill Runtime
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
       Prompt Skill    Image Skill     Video Skill
           │               │               │
           └───────────────┼───────────────┘
                           ▼
                       Tool Runtime
```

---

# 10. H3 Skill 标准

MiniMax H3 当前 Skills 目录采用：

```text
skill-name/
├── SKILL.md
├── SKILL.cn.md
└── references/
```

其官方 Skills README 明确采用独立 Skill 目录和可安装 `SKILL.md` 的组织方式，并包含 `h3-prompt-writing` 以及多个视频生成类 Skill。

本项目应兼容这种结构。

来源：

https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills

---

# 11. Skill 文件标准

推荐：

```text
skills/builtin/h3-prompt-writing/

SKILL.md
SKILL.cn.md
manifest.json
references/
├── base-en.txt
└── ref-en.txt
```

`manifest.json`：

```json
{
  "id": "h3-prompt-writing",
  "name": "H3 Prompt Writing",
  "version": "1.0.0",
  "description": "Generate structured H3 video prompts",
  "runtime": "prompt",
  "entry": "SKILL.md",
  "permissions": [],
  "tags": [
    "prompt",
    "video",
    "h3"
  ]
}
```

---

# 12. Skill Runtime

核心代码：

```typescript
export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  runtime: "prompt" | "tool" | "workflow";
  entry: string;
  permissions?: string[];
  tags?: string[];
}

export interface Skill {
  manifest: SkillManifest;
  content: string;

  execute(
    args: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult>;
}
```

---

# 13. Skill Manager

```typescript
export class SkillManager {
  private skills = new Map<string, Skill>();

  register(skill: Skill) {
    this.skills.set(skill.manifest.id, skill);
  }

  get(id: string) {
    return this.skills.get(id);
  }

  list() {
    return [...this.skills.values()].map(s => s.manifest);
  }

  async execute(
    id: string,
    args: Record<string, unknown>,
    context: SkillContext
  ) {
    const skill = this.get(id);

    if (!skill) {
      throw new Error(`Skill not found: ${id}`);
    }

    return skill.execute(args, context);
  }
}
```

---

# 14. Agent 如何调用 Skill

不能只是：

```text
System Prompt:
你有 image skill
```

而应该实现真正的 Tool Calling。

例如：

```json
{
  "name": "skill.execute",
  "description": "Execute an installed platform skill",
  "parameters": {
    "type": "object",
    "properties": {
      "skill_id": {
        "type": "string"
      },
      "arguments": {
        "type": "object"
      }
    },
    "required": [
      "skill_id",
      "arguments"
    ]
  }
}
```

Agent 输出：

```json
{
  "tool": "skill.execute",
  "arguments": {
    "skill_id": "h3-prompt-writing",
    "arguments": {
      "mode": "T2VA",
      "topic": "未来城市"
    }
  }
}
```

后端：

```text
Agent
 ↓
skill.execute
 ↓
SkillManager
 ↓
Skill Runtime
 ↓
返回结果
 ↓
Agent继续推理
```

这才是真正的 Skills 集成。

---

# 15. Skill 权限系统

每个 Skill 必须声明权限。

例如：

```json
{
  "permissions": [
    "prompt.read",
    "asset.read",
    "comfyui.execute"
  ]
}
```

高风险能力：

```text
shell.execute
file.delete
network.request
database.write
```

默认关闭。

---

# 16. Skill 自动发现

启动时：

```text
skills/
 ├── builtin/
 ├── external/
 └── learned/
```

自动扫描：

```typescript
async function discoverSkills(root: string) {
  const dirs = await fs.readdir(root, {
    withFileTypes: true
  });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;

    const manifest = await loadManifest(
      path.join(root, dir.name)
    );

    if (manifest) {
      await skillManager.register(
        await loadSkill(path.join(root, dir.name))
      );
    }
  }
}
```

因此新增 Skill：

```text
复制 Skill 目录
 ↓
重启 / 热加载
 ↓
平台自动发现
 ↓
所有 Agent 可用
```

---

# 17. Skill 热加载

生产版本支持：

```http
POST /api/skills/reload
```

执行：

```text
扫描
 ↓
校验 manifest
 ↓
版本比较
 ↓
卸载旧 Skill
 ↓
加载新 Skill
 ↓
更新 Agent Tool Schema
```

不需要重启 Web。

---

# 18. ComfyUI 集成

ComfyUI 必须设计成独立 Renderer Provider。

```text
RendererRegistry
 ├── comfy-local
 ├── comfy-cloud
 ├── image-api
 └── video-api
```

---

# 19. ComfyUI 配置

```typescript
export interface ComfyUIConfig {
  id: string;
  name: string;

  endpoint: string;

  apiKey?: string;
  clientId: string;

  type: "local" | "cloud";

  enabled: boolean;

  timeout: number;
}
```

示例：

```env
COMFY_LOCAL_URL=http://127.0.0.1:8188

COMFY_CLOUD_URL=https://your-comfy-server.example.com

COMFY_CLOUD_API_KEY=xxxx
```

---

# 20. ComfyUI Connector

```typescript
export class ComfyUIConnector {
  constructor(
    private config: ComfyUIConfig
  ) {}

  async queuePrompt(workflow: unknown) {
    const response = await fetch(
      `${this.config.endpoint}/prompt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey
            ? {
                Authorization:
                  `Bearer ${this.config.apiKey}`
              }
            : {})
        },
        body: JSON.stringify({
          prompt: workflow,
          client_id: this.config.clientId
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `ComfyUI error ${response.status}`
      );
    }

    return response.json();
  }
}
```

---

# 21. ComfyUI 必须实现的功能

不能只实现 `/prompt`。

必须实现：

```text
✓ health check
✓ queue prompt
✓ query history
✓ query execution status
✓ WebSocket progress
✓ output image
✓ output video
✓ workflow template
✓ cancel task
✓ retry task
✓ timeout
✓ error recovery
```

---

# 22. ComfyUI 任务状态

统一：

```typescript
type TaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
```

所有任务都拥有：

```text
taskId
userId
canvasId
agentId
skillId
rendererId
providerTaskId
status
createdAt
updatedAt
```

---

# 23. 全链路任务 ID

这是本次重构最重要的设计之一。

一个任务：

```text
taskId = task_01J...
```

必须贯穿：

```text
Canvas
 ↓
Agent
 ↓
Skill
 ↓
Prompt
 ↓
ComfyUI
 ↓
Token
 ↓
Result
 ↓
History
```

这样可以做到：

```text
点击画布节点
 ↓
查看完整执行链
```

---

# 24. Token 统计必须从“面板”升级为“Usage Engine”

当前只做 Token 统计面板是不完整的。

Token 必须在**请求执行层实时记录**。

```typescript
export interface TokenUsage {
  taskId: string;
  userId: string;
  agentId: string;
  provider: string;
  model: string;

  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;

  totalTokens: number;

  estimatedCost?: number;

  createdAt: Date;
}
```

---

# 25. Token Meter

```typescript
export class UsageMeter {
  async record(usage: TokenUsage) {
    await db.tokenUsage.create({
      data: usage
    });

    await redis.incrby(
      `usage:${usage.userId}:tokens`,
      usage.totalTokens
    );
  }
}
```

---

# 26. Token 统计维度

必须支持：

```text
今日
昨日
本周
本月
全部
```

以及：

```text
按 Agent
按模型
按用户
按 Skill
按任务
按 Provider
```

例如：

```text
Claude
  12,400 tokens

Hermes
  8,200 tokens

Workbuddy
  4,100 tokens
```

---

# 27. 成本统计

Provider 配置：

```json
{
  "model": "example-model",
  "inputPrice": 1,
  "outputPrice": 5,
  "currency": "USD"
}
```

计算：

```text
inputTokens × inputPrice
+
outputTokens × outputPrice
```

最终显示：

```text
Token
成本
请求次数
平均耗时
成功率
```

---

# 28. OTP 登录

建议采用：

```text
TOTP
+
密码
+
Session / JWT
```

而不是单纯：

```text
OTP_SECRET_BASE
```

每个用户应该拥有自己的 secret。

数据库：

```text
users
user_authenticators
sessions
otp_audit_logs
```

---

# 29. OTP 表结构

```prisma
model UserAuthenticator {
  id          String   @id @default(cuid())
  userId      String
  type        String
  secret      String
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now())

  user User @relation(
    fields: [userId],
    references: [id]
  )
}
```

生产环境：

**secret 必须加密存储。**

---

# 30. OTP API

```http
POST /api/auth/login
POST /api/auth/otp/setup
POST /api/auth/otp/verify
POST /api/auth/logout
GET  /api/auth/me
```

登录：

```json
{
  "username": "admin",
  "password": "******",
  "otp": "123456"
}
```

服务端：

```text
password verify
 ↓
OTP verify
 ↓
session create
 ↓
JWT / Cookie
```

---

# 31. OTP 安全要求

必须：

- OTP 失败次数限制
- IP 限速
- 用户限速
- Session 失效
- Refresh Token
- CSRF 防护（Cookie 模式）
- 登录审计
- 不在日志输出 secret
- 不在前端保存 OTP secret

---

# 32. Prompt Learning

提示词学习不能简单：

```typescript
fetch(wikiUrl)
```

飞书 Wiki 通常需要对应开放平台 API / 授权机制，因此：

> URL 是知识来源入口，不等于可以直接 `fetch(url).json()`。

必须设计：

```text
Prompt Source
 ├── Feishu Wiki
 ├── Markdown URL
 ├── GitHub
 ├── Local Folder
 ├── Manual Input
 └── Future Knowledge Base
```

---

# 33. Prompt Learning Pipeline

```text
知识源
 ↓
Fetcher
 ↓
Parser
 ↓
Cleaner
 ↓
Prompt Extractor
 ↓
Classifier
 ↓
Embedding
 ↓
Vector Store
 ↓
Prompt Library
 ↓
Agent / Skill
```

---

# 34. Prompt 数据结构

```typescript
export interface LearnedPrompt {
  id: string;

  title: string;
  category: string;

  content: string;

  sourceUrl?: string;
  sourceType:
    | "feishu"
    | "github"
    | "markdown"
    | "manual";

  tags: string[];

  version: number;

  qualityScore?: number;

  createdAt: Date;
  updatedAt: Date;
}
```

---

# 35. Prompt Library

前端必须提供：

```text
Prompt 学习
├── 来源管理
├── 同步
├── 学习记录
├── Prompt 库
├── 分类
├── 标签
├── 搜索
├── 收藏
├── 版本
└── 测试
```

---

# 36. Prompt 学习不是简单注入 System Prompt

不要：

```text
agent.appendSystemContext(...)
```

这样会导致：

- Context 无限增长
- Token 浪费
- Prompt 污染
- 不同任务使用错误知识

正确方式：

```text
用户任务
 ↓
Prompt Retriever
 ↓
找到相关 Prompt
 ↓
Top-K
 ↓
Prompt Optimizer
 ↓
动态注入
```

---

# 37. Prompt RAG

推荐：

```text
PostgreSQL
+
pgvector
```

或者：

```text
Qdrant
```

对于项目初期，优先：

```text
PostgreSQL + pgvector
```

减少部署组件。

---

# 38. Prompt Optimizer

流程：

```text
原始用户需求
 ↓
任务识别
 ↓
检索 Prompt
 ↓
Skill
 ↓
优化 Prompt
 ↓
生成最终 Prompt
 ↓
执行
```

例如：

```text
用户：
帮我做一个产品宣传视频
```

系统自动：

```text
product-ad skill
+
learned prompt
+
品牌信息
+
ComfyUI workflow
```

最终生成结构化任务。

---

# 39. Canvas 节点模型

建议至少有：

```text
InputNode
TextNode
PromptNode
AgentNode
SkillNode
ImageNode
VideoNode
WorkflowNode
OutputNode
GroupNode
```

节点之间可以：

```text
Input
 ↓
Agent
 ↓
Prompt Skill
 ↓
ComfyUI
 ↓
Image
 ↓
Video
 ↓
Output
```

---

# 40. Canvas 与 Agent 的真正连接

用户在画布输入：

```text
“把这个商品图片做成15秒广告视频”
```

必须产生：

```text
Canvas Node
 ↓
task.create
 ↓
Agent Router
 ↓
Skill Router
 ↓
Prompt Optimizer
 ↓
ComfyUI
 ↓
Progress WebSocket
 ↓
Video Result
 ↓
Canvas Node
```

不是只显示一段聊天文字。

---

# 41. WebSocket

至少建立：

```text
/ws/tasks/:taskId
```

事件：

```typescript
type TaskEvent =
  | {
      type: "task.created";
    }
  | {
      type: "agent.started";
      agent: string;
    }
  | {
      type: "skill.started";
      skill: string;
    }
  | {
      type: "render.progress";
      progress: number;
    }
  | {
      type: "task.completed";
      result: unknown;
    }
  | {
      type: "task.failed";
      error: string;
    };
```

---

# 42. 统一 API

## Auth

```text
POST /api/auth/login
POST /api/auth/otp/verify
POST /api/auth/logout
GET  /api/auth/me
```

## Agents

```text
GET  /api/agents
POST /api/agents
PUT  /api/agents/:id
POST /api/agents/:id/test
```

## Skills

```text
GET  /api/skills
POST /api/skills
POST /api/skills/:id/execute
POST /api/skills/reload
DELETE /api/skills/:id
```

## Tasks

```text
POST /api/tasks
GET  /api/tasks/:id
POST /api/tasks/:id/cancel
POST /api/tasks/:id/retry
```

## ComfyUI

```text
GET  /api/renderers
POST /api/renderers
POST /api/renderers/:id/test
POST /api/renderers/:id/workflows
```

## Prompt

```text
GET  /api/prompts
POST /api/prompts
POST /api/prompts/learn
POST /api/prompts/search
POST /api/prompts/optimize
```

## Usage

```text
GET /api/usage/summary
GET /api/usage/timeseries
GET /api/usage/by-agent
GET /api/usage/by-model
GET /api/usage/by-skill
```

---

# 43. 数据库

至少：

```text
users
sessions
user_authenticators

agents
agent_providers

skills
skill_versions
skill_permissions

tasks
task_events
task_results

prompts
prompt_sources
prompt_versions
prompt_embeddings

renderers
renderer_workflows

token_usage
provider_pricing

assets
canvas_projects
canvas_nodes
canvas_edges
```

---

# 44. Task 表

核心字段：

```prisma
model Task {
  id              String   @id @default(cuid())
  userId          String

  canvasId        String?
  agentId         String?
  skillId         String?
  rendererId      String?

  status          String

  input           Json
  output          Json?

  error           String?

  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

---

# 45. 全链路日志

每一步都写：

```text
task_events
```

示例：

```json
{
  "taskId": "task_xxx",
  "type": "skill.started",
  "payload": {
    "skill": "h3-prompt-writing"
  },
  "timestamp": "..."
}
```

这样可以实现：

```text
任务详情
 ↓
执行时间线
```

用户能够看到：

```text
08:30 Task Created
08:30 Agent Selected
08:30 Prompt Skill
08:31 ComfyUI Queued
08:32 25%
08:33 70%
08:34 Completed
```

---

# 46. 前端页面

必须完成：

```text
/
├── Login
├── Canvas
├── Tasks
├── Assets
├── Agents
├── Skills
├── Prompts
├── Renderers
├── Usage
├── Settings
└── System Logs
```

---

# 47. Canvas 页面布局

建议：

```text
┌──────────────────────────────────────────┐
│ Logo | Project | Agent | Run | Settings │
├────────┬───────────────────────┬─────────┤
│ Nodes  │                       │ AI      │
│ Tools  │       Canvas          │ Chat    │
│ Skills │                       │         │
│ Assets │                       │         │
├────────┴───────────────────────┴─────────┤
│ Status | Task | Token | Progress         │
└──────────────────────────────────────────┘
```

---

# 48. Skills 页面

必须支持：

```text
已安装
官方
外部
学习
禁用
```

每个 Skill：

```text
名称
版本
描述
来源
权限
支持 Agent
支持 Renderer
最后更新时间
启用 / 禁用
```

---

# 49. Agent 页面

支持：

```text
Claude
Hermes
Workbuddy
Default
Custom
```

显示：

```text
连接状态
Endpoint
Model
Token
延迟
最近错误
```

增加：

```text
测试连接
```

---

# 50. ComfyUI 页面

必须支持多个节点：

```text
ComfyUI Local
ComfyUI Cloud 1
ComfyUI Cloud 2
```

每个：

```text
名称
Endpoint
API Key
类型
状态
延迟
GPU 信息
```

按钮：

```text
测试连接
设为默认
禁用
```

---

# 51. Workflow 管理

不要让用户每次手工上传 workflow。

支持：

```text
Workflow Library
├── Text → Image
├── Image → Image
├── Text → Video
├── Image → Video
├── Upscale
├── Background Remove
└── Custom
```

Workflow：

```json
{
  "id": "txt2img-default",
  "renderer": "comfy-local",
  "workflow": {}
}
```

---

# 52. Worker

长任务不能阻塞 API。

必须：

```text
API
 ↓
Redis Queue
 ↓
Worker
 ↓
Agent / Skill / ComfyUI
```

建议 BullMQ。

任务：

```text
agent.task
skill.task
render.task
prompt.learn
asset.process
```

---

# 53. 错误恢复

所有长任务：

```text
timeout
retry
cancel
resume
```

例如 ComfyUI：

```text
API提交成功
 ↓
WebSocket断开
 ↓
Worker查询 history
 ↓
恢复任务状态
```

不能因为 WebSocket 断开就认为任务失败。

---

# 54. Provider 故障转移

Agent：

```text
Claude
 ↓失败
Hermes
 ↓失败
Workbuddy
 ↓失败
Default
```

但必须区分：

```text
业务失败
Provider失败
网络失败
限流
余额不足
模型不存在
```

不能所有异常都自动切换。

---

# 55. 安全模型

Agent / Skill / Renderer 均需要权限。

```text
User
 ↓
Role
 ↓
Permission
 ↓
Tool
```

例如：

```text
admin
  *
```

普通用户：

```text
agent.use
skill.use
render.use
prompt.read
asset.read
```

禁止：

```text
user.delete
system.config
shell.execute
```

---

# 56. API Key 安全

禁止：

```text
前端 localStorage
```

保存：

```text
Claude API Key
ComfyUI API Key
Workbuddy Key
```

必须：

```text
Backend
 ↓
Encrypted Secret Storage
```

前端只显示：

```text
sk-****abcd
```

---

# 57. 环境变量

`.env.example`：

```env
NODE_ENV=production

DATABASE_URL=postgresql://postgres:postgres@postgres:5432/infinite_canvas

REDIS_URL=redis://redis:6379

JWT_SECRET=change-me

SESSION_SECRET=change-me

# Agents
CLAUDE_API_KEY=
CLAUDE_MODEL=

HERMES_API_ENDPOINT=
HERMES_API_KEY=
HERMES_MODEL=

WORKBUDDY_API_ENDPOINT=
WORKBUDDY_API_KEY=
WORKBUDDY_MODEL=

# ComfyUI
COMFY_LOCAL_URL=http://host.docker.internal:8188
COMFY_CLOUD_URL=
COMFY_CLOUD_API_KEY=

# Storage
S3_ENDPOINT=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_BUCKET=

# Prompt Learning
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_WIKI_URL=
```

---

# 58. Docker Compose

推荐：

```yaml
services:

  web:
    build: ./apps/web
    ports:
      - "3000:3000"
    depends_on:
      - api

  api:
    build: ./apps/api
    ports:
      - "4000:4000"
    env_file:
      - .env
    depends_on:
      - postgres
      - redis

  worker:
    build: ./apps/worker
    env_file:
      - .env
    depends_on:
      - postgres
      - redis

  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: infinite_canvas
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

---

# 59. Docker 中连接宿主机 ComfyUI

Windows / Docker Desktop：

```env
COMFY_LOCAL_URL=http://host.docker.internal:8188
```

不要使用：

```env
127.0.0.1
```

因为容器内：

```text
127.0.0.1
```

指向的是容器自身。

---

# 60. 开发环境

要求：

```text
Node.js >= 20
Bun >= 1.x
Docker Desktop
Git
```

安装：

```bash
bun install
```

数据库：

```bash
docker compose up -d postgres redis
```

迁移：

```bash
bunx prisma migrate dev
```

开发：

```bash
bun run dev
```

---

# 61. 构建

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

Docker：

```bash
docker compose build
docker compose up -d
```

查看：

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f worker
```

---

# 62. 首次启动流程

系统启动必须自动完成：

```text
1. 数据库连接
2. Redis连接
3. 数据库 migration
4. 创建 admin
5. 初始化 Agent Registry
6. 扫描 Skills
7. 初始化 Prompt Library
8. 初始化 Renderer Registry
9. 启动 Worker
10. WebSocket
11. Health Check
```

---

# 63. Health API

```http
GET /health
GET /health/agents
GET /health/skills
GET /health/renderers
GET /health/database
GET /health/redis
```

输出：

```json
{
  "status": "ok",
  "database": "ok",
  "redis": "ok",
  "agents": 3,
  "skills": 12,
  "renderers": 2
}
```

---

# 64. Codex 实施顺序

**绝对不要一次性让 Codex 随意改整个项目。**

按照以下阶段执行。

## Phase 0 —— 项目审计

先让 Codex：

```text
扫描整个仓库。

输出：
1. 当前技术栈
2. 当前目录
3. 当前启动方式
4. 当前 Canvas
5. 当前 Agent
6. 当前 API
7. 当前数据库
8. 当前 Token 统计
9. 当前 Docker
10. 缺失功能
```

**禁止修改代码。**

---

# 65. Phase 1 —— 恢复可运行基础链路

完成：

```text
Web
 ↓
API
 ↓
DB
 ↓
Redis
```

验收：

```bash
docker compose up -d
curl /health
```

---

# 66. Phase 2 —— Agent Core

完成：

```text
AgentAdapter
AgentRegistry
AgentRouter
Provider Config
Streaming
Usage Meter
```

验收：

```text
Claude 可以调用
Hermes 可以调用
Workbuddy 可以调用
```

---

# 67. Phase 3 —— Skill Core

完成：

```text
SkillManifest
SkillLoader
SkillManager
SkillRuntime
SkillPermission
Skill.execute
```

验收：

```text
安装一个 Skill
 ↓
所有 Agent 自动获得
 ↓
Agent Tool Calling
 ↓
Skill 执行
 ↓
返回结果
```

---

# 68. Phase 4 —— H3 Skills

导入：

```text
h3-prompt-writing
```

再逐步导入：

```text
minimalist-product-ad-generator
3d-animation-short-generator
papercraft-stop-motion-explainer
brand-promo-video-generator
music-video-subtitle-generator
co-op-game-intro-generator
paper-collage-explainer-generator
handdrawn-live-video-generator
```

不要修改原 Skill 内容作为第一步。

使用 Adapter 加载。

---

# 69. Phase 5 —— ComfyUI

完成：

```text
RendererRegistry
ComfyUIConnector
Queue
History
WebSocket
Workflow
Result
Retry
Cancel
```

验收：

```text
Canvas
 ↓
Image Prompt
 ↓
ComfyUI
 ↓
生成图片
 ↓
图片回到 Canvas
```

---

# 70. Phase 6 —— OTP

完成：

```text
User
 ↓
Password
 ↓
OTP
 ↓
Session
```

验收：

```text
正确 OTP → 登录成功
错误 OTP → 拒绝
重复失败 → 限速
退出 → Session失效
```

---

# 71. Phase 7 —— Prompt Learning

完成：

```text
Source
 ↓
Fetcher
 ↓
Parser
 ↓
Prompt Extractor
 ↓
Embedding
 ↓
Prompt DB
 ↓
Retriever
```

先实现：

```text
Markdown
GitHub
Manual
```

再实现：

```text
Feishu Wiki
```

这样避免一开始被第三方授权阻塞。

---

# 72. Phase 8 —— 全链路

最终：

```text
Canvas
 ↓
Task
 ↓
Agent
 ↓
Skill
 ↓
Prompt
 ↓
Renderer
 ↓
Result
 ↓
Usage
 ↓
History
```

每个环节都有：

```text
taskId
```

---

# 73. 自动化测试

至少：

```text
tests/
├── auth/
├── agents/
├── skills/
├── prompt/
├── comfyui/
├── tasks/
├── usage/
└── e2e/
```

---

# 74. 必测用例

## Agent

```text
[ ] Claude 请求成功
[ ] Hermes 请求成功
[ ] Workbuddy 请求成功
[ ] Provider 失败
[ ] 自动 fallback
[ ] Streaming
```

## Skill

```text
[ ] Skill 自动发现
[ ] Skill 加载
[ ] Skill 执行
[ ] Agent 调用 Skill
[ ] 权限拒绝
[ ] 热加载
```

## ComfyUI

```text
[ ] Local
[ ] Cloud
[ ] Queue
[ ] Progress
[ ] Result
[ ] Cancel
[ ] Retry
```

## OTP

```text
[ ] Login
[ ] OTP
[ ] Wrong OTP
[ ] Rate limit
[ ] Logout
```

## Token

```text
[ ] Agent 请求记录
[ ] Skill 请求记录
[ ] 输入 Token
[ ] 输出 Token
[ ] 总 Token
[ ] 成本
[ ] 按日统计
```

---

# 75. 最终验收标准

项目只有达到以下状态才算完成。

### A. 登录

```text
打开网站
 ↓
登录
 ↓
OTP
 ↓
进入 Canvas
```

### B. Agent

```text
输入：
“帮我生成一个产品广告视频”
```

系统：

```text
创建 Task
 ↓
选择 Agent
 ↓
选择 Skill
 ↓
学习 Prompt
 ↓
生成最终 Prompt
```

### C. ComfyUI

```text
调用 ComfyUI
 ↓
队列
 ↓
实时进度
 ↓
生成
 ↓
结果进入 Canvas
```

### D. Token

```text
任务结束
 ↓
Token 自动增加
 ↓
Dashboard 自动刷新
```

### E. Skill

```text
新增加：

skills/external/my-skill/

 ↓

自动发现

 ↓

Claude / Hermes / Workbuddy
全部立即可用
```

### F. Prompt Learning

```text
添加知识源
 ↓
同步
 ↓
解析
 ↓
Prompt Library
 ↓
用户任务
 ↓
自动检索
 ↓
优化 Prompt
 ↓
Agent 执行
```

---

# 76. Codex 必须遵守的开发规则

把下面规则直接作为执行约束。

```text
1. 不允许用 Mock 数据冒充真实功能。
2. 不允许只做前端 UI。
3. 不允许删除现有可用 Canvas 功能。
4. 不允许把 API Key 暴露到浏览器。
5. 不允许把 Skill 绑定到单个 Agent。
6. 不允许把 Token 统计写成独立假面板。
7. 所有执行任务必须拥有 taskId。
8. 所有长任务必须进入 Worker。
9. 所有任务必须产生 task_events。
10. 所有 Agent 必须实现统一 Adapter。
11. 所有 Skill 必须实现统一 Manifest。
12. 所有 Renderer 必须实现统一 Provider。
13. 所有第三方调用必须有 timeout。
14. 所有第三方调用必须有错误处理。
15. 所有长任务必须支持 retry。
16. WebSocket 断开不能直接判定任务失败。
17. 数据库 migration 必须可重复部署。
18. Docker 必须可以从零启动。
19. 必须提供 .env.example。
20. 每完成一个阶段必须运行测试。
21. 不允许为了实现新功能而大面积重写稳定代码。
22. 优先复用当前项目已有组件。
23. 不确定原项目结构时先扫描，不允许猜目录。
24. 发现当前实现与本文冲突时，以实际代码为准，并建立兼容层。
25. 禁止留下 TODO 作为核心功能替代品。
```

---

# 77. 最终 Codex Prompt

把下面内容作为 Codex 的总任务：

```text
你现在负责重构 infinite-canvas。

目标不是增加一个 Token Dashboard，而是把项目升级成完整的多智能体 AI Infinite Canvas 平台。

必须实现：

1. Claude Agent
2. Hermes Agent
3. Workbuddy Agent
4. OpenAI-Compatible Agent Provider
5. Agent Registry
6. Agent Router
7. Streaming
8. Token Usage Engine
9. Cost Tracking
10. OTP/TOTP Login
11. Shared Skill Runtime
12. Skill Registry
13. Skill Manifest
14. Skill Permission
15. Skill Hot Reload
16. MiniMax H3 Skill 格式兼容
17. h3-prompt-writing
18. 视频/广告/Storyboard 等 H3 Skills
19. ComfyUI Local
20. ComfyUI Cloud
21. ComfyUI Queue
22. ComfyUI Progress
23. ComfyUI History
24. ComfyUI Retry
25. ComfyUI Cancel
26. Workflow Library
27. Prompt Learning
28. Feishu Wiki Connector
29. GitHub/Markdown Prompt Source
30. Prompt RAG
31. Prompt Optimizer
32. Canvas Task Graph
33. Task Event Timeline
34. Redis Worker
35. PostgreSQL
36. WebSocket
37. Assets
38. Usage Dashboard
39. Agent Dashboard
40. Skill Dashboard
41. Renderer Dashboard
42. E2E Tests
43. Docker Compose
44. Health Checks

重要：

先扫描现有仓库。

不要直接修改。

先输出：

ARCHITECTURE_AUDIT.md

内容包括：

- 当前架构
- 当前文件结构
- 当前启动方式
- 当前 Canvas 实现
- 当前 Agent
- 当前 API
- 当前 Token
- 当前数据库
- 当前 Docker
- 当前可复用代码
- 当前缺失功能
- 与目标架构的差距

然后按 Phase 0 → Phase 8 实施。

每一个 Phase：

1. 修改代码
2. 编译
3. 类型检查
4. 单元测试
5. E2E 测试
6. 修复问题
7. 输出变更报告

严禁只创建 UI。

任何按钮必须连接真实 API。

任何统计必须来自真实请求。

任何 Skill 必须能够真实执行。

任何 Agent 必须能够真实调用 Skill。

任何 ComfyUI 任务必须能够真实产生结果。

最终必须做到：

Canvas → Task → Agent → Skill → Prompt → Renderer → Result → Usage → History

完整闭环。
```

---

# 78. 推荐开发顺序总结

```text
第一阶段
基础架构
    ↓
第二阶段
Agent Core
    ↓
第三阶段
Skill Runtime
    ↓
第四阶段
H3 Skills
    ↓
第五阶段
ComfyUI
    ↓
第六阶段
Prompt Learning
    ↓
第七阶段
OTP + Security
    ↓
第八阶段
Token / Cost
    ↓
第九阶段
Canvas 全链路
    ↓
第十阶段
E2E + Docker + 商业化验收
```

---

# 79. 本项目真正的核心

最终不要把它理解成：

```text
一个 Canvas
+
一个聊天框
+
一个 Token 面板
```

而应该是：

```text
                 Infinite Canvas
                       │
                       ▼
                  Task Engine
                       │
              ┌────────┴────────┐
              ▼                 ▼
         Agent Runtime      Skill Runtime
              │                 │
      ┌───────┼──────┐          │
      ▼       ▼      ▼          ▼
   Claude   Hermes Workbuddy   H3 Skills
              │                 │
              └────────┬────────┘
                       ▼
                 Prompt Engine
                       │
                       ▼
                Renderer Engine
                       │
              ┌────────┴────────┐
              ▼                 ▼
         ComfyUI Local      ComfyUI Cloud
              │                 │
              └────────┬────────┘
                       ▼
                    Assets
                       │
                       ▼
                  Canvas Result
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
          Token                 History
             │
             ▼
          Billing
```

**这才是本项目后续商业化的正确底层形态。**

---

# 80. 重要参考

MiniMax H3 Skills 当前采用独立 Skill 目录、`SKILL.md`、参考资料等组织方式，本方案以其作为 Skill 文件兼容标准之一，而不是把 H3 Skill 强行绑定到 H3 Agent。

- MiniMax H3 Skills：
  https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills
- MiniMax H3 Skills README：
  https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/README.md
- 原始 infinite-canvas 增强文档：本项目现有附件《Infinite Canvas 增强与集成构建指南》

---

# 81. 最终交付物

Codex 最终必须产生：

```text
docs/
├── ARCHITECTURE_AUDIT.md
├── ARCHITECTURE.md
├── AGENT_ARCHITECTURE.md
├── SKILL_ARCHITECTURE.md
├── COMFYUI_ARCHITECTURE.md
├── PROMPT_LEARNING.md
├── AUTH_SECURITY.md
├── TOKEN_USAGE.md
├── API_REFERENCE.md
├── DATABASE.md
├── DEPLOYMENT.md
├── TEST_PLAN.md
└── ACCEPTANCE_REPORT.md
```

以及实际代码：

```text
apps/web
apps/api
apps/worker

packages/agent-core
packages/skill-core
packages/prompt-core
packages/comfyui-core
packages/usage-core
packages/auth-core

skills/builtin
skills/external
skills/learned
```

最终命令必须能够完成：

```bash
git clone <repo>
cd infinite-canvas
cp .env.example .env
docker compose up -d --build
```

然后：

```text
浏览器
 ↓
登录
 ↓
OTP
 ↓
Canvas
 ↓
选择/自动选择 Agent
 ↓
调用 Skill
 ↓
学习 Prompt
 ↓
ComfyUI 生成
 ↓
结果回 Canvas
 ↓
Token 自动统计
 ↓
任务历史可追溯
```

**以此作为最终完成标准。**
