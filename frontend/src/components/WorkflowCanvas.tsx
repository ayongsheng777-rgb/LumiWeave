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
import { defaultDataFor, useWorkflowStore } from '../store/workflowStore'
import { useUiStore } from '../store/uiStore'
import { nodeTypes } from './nodes'

const DND_KEY = 'application/lumiweave-node'

function WorkflowCanvasInner() {
  const { nodes, edges, running, runError, onNodesChange, onEdgesChange, onConnect, addNode, clearAll, setRunError } =
    useWorkflowStore()
  const theme = useUiStore((s) => s.theme)
  const { screenToFlowPosition } = useReactFlow()
  const [dragOver, setDragOver] = useState(false)
  const dotColor = theme === 'dark' ? '#333333' : '#d3d6dd'

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
        onConnect={onConnect}
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
