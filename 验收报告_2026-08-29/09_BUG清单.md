# 09 BUG 清单 — 绵绣 LumiWeave（2026-08-29 验收）

> 共 22 项：P0×2 / P1×7 / P2×7 / P3×6。每项含：描述 / 影响 / 复现 / 修复建议。
> **【2026-08-29 修复复核】B01-B07、B09、B13-B18、B20 已全部修复并实测验证（16 项验收全绿 + pytest 8/8）；B08（actions.py 拆分）列入下批重构；B10-B12、B19-B22 部分处理（见 10 号报告复核节）。**
> **【更正】原 B03（主对话不可用）系验收脚本字段名误用（发了 message/history，正确字段为 user），复测 2.0s 正常返回，降级为"空消息缺校验"并已修（400 拦截）。**

## P0（严重，阻断上线）

| # | 问题 | 影响 | 复现 | 修复建议 |
|---|---|---|---|---|
| B01 | /uploads 路径穿越任意文件读取（免鉴权） | 读 TOTP 种子→自算动态码→接管全系统；可读容器任意文件 | `curl --path-as-is http://localhost:8900/uploads/../otp_secret`（实测 200，返回 32 字节种子） | resolve() 后校验 is_relative_to，拒绝 .. |
| B02 | python-multipart 0.0.9 命中 3 个 DoS CVE | 上传链路可被 DoS | requirements.txt:3；CVE-2024-53981 等 | 升级 ≥0.0.27 |

## P1（重大）

| # | 问题 | 影响 | 复现 | 修复建议 |
|---|---|---|---|---|
| B03 | 主对话 /api/ai/chat 活跃模型配置失效，60s 超时 | 主聊天入口不可用（场景动作正常） | POST /api/ai/chat 任意消息 | active profile 解析加校验+快速失败+配置指引 |
| B04 | MCP 权限模型未强制（has_permission 零调用） | 只读 token 可执行写/付费工具 | read token 调 canvas.create 直达执行层（实测） | 工具分发层统一鉴权，不足 403 |
| B05 | OTP 登录无限流 | 6 位动态码可在线爆破 | 代码确认无 rate-limit | IP 限流+失败退避+审计 |
| B06 | PG 弱口令 + Redis 无密码，端口绑 0.0.0.0 | 局域网直连库/缓存 | compose:8,14,27 | 绑 127.0.0.1、Redis requirepass、删默认口令 |
| B07 | /api/assets/dir 可设任意目录，联动 B01 放大 | 认证后读宿主机任意目录 | POST /api/assets/dir 指向 C:\ | 限制 DATA_DIR 子树 |
| B08 | scene/actions.py 2144 行单文件 | 维护高风险，改动易冲突 | 代码统计 | 按动作域拆分模块 |
| B09 | 测试体系失效：test_core.py import 已删模块、无 pytest 依赖 | 回归零保障 | pytest 跑即 ImportError | 修 import、补 pytest、纳入镜像构建校验 |

## P2（一般）

| # | 问题 | 影响 | 修复建议 |
|---|---|---|---|
| B10 | Redis 死依赖（代码零调用） | 白占容器与运维心智 | 移除或真正用于缓存/队列 |
| B11 | task_events / task_results 长期 0 行 | 事件溯源名存实亡 | 接通写入或裁剪设计 |
| B12 | AI Key 明文落库（app_kv.ai_models） | 库泄露=key 全泄 | 加密存储或仅引用环境变量 |
| B13 | 渲染 WebSocket 无鉴权 | 可订阅任意 job 事件 | WS 入口验 token |
| B14 | 认证后 SSRF（任意 URL + follow_redirects） | 内网探测/云元数据 | 私网地址过滤+禁重定向 |
| B15 | .env 残留真实 MiniMax Key | 明文落盘 | 轮换密钥 |
| B16 | 前端 2MB bundle 无 gzip | 首屏慢 | nginx gzip + vite 分包 |

## P3（优化建议）

| # | 问题 | 修复建议 |
|---|---|---|
| B17 | CORS `*` + credentials 矛盾 | 收敛明确源列表 |
| B18 | 请求字段 type / 响应 object_type 不一致 | 兼容双字段或文档明示 |
| B19 | 遗留表 cleanup_bak_20260827 ×2、dist_new/、tmp/verify_*、fix_siliconflow_models.py | 定期清理 |
| B20 | README 目录结构残留 agent/ 描述 | 文档同步 |
| B21 | 前端三 store 双份节点定义易漂移 | 抽单一事实源 |
| B22 | ~10 处 except:pass 静默吞异常、全后端仅 4 文件有 logging | 补日志，失败可追溯 |
