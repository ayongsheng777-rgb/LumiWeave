/**
 * LumiWeave V2.5 CanvasCore（无限画布）
 * V2.8 精简：移除左右节点库/图层/检查器面板，节点库改用工作流同款悬浮菜单（FloatingToolbar）
 */
import { useCallback } from 'react'
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore } from '../store/canvasStore'
import CanvasToolbar from './CanvasToolbar'
import { objectNodeTypes } from './objectNodes'

// 节点类型 = 影视节点（参数已收敛进主节点悬浮弹窗，不再有独立参数节点）
const allNodeTypes = objectNodeTypes

function CanvasCoreInner() {
  // canvasStore 使用 objects 字段，不是 nodes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const objects   = useCanvasStore((s) => s.objects) as any
  const edges     = useCanvasStore((s) => s.edges)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange)
  const onConnect = useCanvasStore((s) => s.onConnect)
  const setSelected = useCanvasStore((s) => s.setSelected)
  const { screenToFlowPosition } = useReactFlow()

  // ── 拖拽添加节点（从悬浮节点库拖入画布）────────────────────────────────
  const addObject = useCanvasStore((s) => s.addObject)
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/lumiweave-node') as string
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
        {/* 画布主体（节点库走 Workspace 悬浮菜单 FloatingToolbar） */}
        <div className="canvas-flow flex-1" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <ReactFlow
            nodes={objects}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={({ nodes: sel }) => setSelected(sel.map((n) => n.id))}
            nodeTypes={allNodeTypes}
            fitView
            deleteKeyCode={['Backspace', 'Delete']}
            selectionOnDrag
            multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          >
            <Background gap={24} size={1} />
          </ReactFlow>
        </div>
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
