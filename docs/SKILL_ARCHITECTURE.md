# Skill 架构（Phase 3）

## 核心原则（spec #9）
Skill 是**平台能力**，不绑定单个 Agent。任一 Agent 通过 Tool Calling（`skill.execute`）即可调用平台已装 Skill。

## 组件

### SkillManifest（spec #12）
`app/skills/manifest.py` — `id/name/version/description/runtime(prompt|tool|workflow)/entry/permissions/tags/source`。

### SkillLoader（自动发现，spec #16）
`app/skills/loader.py` — 扫描 `skills/{builtin,external,learned}/`，读取 `manifest.json` + `entry`（默认 `SKILL.md`）。目录位置通过 `SKILLS_DIR` 环境变量或 app 目录同级 `skills/` 推断。

### SkillManager（spec #13）+ SkillRuntime（spec #12）
`app/skills/manager.py` / `runtime.py` — `execute(skill_id, args, context) -> SkillResult`：
- `runtime=prompt`：以 SKILL 内容为 system、args 为 user 调 LLM
- `runtime=tool`：调用注册的 callable
- `runtime=workflow`：首版复用 prompt 编排

### SkillPermission（spec #15）
`app/skills/permissions.py` — 高风险权限（`shell.execute`/`file.delete`/`network.request`/`database.write`/`comfyui.execute`）**默认关闭**，需显式开启。

### 热加载（spec #17）
`POST /api/skills/reload` — 扫描 → 校验 manifest → 同步 DB → 重载内存，无需重启 Web。

## 目录结构
```
skills/builtin/h3-prompt-writing/
├── SKILL.md
└── manifest.json
```
Phase 4 逐步导入 H3 视频 Skill（minimalist-product-ad-generator 等），用 Adapter 加载、不改原内容。

## 接口
- `GET /api/skills` / `GET /api/skills/{id}`
- `POST /api/skills/reload`
- `POST /api/skills/execute` — `{skill_id, args, context}`
- `POST /api/skills/risky` — 开启高风险权限

## 验证证据
- `/api/skills/reload` 返回 `count: 1`（h3-prompt-writing 自动发现）。
- `permissions/tags` 以真实数组返回：`[]` / `["prompt","video","h3"]`。
- Agent 带 `skill_id` 调用时事件链出现 `skill_executed`。
