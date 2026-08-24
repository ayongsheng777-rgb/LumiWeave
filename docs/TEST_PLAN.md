# 测试计划

测试目录建议：`tests/{auth,agents,skills,prompt,comfyui,tasks,usage,e2e}`（spec #73）。

## 必测用例矩阵（spec #74）

### Auth
- [x] 正确 OTP 登录成功（本会话实测）
- [ ] 错误 OTP 拒绝
- [ ] 重复失败限速
- [x] 退出后 session 失效（revoke_token 逻辑）

### Agent
- [x] 4 个 Agent 注册（default/claude/hermes/workbuddy）
- [x] 请求创建 taskId、事件时间线
- [ ] Claude 请求成功（需 Anthropic key）
- [ ] Hermes 请求成功（需 key）
- [ ] Workbuddy 请求成功（需 key）
- [ ] Provider 失败（无 key 时优雅降级，已验证返回空 content 不崩溃）
- [ ] 自动 fallback
- [ ] Streaming（`/chat/stream` SSE）

### Skill
- [x] 自动发现（h3-prompt-writing）
- [x] 加载 / 热加载（reload count=1）
- [x] 权限声明（permissions 数组）
- [ ] 执行（prompt 运行时需 LLM key）
- [x] Agent 调用 Skill（事件 skill_executed）
- [x] 权限拒绝（高风险默认关）

### ComfyUI
- [x] 注册（comfy-local）
- [ ] Local / Cloud / Queue / Progress / Result / Cancel / Retry（需真实 ComfyUI 实例）

### Prompt Learning
- [x] 添加知识（kb_add）
- [x] 检索（kb_search）
- [x] 动态注入（prompt_learned 事件）

### Token
- [x] Agent/Skill 计量埋点（复用 ai.client）
- [x] 输入/输出 token / 按日统计（token_usage 既有）
- [x] 成本（model_pricing + summary）

## 执行方式
```bash
# 后端全链路验证脚本（真实 TOTP 登录 + 端点回归）
OTP_SECRET=$(docker compose exec -T backend cat /app/data/otp_secret | tr -d '\r\n ') \
  python tmp/verify_lumiweave_phases.py
```
