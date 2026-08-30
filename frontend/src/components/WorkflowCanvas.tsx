import { useCallback, useMemo, useState } from 'react'
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
import { Undo2, Redo2 } from 'lucide-react'
import { defaultDataFor, useWorkflowStore } from '../store/workflowStore'
import { canvasFromWorkflow, canvasGetGraph } from '../api'
import { nodeTypes } from './nodes'
import { maybeChainVideoFrame } from './videoChain'
import { getNodeDef } from '../canvas/nodeRegistry'
import { useUiStore } from '../store/uiStore'
import { useCanvasStore } from '../store/canvasStore'

const DND_KEY = 'application/lumiweave-node'

type AnyObj = Record<string, unknown>

function WorkflowCanvasInner() {
  const { nodes, edges, running, runError, onNodesChange, onEdgesChange, addNode, clearAll, setRunError, save, saveStatus, undo, redo, workflowId, projectId, applyAutoLayout } =
    useWorkflowStore()
  const setMode = useUiStore((s) => s.setMode)
  const loadCanvas = useCanvasStore((s) => s.load)
  const canUndo = useWorkflowStore((s) => s.undoStack.length > 0)
  const canRedo = useWorkflowStore((s) => s.redoStack.length > 0)
  const { screenToFlowPosition } = useReactFlow()
  const [dragOver, setDragOver] = useState(false)
  const [converting, setConverting] = useState(false)
  const dotColor = 'var(--lw-canvas-dot)'

  // 语义连线（V2.8）：每条边用 source 节点类型色；端点节点运行中时加蚂蚁线动画
  const coloredEdges = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    return edges.map((e) => {
      const src = byId.get(e.source)
      const def = src ? getNodeDef(String(src.type ?? '')) : undefined
      const color = def?.color || 'var(--lw-ink-3)'
      const srcStatus = String(((src?.data as AnyObj)?.status) || 'idle')
      const tgt = byId.get(e.target)
      const tgtStatus = String(((tgt?.data as AnyObj)?.status) || 'idle')
      const anim = running || srcStatus === 'running' || tgtStatus === 'running'
      return {
        ...e,
        style: { ...(e.style || {}), stroke: color, strokeWidth: 2 },
        className: anim ? 'scene-edge-anim' : undefined,
      }
    })
  }, [nodes, edges, running])

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
    if (!res.ok) {
      setRunError('转成画布失败，请重试')
      return
    }
    // 🔴 转换成功：把后端生成的画布对象拉回前端、加载进画布 store，并切到无限画布，
    // 否则用户仍停在工作流画布、看不到任何变化（用户反馈「转不成画布」的根因）。
    try {
      const g = await canvasGetGraph(projectId)
      const objs = ((g.data as { nodes?: Record<string, unknown>[] })?.nodes) || []
      const eds = ((g.data as { edges?: Record<string, unknown>[] })?.edges) || []
      const rfNodes = objs.map((o) => {
        const pos = (o.position as { x?: number; y?: number }) || {}
        const size = (o.size as { width?: number; height?: number }) || {}
        const safePos = typeof pos.x === 'number' && typeof pos.y === 'number' ? { x: pos.x, y: pos.y } : { x: 0, y: 0 }
        return {
          id: String(o.id),
          type: String(o.type),
          position: safePos,
          data: { ...((o.content as Record<string, unknown>) || {}), status: 'idle' },
          style: size.width || size.height ? { width: size.width, height: size.height } : undefined,
        }
      })
      const rfEdges = eds.map((e) => ({
        id: String(e.id || `${e.source}->${e.target}`),
        source: String(e.source),
        target: String(e.target),
        sourceHandle: (e.source_handle as string) ?? null,
        targetHandle: (e.target_handle as string) ?? null,
        type: 'workflow',
      }))
      loadCanvas(rfNodes, rfEdges)
      setMode('infinite')
      setRunError(null)
    } catch {
      setRunError('画布已生成，但预览加载失败，请手动切到「无限画布」查看')
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
        edges={coloredEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
          style: { stroke: 'var(--lw-ink-3)', strokeWidth: 1.5 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color={dotColor} />
        <Controls className="!shadow-node-dark !border !border-[var(--lw-glass-edge)] !bg-[var(--lw-glass-bg)] backdrop-blur-md" showInteractive={false} />
        <Panel position="top-left">
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg border border-edge bg-soft px-3 py-1.5 text-xs text-ink-2 transition hover:bg-soft disabled:opacity-40"
              onClick={undo}
              disabled={!canUndo || running}
              title="返回（撤销，Ctrl+Z）"
            >
              <Undo2 size={13} className="inline" /> 返回
            </button>
            <button
              className="rounded-lg border border-edge bg-soft px-3 py-1.5 text-xs text-ink-2 transition hover:bg-soft disabled:opacity-40"
              onClick={redo}
              disabled={!canRedo || running}
              title="前进（重做，Ctrl+Shift+Z）"
            >
              <Redo2 size={13} className="inline" /> 前进
            </button>
            <button
              className="rounded-lg border border-edge bg-soft px-3 py-1.5 text-xs text-ink-2 transition hover:bg-soft disabled:opacity-40"
              onClick={() => void save()}
              disabled={running || nodes.length === 0}
              title="保存当前工作流状态"
            >
              {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '已保存' : '保存'}
            </button>
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
