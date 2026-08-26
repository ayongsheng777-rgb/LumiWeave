import { useMemo, useCallback, useEffect, useState } from 'react'
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import { Layers, Settings2, X } from 'lucide-react'
import '@xyflow/react/dist/style.css'
import type { Connection } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import { NodeAdapterProvider } from '../store/nodeAdapter'
import { useUiStore } from '../store/uiStore'
import { canvasGetGraph } from '../api'
import { objectNodeTypes } from './objectNodes'
import CanvasToolbar from './CanvasToolbar'
import LayerPanel from './LayerPanel'
import CanvasInspector from './CanvasInspector'
import { maybeChainVideoFrame } from '../components/videoChain'

function CanvasCoreInner() {
  const objects = useCanvasStore((s) => s.objects)
  const edges = useCanvasStore((s) => s.edges)
  const projectId = useCanvasStore((s) => s.projectId)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange)
  const onConnect = useCanvasStore((s) => s.onConnect)
  const setSelected = useCanvasStore((s) => s.setSelected)
  const snapshot = useCanvasStore((s) => s.snapshot)
  const addObject = useCanvasStore((s) => s.addObject)
  const load = useCanvasStore((s) => s.load)
  const { screenToFlowPosition } = useReactFlow()

  // 面板默认隐藏：画布 100% 主导，右下角按钮唤出（互斥）
  const [showLayerPanel, setShowLayerPanel] = useState(false)
  const [showInspector, setShowInspector] = useState(false)

  // 进入无限画布时从后端加载已保存的对象 + 连线（持久化闭环）
  useEffect(() => {
    let cancelled = false
    canvasGetGraph(projectId).then((res) => {
      if (cancelled || !res.ok) return
      const rawNodes = (res.data.nodes || []) as Record<string, unknown>[]
      const rawEdges = (res.data.edges || []) as Record<string, unknown>[]
      const nodes = rawNodes.map((o) => ({
        id: String(o.id),
        type: String(o.type || 'text'),
        position: (o.position as { x: number; y: number }) || { x: 0, y: 0 },
        data: (() => {
          const c = (o.content as Record<string, unknown>) || {}
          // storyboard 类型：content.shots 透传到 data（避免画布加载后 shots 丢失）
          if (o.type === 'storyboard' && Array.isArray(c.shots)) {
            return { ...c, shots: c.shots }
          }
          return c
        })(),
        style: (o.size as { width?: number; height?: number })?.width
          ? { width: (o.size as { width: number }).width, height: (o.size as { height: number }).height }
          : undefined,
      }))
      const loadedEdges = rawEdges.map((e) => ({
        id: String(e.id),
        source: String(e.source),
        target: String(e.target),
        sourceHandle: (e.source_handle as string) || null,
        targetHandle: (e.target_handle as string) || null,
        type: 'workflow',
        animated: true,
      }))
      load(nodes as never, loadedEdges as never)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, load])

  const nodes = useMemo(() => objects.map((o) => ({ ...o })), [objects])

  // 连线拦截：video → video 自动取上游尾帧作下游首帧（V2.3 视频接龙）
  const handleConnect = useCallback(
    (conn: Connection) => {
      maybeChainVideoFrame(
        conn,
        () => objects.find((o) => o.id === conn.source),
        () => objects.find((o) => o.id === conn.target),
        (id, data) => useCanvasStore.getState().updateObject(id, data),
      )
      onConnect(conn)
    },
    [objects, onConnect],
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/lumiweave-node')
      if (!type) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      addObject(type, position)
    },
    [screenToFlowPosition, addObject],
  )

  return (
    <div className="canvas-wrap">
      <CanvasToolbar />

      <div className="canvas-body">
        <div className="canvas-flow" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onSelectionChange={({ nodes: sel }) => {
              setSelected(sel.map((n) => n.id))
              // 上下文感知 Inspector：单选节点自动滑出右侧参数抽屉（商业画布方案）
              const uc = useUiStore.getState()
              if (sel.length === 1) {
                uc.openNodeConfig(sel[0].id)
              } else if (uc.nodeConfig.open) {
                uc.closeNodeConfig()
              }
            }}
            onNodeDragStop={snapshot}
            nodeTypes={objectNodeTypes}
            fitView
            deleteKeyCode={['Backspace', 'Delete']}
            selectionOnDrag
            multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          >
            <Background gap={24} size={1} />
          </ReactFlow>

          {/* 右下角浮动唤出按钮 */}
          <div className="canvas-fabs">
            <button
              className={`canvas-fab ${showInspector ? 'active' : ''}`}
              onClick={() => { setShowInspector(!showInspector); setShowLayerPanel(false) }}
              title="参数面板"
            >
              <Settings2 size={17} />
            </button>
            <button
              className={`canvas-fab ${showLayerPanel ? 'active' : ''}`}
              onClick={() => { setShowLayerPanel(!showLayerPanel); setShowInspector(false) }}
              title="图层"
            >
              <Layers size={17} />
            </button>
          </div>

          {/* 抽屉式浮层面板（绝对定位，不挤占画布） */}
          {showLayerPanel && (
            <div className="canvas-drawer drawer-layer">
              <button className="drawer-close" onClick={() => setShowLayerPanel(false)} title="关闭">
                <X size={14} />
              </button>
              <LayerPanel />
            </div>
          )}
          {showInspector && !showLayerPanel && (
            <div className="canvas-drawer drawer-inspector">
              <button className="drawer-close" onClick={() => setShowInspector(false)} title="关闭">
                <X size={14} />
              </button>
              <CanvasInspector />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function CanvasCore() {
  return (
    <ReactFlowProvider>
      <NodeAdapterProvider variant="canvas">
        <CanvasCoreInner />
      </NodeAdapterProvider>
    </ReactFlowProvider>
  )
}
