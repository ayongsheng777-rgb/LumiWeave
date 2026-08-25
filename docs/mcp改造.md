我会按这个方向重新定义 LumiWeave V2：

**核心变更：删除 Agent 中心架构，改为“外部编程智能体驱动 + MCP/API 控制平台”。**

也就是说：

原方案：

```
LumiWeave
 ├── Agent
 │    ├── Planner
 │    ├── Executor
 │    └── Tool
 ├── Skill
 ├── Provider
 └── Canvas
```

调整为：

```
外部 Coding Agent

 ├── OpenAI Codex
 ├── Claude Code
 ├── WorkBuddy
 ├── Cursor
 ├── Continue
 └── 其他 MCP Client

              |
              |
          MCP Protocol
              |
              ↓

        LumiWeave MCP Server

              |
              |
       LumiWeave API Layer

              |
 ┌────────────┼────────────┐
 ↓            ↓            ↓

Canvas     Workflow     Asset

 ↓            ↓            ↓

Provider   Layout      Export
```

---

# LumiWeave V2 新定位

从：

> AI Agent 创作系统

改成：

> AI Agent 可编程创作基础设施

LumiWeave 本身不再负责“思考”。

负责：

* 提供 Canvas
* 提供 Workflow Engine
* 提供 MCP Tool
* 提供 API
* 提供状态管理
* 提供执行环境

---

# 一、删除 Agent 模块改造

## 删除

目录：

```
backend/agents/
```

废弃：

```
AgentRouter
AgentExecutor
Planner
Memory Agent
Conversation Agent
```

---

## 替换为

新增：

```
backend/mcp/

backend/api/

backend/workflow/

backend/canvas/
```

---

# 二、新架构

## 新核心组件

```
LumiWeave Core


1. Canvas Engine

2. Workflow Engine

3. MCP Server

4. API Gateway

5. Provider Hub

6. Asset System

7. Layout Engine

8. Task Runtime
```

---

# 三、MCP Server设计

新增：

```
backend/mcp/server.py
```

提供 MCP Tools：

---

## Canvas控制

### create_object

```json
{
"type":"image",
"content":"新能源汽车",
"x":100,
"y":200
}
```

---

### update_object

```json
{
"id":"obj001",
"property":{
"text":"新版标题"
}
}
```

---

### delete_object

---

### move_object

---

### export_canvas

---

# Workflow MCP

## create_workflow

```json
{
"name":"海报生成流程"
}
```

---

## execute_workflow

```json
{
"id":"workflow001"
}
```

---

## inspect_task

返回：

```json
{
"status":"running",
"progress":70
}
```

---

# 四、支持 Codex / Claude Code / WorkBuddy

增加：

```
.mcp/

 ├── codex.json

 ├── claude.json

 └── workbuddy.json
```

示例：

```json
{
"mcpServers":{
 "lumiweave":{
   "command":"python",
   "args":[
     "-m",
     "lumiweave.mcp"
   ]
 }
}
}
```

---

## Codex能力

可以：

```
创建Canvas对象

修改设计

执行Workflow

读取项目状态

生成资产

导出作品
```

---

## Claude Code能力

可以：

```
分析项目

调用Canvas

生成UI

修改Workflow
```

---

## WorkBuddy能力

可以：

```
企业工作流自动化

批量生成

项目管理
```

---

# 五、API层重构

新增：

```
/api/v2/
```

---

## Canvas API

```
GET
/api/v2/canvas/{id}


POST
/api/v2/object


PUT
/api/v2/object/{id}


DELETE
/api/v2/object/{id}
```

---

## Workflow API

```
POST
/api/v2/workflow


POST
/api/v2/workflow/{id}/run


GET
/api/v2/task/{id}
```

---

## Provider API

```
GET
/providers


POST
/provider/test


POST
/provider/route
```

---

# 六、数据库调整

删除：

```
agents
agent_messages
agent_memory
```

---

新增：

## canvas_objects

```sql
id

project_id

type

content

position

metadata
```

---

## workflows

```sql
id

project_id

schema

version
```

---

## workflow_runs

```sql
id

workflow_id

status

logs

result
```

---

## mcp_clients

```sql
id

name

type

token

permissions
```

用于：

记录：

* Codex
* Claude
* WorkBuddy

---

# 七、React改造

删除：

```
AgentPanel.tsx
AgentChat.tsx
```

---

替换：

```
src/


canvas/

 ├── CanvasCore.tsx
 ├── ObjectRenderer.tsx
 └── LayerPanel.tsx


workflow/

 ├── WorkflowEditor.tsx
 └── WorkflowRunner.tsx


mcp/

 ├── MCPStatus.tsx
 └── ToolPanel.tsx


api/

 └── client.ts
```

---

# 八、原方案符合度重新检测

按照之前《LumiWeave V2 起死回生规格书》：

| 模块               | 原方案   | 新方案                      | 状态   |
| ---------------- | ----- | ------------------------ | ---- |
| Canvas Core      | 需要    | 保留                       | ✅    |
| Canvas Object    | 需要    | 保留                       | ✅    |
| AI Canvas Tool   | 需要    | 改为 MCP Tool              | ✅升级  |
| Chat Integration | 需要    | 删除内部Chat依赖               | ⚠️调整 |
| Task ID          | 需要    | 保留                       | ✅    |
| Provider Router  | 需要    | 保留                       | ✅    |
| Skill Runtime    | 需要    | 改为 Workflow Node Runtime | ✅    |
| Layout Engine    | 需要    | 保留                       | ✅    |
| Asset System     | 需要    | 保留                       | ✅    |
| Agent系统          | 原方案需要 | 删除                       | ❌    |
| 外部AI编程体支持        | 未定义   | 新增                       | ✅    |

---

# 九、最终架构完整度评分

## 原 V2：

约：

```
75%
```

问题：

* AI闭环依赖内部Agent
* 扩展性有限
* 无法接入未来编程智能体生态

---

## MCP/API V2：

预计：

```
92%
```

提升：

* 外部智能体生态

* Codex支持

* Claude Code支持

* WorkBuddy支持

* 企业自动化能力

* 多客户端控制

---

# 十、GitHub改造执行顺序

新的 Issue 顺序：

```
Issue 001
删除 Agent Runtime


Issue 002
新增 MCP Server


Issue 003
Canvas API


Issue 004
Workflow API


Issue 005
MCP Client Registry


Issue 006
数据库迁移


Issue 007
React Canvas重构


Issue 008
Provider Hub


Issue 009
Layout Engine


Issue 010
Codex/Claude/WorkBuddy测试
```

---



# 1. MCP Server 总体设计

## 1.1 定位

LumiWeave MCP Server 是：

> AI 编程体访问 LumiWeave 创作能力的标准协议入口。

不负责：

* 推理
* 规划
* 对话
* Agent决策

负责：

* 工具暴露
* 权限控制
* API转发
* 状态查询
* 工作流执行
* Canvas操作

架构：

```
                AI Coding Agent

       ┌─────────┬─────────┬─────────┐
       │         │         │         │
     Codex   Claude    WorkBuddy  Cursor


                MCP Protocol


                    ↓


            LumiWeave MCP Server


        ┌───────────┼───────────┐

        ↓           ↓           ↓

     Canvas     Workflow     Asset


        ↓           ↓           ↓


              LumiWeave API Core


        ↓           ↓           ↓

    Provider    Layout     Export
```

---

# 2. MCP Server目录设计

```
backend/

mcp/

├── server.py

├── registry.py

├── tools/

│
├── canvas_tools.py

├── workflow_tools.py

├── asset_tools.py

├── provider_tools.py

├── project_tools.py


├── auth/

│
├── permission.py

├── token.py


└── schemas/

    ├── canvas.py

    ├── workflow.py

    └── task.py

```

---

# 3. MCP Server核心模块

## server.py

职责：

* 初始化MCP
* 注册Tools
* 管理Session

伪代码：

```python
from mcp.server import Server

server = Server(
    name="lumiweave"
)


register_canvas_tools(server)

register_workflow_tools(server)

register_asset_tools(server)

register_provider_tools(server)


server.run()
```

---

# 4. Tool Registry设计

所有工具统一注册。

## registry.py

```python
class ToolRegistry:


    tools={}


    def register(
        name,
        handler
    ):
        tools[name]=handler


    def execute(
        name,
        params
    ):
        return tools[name](params)
```

---

# 5. Canvas MCP Tool设计

## 5.1 canvas.list

用途：

AI查看当前画布。

请求：

```json
{
"project_id":
"project001"
}
```

返回：

```json
{
"objects":[

{
"id":"obj01",
"type":"image",
"x":100,
"y":200
}

]
}
```

---

# 5.2 canvas.create

创建对象。

参数：

```json
{
"type":"text",

"content":

"新能源汽车未来设计",

"position":
{
"x":100,
"y":100
}

}
```

返回：

```json
{
"id":"obj123",
"status":"created"
}
```

---

# 5.3 canvas.update

修改对象。

例如：

Codex：

> 把标题改成科技感字体

调用：

```json
{
"id":"obj001",

"changes":

{
"font":"future-tech",
"size":80
}

}
```

---

# 5.4 canvas.generate

AI生成资源。

请求：

```json
{
"type":"image",

"prompt":

"未来新能源汽车广告图",

"provider":

"auto"
}
```

执行：

```
Task

↓

Provider Router

↓

Image Provider

↓

Asset

↓

Canvas Object

```

---

# 5.5 canvas.export

支持：

```
PNG

JPG

PDF

SVG

JSON

PPTX

```

---

# 6. Workflow MCP设计

Workflow成为：

> 可执行设计流程图。

---

## workflow.create

输入：

```json
{
"name":

"新能源汽车宣传流程",

"nodes":[

{
"type":"image.generate"
},

{
"type":"layout.poster"
}

]

}
```

---

## workflow.execute

执行：

```json
{
"workflow_id":

"wf001"
}
```

返回：

```json
{
"task_id":

"task001",

"status":

"running"
}
```

---

# 7. Workflow Runtime设计

目录：

```
workflow/

engine.py

executor.py

nodes.py

scheduler.py

```

---

执行模型：

```
Workflow


    Node1

      ↓

    Node2

      ↓

    Node3


```

---

Node类型：

## AI节点

```
image.generate

text.generate

video.generate
```

---

## 操作节点

```
canvas.create

canvas.update

layout.apply
```

---

## 输出节点

```
export.pdf

export.image

publish
```

---

# 8. Asset MCP设计

Asset是所有生成结果中心。

---

## asset.list

返回：

```json
{

"assets":[

{
"id":"asset001",

"type":"image",

"url":"..."

}

]

}
```

---

## asset.attach

绑定Canvas：

```
Asset

↓

Canvas Object

```

---

# 9. Provider MCP设计

Provider 不再被Agent调用。

由外部AI通过MCP调用。

---

## provider.list

返回：

```
OpenAI

Claude

Gemini

ComfyUI

Kling

Runway

```

---

## provider.health

检测：

* API状态
* 延迟
* 余额
* 限制

---

## provider.route

输入：

```json
{

"task":

"image_generation",

"quality":

"high",

"cost":

"low"

}

```

返回：

```json
{

"provider":

"OpenAI",

"model":

"image-model"

}

```

---

# 10. MCP权限系统

## 权限模型

```
Client

 ↓

Permission

 ↓

Tool

 ↓

Resource

```

---

权限类型：

## READ

```
canvas.read

asset.read

workflow.read
```

---

## WRITE

```
canvas.write

workflow.create

asset.delete
```

---

## EXECUTE

```
workflow.execute

provider.execute
```

---

# 11. MCP Client注册

数据库：

mcp_clients

字段：

```sql
id

name

type

token

permissions

created_at

```

示例：

```
client:

Codex


permissions:

[
canvas.read,

canvas.write,

workflow.execute
]

```

---

# 12. API Gateway设计

MCP不是直接操作数据库。

结构：

```
MCP Tool

↓

Service Layer

↓

API Layer

↓

Database

```

---

目录：

```
backend/services/


canvas_service.py

workflow_service.py

asset_service.py

provider_service.py

```

---

# 13. 服务层示例

canvas_service.py

```python
class CanvasService:


    def create_object(
        self,
        data
    ):

        object = CanvasObject(
            **data
        )


        db.save(object)


        return object

```

---

# 14. 外部AI工作流程示例

## 场景：

用户：

> 创建一个新能源汽车品牌宣传页

---

Codex：

调用：

```
canvas.list

↓

workflow.create

↓

workflow.execute

↓

task.status

↓

asset.list

↓

canvas.export

```

---

系统：

```
创建任务

↓

生成图片

↓

生成文字

↓

自动布局

↓

生成页面

↓

导出PDF

```

---

# 15. 测试方案

## MCP自动测试

目录：

```
tests/mcp/

```

测试：

```
test_connection.py

test_canvas.py

test_workflow.py

test_asset.py

test_provider.py

```

---

# 16. 完整度检查表

| 模块            | 状态 |
| ------------- | -- |
| 内部Agent删除     | 完成 |
| MCP Server    | 完成 |
| Canvas Tool   | 完成 |
| Workflow Tool | 完成 |
| Asset Tool    | 完成 |
| Provider Tool | 完成 |
| 权限系统          | 完成 |
| Codex支持       | 完成 |
| Claude Code支持 | 完成 |
| WorkBuddy支持   | 完成 |
| API Gateway   | 完成 |
| 数据库迁移         | 完成 |

---

# 17. V2最终架构

```
                 AI Programming Agents


        Codex     Claude     WorkBuddy


                     |

                     |

                 MCP Protocol


                     |

                     ↓


              LumiWeave Platform


      Canvas Engine

      Workflow Runtime

      Asset System

      Provider Hub

      Layout Engine

      Export Engine


                     |

                     ↓


              Professional Creation

```

---

# 最终定义

LumiWeave V2 不再是：

```
一个带AI的设计工具
```

而是：

```
一个可以被任何AI编程体控制的
AI创作操作系统。
```
