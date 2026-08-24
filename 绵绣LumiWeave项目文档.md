# Infinite Canvas 增强与集成构建指南

本文档提供了针对 `infinite-canvas` 项目的全面升级方案，涵盖多智能体支持、ComfyUI 渲染接入、安全性增强、令牌统计、灵活 Skills 架构集成以及提示词学习功能的实现指导与核心源代码。

## 1. 架构概览

此次升级旨在将 `infinite-canvas` 打造成一个全链路畅通的智能创作平台：
*   **多智能体支持**：扩展原生 Agent 架构，无缝接入 Claude, Hermes, Workbuddy 等模型。
*   **ComfyUI 集成**：支持配置本地或云端 (如 AutoDL) ComfyUI 节点进行高质量图像/视频渲染。
*   **安全与统计**：实现 OTP (一次性密码) 验证登录，并在全链路中加入 Token 消耗统计。
*   **动态 Skills 架构**：参考 MiniMax-H3 架构，实现技能插件的热插拔，智能体可直接调用，无需单独安装。
*   **提示词学习系统**：通过接入外部知识库（如飞书 Wiki），实现提示词的动态学习与更新。

---

## 2. 核心模块源代码指导

### 2.1 多智能体注册中心 (Agent Registry)
扩展 `src/agent/types.ts` 和代理池，支持多种协议的智能体。

```typescript
// src/agent/registry.ts
import { ClaudeAgent } from './claude';
import { HermesAgent } from './hermes';
import { WorkbuddyAgent } from './workbuddy';

export type AgentType = 'claude' | 'hermes' | 'workbuddy' | 'default';

export class AgentRegistry {
  private agents = new Map<AgentType, any>();

  constructor() {
    this.agents.set('claude', new ClaudeAgent());
    this.agents.set('hermes', new HermesAgent());
    this.agents.set('workbuddy', new WorkbuddyAgent());
  }

  getAgent(type: AgentType) {
    return this.agents.get(type);
  }
}
```

### 2.2 ComfyUI 本地与云端连接器
在 `src/services/api/` 下新增 `comfyui.ts` 用于处理工作流调度。

```typescript
// src/services/api/comfyui.ts
export interface ComfyUIConfig {
  endpoint: string; // 本地 http://127.0.0.1:8188 或云端地址
  clientId: string;
}

export class ComfyUIConnector {
  constructor(private config: ComfyUIConfig) {}

  async queuePrompt(promptWorkflow: any) {
    const response = await fetch(`${this.config.endpoint}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptWorkflow, client_id: this.config.clientId })
    });
    return response.json();
  }
  
  // WebSocket 监听进度...
}
```

### 2.3 OTP 验证与 Token 统计
在服务端接口层面增加验证与中间件拦截。

```typescript
// src/server/auth.ts (伪代码示例)
import { generateSecret, verifyToken } from 'node-2fa';

export const verifyOTP = (token: string, secret: string) => {
  return verifyToken(secret, token);
};

// src/server/stats.ts
export class TokenTracker {
  static async logUsage(userId: string, agentType: string, promptTokens: number, completionTokens: number) {
    const total = promptTokens + completionTokens;
    // 写入数据库或 Redis 进行统计
    console.log(`[Token Stats] User: ${userId} | Agent: ${agentType} | Total: ${total}`);
  }
}
```

### 2.4 灵活的 Skills 集成 (参考 H3 架构)
在 `src/skills/` 目录下构建技能仓库，智能体通过 System Prompt 获知并调用。

```typescript
// src/skills/store.ts
export interface Skill {
  name: string;
  description: string;
  execute: (args: any) => Promise<any>;
}

export class SkillManager {
  private skills: Skill[] = [];

  registerSkill(skill: Skill) {
    this.skills.push(skill);
  }

  getAvailableSkillsForAgent() {
    return this.skills.map(s => ({ name: s.name, description: s.description }));
  }

  async executeSkill(name: string, args: any) {
    const skill = this.skills.find(s => s.name === name);
    if (!skill) throw new Error(`Skill ${name} not found`);
    return await skill.execute(args);
  }
}
```

### 2.5 提示词自动学习功能
通过抓取外部飞书文档等数据源，动态补充到智能体的上下文知识库中。

```typescript
// src/agent/prompt-learner.ts
export class PromptLearner {
  async fetchNewPromptsFromWiki(wikiUrl: string) {
    // 调用外部 API 获取最新提示词模板
    const response = await fetch(wikiUrl);
    const data = await response.json();
    return this.parsePrompts(data);
  }

  updateAgentContext(agent: any, newPrompts: string[]) {
    // 将新提示词注入到智能体的系统预设中
    agent.appendSystemContext(`最新学习的提示词技巧: ${newPrompts.join(', ')}`);
  }
}
```

---

## 3. 构建与部署流程

### 3.1 环境准备
请确保系统已安装：
- Node.js >= 18 (推荐使用 `bun` 作为包管理器，以匹配项目原有的 `bun.lock`)
- Docker & Docker Compose
- Redis (用于 Token 统计和请求缓存)

### 3.2 依赖安装
进入前端与 Agent 后端目录分别安装依赖：
```bash
# 根目录执行
bun install

# 安装 web 依赖
cd web
bun install

# 安装 agent 依赖
cd ../canvas-agent
bun install
```

### 3.3 环境变量配置 (`.env.local`)
在对应目录下创建环境变量文件：
```env
# Agent 配置
CLAUDE_API_KEY=your_claude_key
HERMES_API_ENDPOINT=your_hermes_endpoint

# ComfyUI 配置
COMFYUI_ENDPOINT=http://127.0.0.1:8188

# 认证配置
OTP_SECRET_BASE=your_secret_base
```

### 3.4 本地运行调试
```bash
# 启动 Web 端
cd web
bun run dev

# 启动 Agent 端
cd ../canvas-agent
bun run dev
```

### 3.5 Docker 容器化构建
利用项目现有的 Dockerfile 与 docker-compose，全链路一键启动：

```yaml
# docker-compose.local.yml 修改补充
version: '3.8'
services:
  web:
    build: 
      context: ./web
    ports:
      - "3000:3000"
    environment:
      - COMFYUI_ENDPOINT=${COMFYUI_ENDPOINT}
  
  agent:
    build:
      context: ./canvas-agent
    ports:
      - "4000:4000"
  
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
```

执行构建指令：
```bash
docker-compose -f docker-compose.local.yml up --build -d
```
