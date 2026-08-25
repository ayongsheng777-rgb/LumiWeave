from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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

PUBLIC_EXACT = {"/api/health"}
PUBLIC_PREFIXES = ("/api/auth/",)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.get_pool()
    await load_overrides()
    await load_custom_models()
    # 启动加载：Skill / Renderer（MCP 改造后无 Agent）
    await init_skills()
    await init_renderers()
    register_canvas_tools()
    start_scheduler()
    start_local_worker()  # 异构算力：本地 ComfyUI 队列常驻消费者
    yield
    stop_scheduler()
    await stop_local_worker()
    await db.close_pool()


app = FastAPI(title="绵绣 LumiWeave", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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


@app.post("/api/auth/login")
async def auth_login(request: Request):
    data = await request.json()
    code = str(data.get("otp", "")).strip()
    if not auth.verify_otp(code):
        return JSONResponse(status_code=401, content={"error": "动态码无效或已过期"})
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
