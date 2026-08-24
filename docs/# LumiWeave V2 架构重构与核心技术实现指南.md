# LumiWeave V2 架构重构与核心技术实现指南

## 一、 架构新定位：个人 AI 创客工作台

LumiWeave V2 将舍弃高维护成本的 SaaS 多租户架构与重量级任务调度（如 Celery + RabbitMQ），转而采用**“前端 DAG 画布控制 + 后端轻量级异步路由 + 异构算力分发”**的架构。

核心目标是满足个人高效生产：**算力白嫖与弹性利用**。通过算力路由，将基础生图下发至本地 GTX 1080 Ti 节点，将高显存消耗的 Flux GGUF、Wan2.2 等渲染任务自动抛给云端 AutoDL 或其他云端大显存实例。

---

## 二、 系统架构流转图

```text
[用户交互区]                   [核心控制区 (FastAPI)]              [算力执行区]
React Flow 画布  ======> 1. DAG JSON 解析与拓扑排序 ======> LLM API (DeepSeek/Claude)
      |                       | (提取 Prompt/选择 Tool)          (消耗 Token 并计费)
      |                       v
  Zustand 状态        2. Token 成本统计 (SQLite)
      ^                       |
      |                       v
  WebSocket 实时 <====== 3. 异构渲染路由调度器 =======+=====> 本地 ComfyUI (1080Ti)
  状态与图像回显               (asyncio.Queue)        |
                                                      +=====> 云端 ComfyUI (RTX 5090)

```

---

## 三、 核心重构与代码实现

### 1. 核心协议：统一的 DAG JSON 规范

这是前后端通信的唯一契约。无论前端连线多复杂，最终必须组装成该格式提交给后端。

**位置：** `backend/app/schemas/workflow.py`

```python
from pydantic import BaseModel, Field
from typing import List, Dict, Any

class Node(BaseModel):
    id: str
    type: str  # e.g., "LLM_Prompt_Gen", "ComfyUI_KSampler"
    params: Dict[str, Any] = Field(default_factory=dict)
    
class Edge(BaseModel):
    source: str
    target: str
    source_handle: str = None
    target_handle: str = None

class WorkflowDAG(BaseModel):
    workflow_id: str
    nodes: List[Node]
    edges: List[Edge]

```

### 2. 异构算力路由与轻量级队列

不再使用 Celery。对于单用户的个人生产环境，利用 FastAPI 生命周期内的 `asyncio.Queue` 配合后台常驻任务（Background Worker）即可完美解决本地算力排队问题。

**位置：** `backend/app/renderers/dispatcher.py`

```python
import asyncio
import httpx
from fastapi import APIRouter
from app.schemas.workflow import WorkflowDAG

# 针对本地单卡建立的小型缓冲队列，防止本地爆显存
local_task_queue = asyncio.Queue(maxsize=10)

LOCAL_COMFY_URL = "[http://127.0.0.1:8188](http://127.0.0.1:8188)"
CLOUD_COMFY_URL = "http://your-autodl-instance:8188"

async def execute_comfyui_task(prompt_json: dict, url: str):
    """通用的 ComfyUI API 触发器"""
    async with httpx.AsyncClient(timeout=300.0) as client:
        response = await client.post(f"{url}/prompt", json={"prompt": prompt_json})
        return response.json()

async def local_worker():
    """本地节点常驻消费者"""
    while True:
        task_data = await local_task_queue.get()
        try:
            print(f"Executing local task: {task_data['task_id']}")
            await execute_comfyui_task(task_data['prompt_json'], LOCAL_COMFY_URL)
        except Exception as e:
            print(f"Local execution failed: {e}")
        finally:
            local_task_queue.task_done()

# 在 FastAPI 启动时挂载 local_worker
# @app.on_event("startup")
# async def startup_event():
#     asyncio.create_task(local_worker())

async def dispatch_render_task(task_id: str, comfy_prompt: dict):
    """
    智能算力路由：根据节点参数动态决定去云端还是留本地
    """
    workflow_str = str(comfy_prompt).lower()
    
    # 策略：如果包含大显存模型需求，则直接走云端，不排队
    needs_cloud = any(keyword in workflow_str for keyword in ["flux", "wan2.2", "sora", "video"])
    
    if needs_cloud:
        print(f"Task {task_id} routed to CLOUD.")
        # 云端性能强，直接发起异步请求，无需经过本地单线队列
        asyncio.create_task(execute_comfyui_task(comfy_prompt, CLOUD_COMFY_URL))
    else:
        print(f"Task {task_id} routed to LOCAL queue.")
        # 本地任务扔进队列慢慢排
        await local_task_queue.put({"task_id": task_id, "prompt_json": comfy_prompt})

```

### 3. 本地化 Token 消耗与成本追踪

用于统计个人调用外部 API (如 DeepSeek, Claude) 的额度消耗，采用极简的 SQLite 存储，摒弃复杂的计费系统。

**位置：** `backend/app/token_usage/tracker.py`

```python
from sqlalchemy import create_engine, Column, Integer, String, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

Base = declarative_base()
engine = create_engine("sqlite:///./lumiweave_local.db", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class TokenUsage(Base):
    __tablename__ = "token_usage"
    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String, index=True)      # e.g., "deepseek", "claude"
    model = Column(String)                     # e.g., "deepseek-coder", "claude-3-5-sonnet"
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

Base.metadata.create_all(bind=engine)

def record_llm_usage(provider: str, model: str, prompt_tk: int, comp_tk: int):
    """在 LLM 客户端调用完成后同步/异步调用此函数"""
    db = SessionLocal()
    try:
        usage = TokenUsage(
            provider=provider,
            model=model,
            prompt_tokens=prompt_tk,
            completion_tokens=comp_tk
        )
        db.add(usage)
        db.commit()
    finally:
        db.close()

```

### 4. LLM API 的统一拦截与请求 (Provider)

封装一个统一的网关，确保每一次调用都能被 `tracker.py` 准确记录。

**位置：** `backend/app/ai/provider_gateway.py`

```python
import httpx
from app.token_usage.tracker import record_llm_usage

async def unified_llm_call(provider: str, model: str, messages: list, api_key: str):
    """
    统一的 LLM 调用出口，自动拦截并记录 Token
    """
    if provider == "deepseek":
        url = "[https://api.deepseek.com/v1/chat/completions](https://api.deepseek.com/v1/chat/completions)"
        headers = {"Authorization": f"Bearer {api_key}"}
        payload = {"model": model, "messages": messages}
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, headers=headers, json=payload)
            data = resp.json()
            
            # 提取 Token 消耗并记录
            usage = data.get("usage", {})
            record_llm_usage(
                provider="deepseek",
                model=model,
                prompt_tk=usage.get("prompt_tokens", 0),
                comp_tk=usage.get("completion_tokens", 0)
            )
            return data["choices"][0]["message"]["content"]
            
    # 其他 Provider (Claude, OpenAI) 分支...
    raise ValueError(f"Unsupported provider: {provider}")

```

---

## 四、 前端 Canvas 重构指南 (Phase 2 重点)

前端必须废弃单纯的“拖拽 UI”，转为基于 `React Flow` 的严格数据驱动模式。

1. **安装核心库：**
```bash
npm install reactflow zustand

```


2. **状态管理 (Zustand)：**
创建一个专门管理节点的 Store，确保画布上的每一步操作都会实时更新 JSON 数据结构。
**位置：** `frontend/src/store/workflowStore.ts`
```typescript
import { create } from 'zustand';
import { Node, Edge, Connection, addEdge, applyNodeChanges, applyEdgeChanges } from 'reactflow';

interface WorkflowState {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: any) => void;
  onEdgesChange: (changes: any) => void;
  onConnect: (connection: Connection) => void;
  getWorkflowJSON: () => any;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (connection) => set({ edges: addEdge(connection, get().edges) }),
  getWorkflowJSON: () => ({
      nodes: get().nodes,
      edges: get().edges
  })
}));

```


3. **提交与回显 (WebSocket)：**
前端通过点击“运行”按钮，调用 `getWorkflowJSON()` 生成数据结构发往后端。由于渲染时间不可控，前端必须通过 WebSocket 或长轮询（Long-polling）监听后端发送回来的任务状态（排队中/渲染中/已完成）和资产预览图。

---

## 五、 V2 演进路线总结

1. **废弃现有冗余代码：** 删除现有基于复杂权限、用户表的逻辑。清理掉过度封装但不落地的 UI 组件。
2. **打通数据血脉：** 实现从 `React Flow` 生成 JSON -> `FastAPI` 解析 JSON -> 分发至 `ComfyUI` 的极简闭环。
3. **完善路由与记录：** 在闭环中插入 `ComfyUI` 算力路由（本地 1080Ti vs 云端实例）和 `LLM Token` 拦截器。
4. **Agent 接入：** 待骨架稳定后，让你的 Agent 作为一种特殊的 Node 类型存在于画布中，实现真正的自动化编排。

```

```