import { useMemo, useCallback, useEffect } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore } from '../store/canvasStore'
import { canvasGetGraph } from '../api'
import { objectNodeTypes } from './objectNodes'
import CanvasToolbar from './CanvasToolbar'
import LayerPanel from './LayerPanel'
import CanvasInspector from './CanvasInspector'
import NodePalette from './NodePalette'

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
        <NodePalette />

        <div className="canvas-flow" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={({ nodes: sel }) => setSelected(sel.map((n) => n.id))}
            onNodeDragStop={snapshot}
            nodeTypes={objectNodeTypes}
            fitView
            deleteKeyCode={['Backspace', 'Delete']}
            selectionOnDrag
            multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          >
            <Background gap={24} size={1} />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        <LayerPanel />
        <CanvasInspector />
      </div>
    </div>
  )
}

export default function CanvasCore() {
  return (
    <ReactFlowProvider>
      <CanvasCoreInner />
    </ReactFlowProvider>
  )
}
