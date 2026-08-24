# Token 用量与计费（04 guide）

## 数据模型
- `token_usage_log(id, ts, model, provider, scenario, prompt_tokens, completion_tokens, success, latency_ms)`
- `model_pricing(id, model, provider, input_per_million, output_per_million, source, active, note, updated_at)`，`UNIQUE(model, provider)`

## 计量链路
- `ai/client.py` 每次成功调用异步 `log_usage(...)`（fire-and-forget）；失败也落 0 token 记录。
- Agent（`chat_full`）、Skill（`scenario="skill"`）复用同一计量路径，token 自动累计。
- `pricing.sync_pricing` 弹性同步官方价：`source` = official/pending/manual，仅非 manual 可被反向停用。

## 接口
- `GET /api/token-usage/summary?days=` / `/by-scenario?days=` / `/today`
- `GET /api/token-usage/pricing` / `POST /api/token-usage/pricing/sync`
- `POST /api/token-usage/pricing`（手动录入）/ `POST /api/token-usage/pricing/refresh-official`
- `DELETE /api/token-usage/pricing/{id}`（官方价禁删）

## 日报
`scheduler.py` 集成飞书 06:00 日报，通过 `app_kv` 记录已推送日期保证幂等。

## 验收（spec #74）
```
Agent 请求记录 ✅   Skill 请求记录 ✅   输入/输出/总 Token ✅   成本 ✅   按日统计 ✅
```
