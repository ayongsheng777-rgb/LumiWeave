# ComfyUI 架构（Phase 5）

## 定位
ComfyUI 作为独立 **Renderer Provider**（spec #18），通过统一接口接入，不写死进业务代码。

## RendererRegistry（spec #18）
`app/renderers/registry.py` — `RendererConfig(id/name/type/endpoint/api_key/client_id/enabled/timeout)` + `BaseRenderer` 基类。类型：`comfyui | image-api | video-api`。默认播种一行 `comfy-local`（禁用，配 endpoint 后启用）。

## ComfyUIConnector（spec #19/#69）
`app/renderers/comfyui.py` — 真实 HTTP 客户端：

| 能力 | 端点 | 说明 |
|---|---|---|
| queue_prompt | `POST /prompt` | 提交工作流，返回 prompt_id，带重试（rule #15） |
| get_history | `GET /history/{id}` | 取结果 |
| wait_for_result | 轮询 history | timeout 兜底（rule #13），WS 不可用降级轮询 |
| cancel | `POST /interrupt` | best-effort 取消 |
| health_check | `GET /system_stats` | 不可达返回 False（无 mock） |

## 接口
- `GET /api/renderers` — 列出 Renderer
- `GET /api/renderers/{id}/health`
- `POST /api/renderers/{id}/generate` — `{workflow, canvas_id}`，创建 task → 入队 → 等待 → 写 result（图片回 Canvas）
- `POST /api/renderers/{id}/cancel`

## 验收路径（spec #69）
```
Canvas → Image Prompt → ComfyUI → 生成图片 → 图片回到 Canvas
```
结果以 `task_results.data.images` 回写，`task_events` 记录 `render_queued/render_done/render_failed`。

## 验证证据
- `/api/renderers` 返回 `comfy-local`（disabled）。
- 未启用/未配置时 `generate` 返回 400/503，不崩溃（真实错误处理）。
