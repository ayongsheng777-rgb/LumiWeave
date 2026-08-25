"""工作流模块（MCP 改造：从 app.agent 迁出，剥离 Agent 智能体，只保留执行核心）。

- types.py      引擎层数据模型（WorkflowGraph / NodeResult）
- engine.py     DAG 执行引擎（拓扑排序 + 节点执行 + 变量注入）
- node_registry.py  节点注册表（不含 Agent 节点）
- service.py    工作流持久化（workflows 表）
- routes.py     /api/workflow 路由
"""
