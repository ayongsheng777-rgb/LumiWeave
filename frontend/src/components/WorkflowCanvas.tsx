import { useCallback, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Connection } from '@xyflow/react'
import { defaultDataFor, useWorkflowStore } from '../store/workflowStore'
import { useUiStore } from '../store/uiStore'
import { canvasFromWorkflow } from '../api'
import { nodeTypes } from './nodes'
import { maybeChainVideoFrame } from './videoChain'

const DND_KEY = 'application/lumiweave-node'

function WorkflowCanvasInner() {
  const { nodes, edges, running, runError, onNodesChange, onEdgesChange, addNode, clearAll, setRunError, save, workflowId, projectId, applyAutoLayout } =
    useWorkflowStore()
  const theme = useUiStore((s) => s.theme)
  const { screenToFlowPosition } = useReactFlow()
  const [dragOver, setDragOver] = useState(false)
  const [converting, setConverting] = useState(false)
  const dotColor = theme === 'dark' ? '#333333' : '#d3d6dd'

  const toCanvas = async () => {
    if (converting || nodes.length === 0) return
    setConverting(true)
    let wid = workflowId
    if (!wid) {
      await save()
      wid = useWorkflowStore.getState().workflowId
    }
    if (!wid) {
      setRunError('请先保存工作流再转成画布')
      setConverting(false)
      return
    }
    const res = await canvasFromWorkflow(wid, projectId)
    setConverting(false)
    if (res.ok) {
      setRunError(null)
    } else {
      setRunError('转成画布失败，请重试')
    }
  }

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const type = e.dataTransfer.getData(DND_KEY)
      if (!type) return
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addNode({
        id: `${type}_${Date.now()}`,
        type,
        data: defaultDataFor(type),
        position,
      })
    },
    [screenToFlowPosition, addNode],
  )

  // 连线拦截：video → video 自动取上游尾帧作下游首帧（V2.3 视频接龙）
  const handleConnect = useCallback(
    (conn: Connection) => {
      const { nodes: allNodes, onConnect: baseConnect } = useWorkflowStore.getState()
      maybeChainVideoFrame(
        conn,
        () => allNodes.find((n) => n.id === conn.source),
        () => allNodes.find((n) => n.id === conn.target),
        (id, data) => useWorkflowStore.getState().updateNodeData(id, data),
      )
      baseConnect(conn)
    },
    [],
  )

  return (
    <div
      className={`relative h-full w-full bg-canvas ${dragOver ? 'ring-2 ring-inset ring-brand-500/60' : ''}`}
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#8b5cf6', strokeWidth: 1.8 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color={dotColor} />
        <Controls className="!shadow-node-dark !border !border-edge !bg-panel-2" showInteractive={false} />
        <Panel position="top-left">
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg border border-edge bg-soft px-3 py-1.5 text-xs text-ink-2 transition hover:bg-soft disabled:opacity-40"
              onClick={applyAutoLayout}
              disabled={running || nodes.length === 0}
              title="按连线自动排列节点，避免重叠"
            >
              自动排列
            </button>
            <button
              className="rounded-lg border border-edge bg-soft px-3 py-1.5 text-xs text-ink-2 transition hover:bg-soft disabled:opacity-40"
              onClick={toCanvas}
              disabled={running || converting || nodes.length === 0}
            >
              {converting ? '转换中…' : '转成画布'}
            </button>
            <button
              className="rounded-lg border border-edge bg-soft px-3 py-1.5 text-xs text-ink-2 transition hover:bg-soft disabled:opacity-40"
              onClick={() => {
                clearAll()
                setRunError(null)
              }}
              disabled={running}
            >
              清空画布
            </button>
          </div>
        </Panel>
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center text-center">
          <div className="rounded-2xl border border-edge bg-panel/70 px-8 py-6 shadow-node-dark backdrop-blur-sm">
            <p className="text-sm font-medium text-ink-2">画布还是空的</p>
            <p className="mt-2 max-w-[20rem] text-xs leading-relaxed text-ink-3">
              从左侧工具条拖入节点开始搭建，或点击图标直接添加；
              也可以先和右侧 AI 助手聊聊，让它帮你出主意。
            </p>
          </div>
        </div>
      )}

      {runError && (
        <div className="absolute bottom-5 left-1/2 z-10 w-[min(92%,28rem)] -translate-x-1/2 animate-fade-in rounded-xl border border-status-failed/40 bg-status-failed/10 px-4 py-3 text-sm text-red-200 shadow-node-dark">
          <div className="flex items-start gap-2">
            <span className="mt-0.5">⚠️</span>
            <div>
              <p className="font-medium">运行提示</p>
              <p className="mt-1 text-red-200/90">{runError}</p>
              <button className="mt-2 text-xs text-red-300 underline" onClick={() => setRunError(null)}>
                知道了
              </button>
            </div>
          </div>
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
