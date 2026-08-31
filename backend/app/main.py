from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import auth, db
from app.assets.routes import router as asset_router
from app.workflow.routes import router as workflow_router
from app.canvas.routes import router as canvas_router
from app.ai.persist import load_custom_models, load_overrides
from app.ai.routes import router as ai_router
from app.config import settings
from app.layout.routes import router as layout_router
from app.prompt_learning.routes import router as prompt_kb_router
from app.providers.routes import router as provider_router
from app.renderers import init_renderers
from app.renderers.dispatcher import start_local_worker, stop_local_worker
from app.renderers.routes import router as renderer_router
from app.scheduler import start_scheduler, stop_scheduler
from app.skills import init_skills
from app.skills.routes import router as skill_router
from app.tasks.routes import router as task_router
from app.tools import register_canvas_tools
from app.token_usage.routes import router as token_router
from app.api_v2 import router as api_v2_router
from app.mcp.call_routes import router as mcp_call_router
from app.mcp.tools.render_kernel_tools import router as render_kernel_router, websocket_router as render_kernel_ws_router
from app.scene.routes import router as scene_router

PUBLIC_EXACT = {"/api/health"}
# /uploads/ 为静态图片（<img> 标签无法携带 Bearer 头，故放行；仅本机/内网使用）
PUBLIC_PREFIXES = ("/api/auth/", "/uploads/")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.get_pool()
    await load_overrides()
    await load_custom_models()
    # 场景模型候选池 + 画布智能动作（V3.1 通用画布，app_kv 持久化）
    from app.ai.pools import load_pv_actions, load_scene_pools
    await load_scene_pools()
    await load_pv_actions()
    # 启动加载：Skill / Renderer（MCP 改造后无 Agent）
    await init_skills()
    await init_renderers()
    register_canvas_tools()
    # Render Kernel：从 PostgreSQL 加载模型能力注册表（规格书 §5）
    from app.render_kernel.registry import load_capabilities_from_db
    await load_capabilities_from_db()
    start_scheduler()
    start_local_worker()  # 异构算力：本地 ComfyUI 队列常驻消费者
    # Redis 任务队列消费者（2026-08-29：异步动作/批量/导演台入队后由它执行，backend 重启不丢任务）
    from app.services.task_queue import worker_loop
    _stop_queue = asyncio.Event()
    _queue_worker_task = asyncio.create_task(worker_loop(_stop_queue))
    yield
    _stop_queue.set()
    _queue_worker_task.cancel()
    stop_scheduler()
    await stop_local_worker()
    await db.close_pool()


app = FastAPI(title="绵绣 LumiWeave", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # Bearer 头鉴权无需 Cookie 凭证；* + credentials 属危险组合
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def auth_guard(request: Request, call_next):
    path = request.url.path
    if path in PUBLIC_EXACT or path.startswith(PUBLIC_PREFIXES):
        return await call_next(request)
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
    if auth.verify_token(token):
        return await call_next(request)
    return JSONResponse(
        status_code=401,
        content={"error": "未授权，请先登录", "code": "AUTH_REQUIRED"},
        headers={"WWW-Authenticate": "Bearer"},
    )


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/auth/setup")
async def auth_setup():
    if not auth.is_setup_open():
        return JSONResponse(status_code=403, content={"error": "已完成绑定"})
    return {
        "secret": auth.get_secret(),
        "otpauth_uri": auth.otpauth_uri(),
        "account": auth.OTP_ACCOUNT,
        "issuer": auth.OTP_ISSUER,
        "qr_svg": auth.qr_code_svg(),
    }


# ── 登录限流（防 OTP 在线爆破）：同一 IP 10 分钟内失败 5 次则锁定 10 分钟 ──
_LOGIN_FAILS: dict[str, list[float]] = {}
_LOGIN_MAX_FAILS = 5
_LOGIN_WINDOW = 600.0


def _login_rate_check(ip: str) -> bool:
    """返回 True 表示允许尝试；False 表示已锁定。"""
    now = time.time()
    fails = [t for t in _LOGIN_FAILS.get(ip, []) if now - t < _LOGIN_WINDOW]
    _LOGIN_FAILS[ip] = fails
    return len(fails) < _LOGIN_MAX_FAILS


def _login_rate_record(ip: str, ok: bool) -> None:
    if ok:
        _LOGIN_FAILS.pop(ip, None)
    else:
        _LOGIN_FAILS.setdefault(ip, []).append(time.time())


@app.post("/api/auth/login")
async def auth_login(request: Request):
    ip = request.client.host if request.client else "unknown"
    if not _login_rate_check(ip):
        return JSONResponse(status_code=429, content={"error": "尝试次数过多，请 10 分钟后再试"})
    data = await request.json()
    code = str(data.get("otp", "")).strip()
    if not auth.verify_otp(code):
        _login_rate_record(ip, False)
        return JSONResponse(status_code=401, content={"error": "动态码无效或已过期"})
    _login_rate_record(ip, True)
    auth.mark_enrolled()
    return auth.generate_token()


@app.get("/api/auth/check")
async def auth_check(request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
    return {"authed": auth.verify_token(token)}


@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
    auth.revoke_token(token)
    return {"ok": True}


@app.post("/api/auth/otp-reset")
async def auth_otp_reset(request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
    if not auth.verify_token(token):
        return JSONResponse(status_code=401, content={"error": "未授权"})
    data = await request.json()
    code = str(data.get("otp", "")).strip()
    if not auth.verify_otp(code):
        return JSONResponse(status_code=401, content={"error": "当前动态码无效"})
    result = auth.reset_otp()
    if result is None:
        return JSONResponse(status_code=403, content={"error": "固定密钥模式不可在线重置"})
    return result


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    token = websocket.query_params.get("token", "")
    if not auth.verify_token(token):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"ack:{data}")
    except WebSocketDisconnect:
        pass


app.include_router(ai_router, prefix="/api/ai")
app.include_router(token_router, prefix="/api/token-usage")
app.include_router(workflow_router, prefix="/api/workflow")
app.include_router(task_router, prefix="/api/tasks")
app.include_router(canvas_router, prefix="/api/canvas")
app.include_router(provider_router, prefix="/api/providers")
app.include_router(asset_router, prefix="/api/assets")
app.include_router(layout_router, prefix="/api/layout")
app.include_router(skill_router, prefix="/api/skills")
app.include_router(renderer_router, prefix="/api/renderers")
app.include_router(prompt_kb_router, prefix="/api/prompt-kb")
app.include_router(api_v2_router, prefix="/api/v2")
app.include_router(mcp_call_router, prefix="/api/mcp/call")
app.include_router(render_kernel_router, prefix="/api/render")
app.include_router(render_kernel_ws_router, prefix="/api/render")
app.include_router(scene_router, prefix="/api/scenes")
from app.director.routes import router as director_router
app.include_router(director_router, prefix="/api/director")

# 本地上传图片静态服务（V2.3 图片一等公民）
# V2.8：/uploads/ 改为动态路由，跟随可配置的素材保存目录（assets_dir），未命中回退默认目录
from pathlib import Path  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402

from app.config import DATA_DIR  # noqa: E402

_UPLOAD_DIR = DATA_DIR / "uploads"
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _safe_join(root: Path, fname: str) -> Path | None:
    """把用户输入的相对文件名拼到 root 下，拒绝任何跑出 root 的路径（防 ../ 穿越）。"""
    try:
        root_r = root.resolve()
        p = (root_r / fname).resolve()
    except Exception:
        return None
    if p != root_r and root_r not in p.parents:
        return None
    return p


@app.get("/uploads/{fname:path}")
async def _uploads_file(fname: str):
    from app.assets.routes import _assets_dir
    d = await _assets_dir()
    p = _safe_join(d, fname)
    if p is None or not p.is_file():
        p = _safe_join(_UPLOAD_DIR, fname)  # 回退默认目录（历史文件）
    if p is None or not p.is_file():
        return JSONResponse(status_code=404, content={"error": "文件不存在"})
    return FileResponse(p)
