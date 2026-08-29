# 04 API 测试报告 — 绵绣 LumiWeave

> Phase 5：接口/API 验收（全部实测）

## 一、接口识别

- REST API：FastAPI，统一 `/api` 前缀 + `/api/v2` 服务门面端点 + `/api/scenes` 场景 REST + `/api/director` + `/api/v2/mcp/call`
- MCP：streamable-http（:8901/mcp，JSON-RPC 2.0，Bearer token）+ stdio 模式
- WebSocket：/ws（工作流执行事件，手动验 token）、/api/render/ws/render（渲染事件，**未验 token**，见安全报告 S6）

## 二、接口规范实测

| 端点 | 方法 | 无 token | 假 token | 正常 token | 响应时间 |
|---|---|---|---|---|---|
| /api/health | GET | 200（白名单） | — | — | 3.7ms |
| /api/auth/login | POST | 错误 OTP → 401 + 中文错误 | — | 200 + token | <1s |
| /api/scenes | GET | **401** ✅ | **401** ✅ | 200 | 6ms |
| /api/tasks | GET | 401 ✅ | — | 200 | 8ms |
| /api/providers | GET | 401 ✅ | — | 200（key 已脱敏） | 7ms |
| /api/workflow/nodes | GET | — | — | 200（节点 schema 注册表） | 6ms |
| /api/scenes/types | GET | — | — | 200（未被 /{scene_id} 吞掉，路由顺序正确） | 5ms |
| /api/token-usage/project-usage | GET | — | — | 200 | 15-23ms |
| :8901/mcp tools/list | POST | **401** ✅ | — | 200（40+ 工具） | <1s |

## 三、错误处理实测

| 场景 | 表现 | 评价 |
|---|---|---|
| 错误 OTP | 401 + `{"error":"动态码无效或已过期"}` | ✅ 不泄露密钥信息 |
| 工作流保存缺 graph | `{"error":"graph 必须是对象"}` | ✅ 参数校验明确 |
| LLM 超时 | `{"error":"模型响应过慢，请稍后重试"}`（统一 TIMEOUT 错误码） | ✅ 优雅降级 |
| MCP 参数缺失 | JSON-RPC isError + pydantic 校验详情 | ✅ 但不替权限拦截（见 S3） |
| 不存在的 workflow | 404 | ✅ |

## 四、安全实测（摘要，详见 06 安全报告）

- ❌ **P0**：`/uploads/../otp_secret` 免授权 200，TOTP 种子/会话密钥/容器 /etc/passwd 均可读
- ❌ **P1**：MCP 只读 token 可直达工具执行层（权限未强制）
- ❌ **P1**：登录接口无限流（6 位 OTP 可爆破）
- ✅ SQL 全部参数化、api_key 脱敏返回、上传扩展名白名单+UUID 改名

## 五、性能实测

| 指标 | 结果 |
|---|---|
| 常规端点 P50 | 4-8ms |
| 聚合端点（90 天 token 汇总） | 23ms |
| 20 并发 GET /api/scenes | 全部 200，无错误 |
| 场景对象批量写（历史实测） | 1000 对象 0.98s（1022/s） |

## 六、结论

API 层**规范度好**：统一鉴权中间件、统一错误格式、参数校验明确、响应快。两处硬伤（/uploads 穿越、MCP 权限空转）属安全维度。**API 单项得分：78/100**（扣分全在安全项）。
