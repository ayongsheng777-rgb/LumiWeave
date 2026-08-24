import { useState } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { runWorkflow } from '../api'
import { makeNode, useWorkflowStore, type NodeStatus } from '../store/workflowStore'
import { useLayoutStore } from '../store/layoutStore'
import { nodeTypes } from './workflowNodes'

const NODE_LIBRARY: { type: string; label: string; desc: string }[] = [
  { type: 'input', label: '输入', desc: '放原始需求，流程起点' },
  { type: 'llm', label: 'LLM 推理', desc: '调用大模型生成内容' },
  { type: 'prompt_template', label: '提示词模板', desc: '检索知识库并注入提示词' },
  { type: 'skill', label: '技能调用', desc: '执行平台已安装的技能' },
  { type: 'output', label: '输出', desc: '汇总上游结果' },
]

function WorkflowCanvasInner() {
  const {
    nodes, edges, running,
    onNodesChange, onEdgesChange, onConnect,
    addNode, clearAll, setNodeStatus, resetStatus, setRunning,
  } = useWorkflowStore()
  const setCanvasOpen = useLayoutStore((s) => s.setCanvasOpen)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const addLibraryNode = (type: string) => {
    const defaults: Record<string, Record<string, unknown>> = {
      input: { text: '' },
      llm: { prompt: '', temperature: 0.3 },
      prompt_template: { template: '', query: '' },
      skill: { skill_id: '', args: {} },
      output: { text: '' },
    }
    addNode(makeNode(type, defaults[type] || {}))
  }

  const prettyResult = (final: Record<string, unknown>): string => {
    for (const n of nodes) {
      if (n.type === 'output') {
        const o = final[n.id]
        if (o && typeof o === 'object' && (o as Record<string, unknown>).content) {
          return String((o as Record<string, unknown>).content)
        }
      }
    }
    return JSON.stringify(final, null, 2)
  }

  const run = async () => {
    if (running || nodes.length === 0) return
    setResult(null)
    setError(null)
    resetStatus()
    setRunning(true)
    const graph = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: (n.type || 'input') as string,
        data: (n.data || {}) as Record<string, unknown>,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      })),
    }
    try {
      const final = await runWorkflow(graph, (nodeId, status, _r) => {
        setNodeStatus(nodeId, status as NodeStatus)
      })
      setResult(prettyResult(final))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const clear = () => {
    clearAll()
    setResult(null)
    setError(null)
  }

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <div className="canvas-lib">
          {NODE_LIBRARY.map((n) => (
            <button key={n.type} className="lib-btn" onClick={() => addLibraryNode(n.type)} title={n.desc}>
              + {n.label}
            </button>
          ))}
        </div>
        <div className="canvas-actions">
          <button className="run-btn" onClick={run} disabled={running || nodes.length === 0}>
            {running ? '执行中…' : '▶ 执行'}
          </button>
          <button className="ghost" onClick={clear} disabled={running}>
            清空
          </button>
          <button className="ghost" onClick={() => setCanvasOpen(false)}>
            收起画布
          </button>
        </div>
      </div>

      <div className="canvas-flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background gap={20} size={1} />
          <Controls />
        </ReactFlow>
      </div>

      {(result || error) && (
        <div className={`canvas-result ${error ? 'err' : ''}`}>
          <div className="canvas-result-head">
            <b>{error ? '执行出错' : '执行结果'}</b>
            <button className="ghost" onClick={() => { setResult(null); setError(null) }}>
              关闭
            </button>
          </div>
          <pre>{error || result}</pre>
        </div>
      )}
    </div>
  )
}

export default function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner />
    </ReactFlowProvider>
  )
}
