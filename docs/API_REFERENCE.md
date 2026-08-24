# API 参考

Base：`/api`。除白名单外均需 `Authorization: Bearer <token>`。

## 认证 `/api/auth/*`（公开）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/setup` | 首次绑定：secret + otpauth + SVG 二维码 |
| POST | `/api/auth/login` | `{otp}` → `{token, expires, ttl}` |
| GET | `/api/auth/check` | 校验 token |
| POST | `/api/auth/logout` | 注销 |
| POST | `/api/auth/otp-reset` | 需 token + 当前动态码 |

## AI 模型 `/api/ai`
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/profiles` | 模型配置（key 脱敏） |
| POST | `/chat` | `{system,user,profile_id,json_mode,scenario}` |
| POST | `/probe` | 连通探测 |
| POST | `/auto-best` | 自动优选并写回配置 |
| POST | `/recommend` | 按场景推荐 |
| GET/POST | `/config` | 运行时 AI 覆盖配置 |
| GET | `/stats` | 调用统计 |

## Agent `/api/agents`
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `` | 列出 Agent |
| GET | `/{id}/health` | 健康检查 |
| POST | `/reload` | 从 DB 重载 |
| POST | `/chat` | `{message, agent_id, skill_id, canvas_id, system_prompt, learn_prompt}` → `{task_id, agent, content, usage}` |
| POST | `/chat/stream` | SSE 流式 |

## Skill `/api/skills`
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `` | 列出 Skill |
| GET | `/{id}` | 详情 |
| POST | `/reload` | 热加载 |
| POST | `/execute` | `{skill_id, args, context}` → `{ok, result, error}` |
| POST | `/risky` | 开启高风险权限 |

## Renderer `/api/renderers`
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `` | 列出 Renderer |
| GET | `/{id}/health` | 健康检查 |
| POST | `/{id}/generate` | `{workflow, canvas_id}` → `{task_id, ok, prompt_id, images}` |
| POST | `/{id}/cancel` | 取消 |

## Prompt 知识库 `/api/prompt-kb`
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/sources` | `{kind, uri}` 添加并同步 |
| POST | `/add` | `{title, content}` 手动添加 |
| GET | `/list` | 知识 + 源列表 |
| GET | `/search?q=&k=` | 相似检索 |
| POST | `/sync` | 全量重同步 |

## Token `/api/token-usage`
见 TOKEN_USAGE.md。

## 其它
- `GET /api/health`（公开）
- `WS /ws?token=`
