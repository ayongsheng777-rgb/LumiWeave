import { useMemo } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore } from '../store/canvasStore'
import { objectNodeTypes } from './objectNodes'
import CanvasToolbar from './CanvasToolbar'
import LayerPanel from './LayerPanel'

function CanvasCoreInner() {
  // 用 selector 精确订阅：不订阅 selectedIds，避免 onSelectionChange→setSelected→重渲染→再触发的死循环
  const objects = useCanvasStore((s) => s.objects)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const setSelected = useCanvasStore((s) => s.setSelected)
  const snapshot = useCanvasStore((s) => s.snapshot)

  // 不把 selected 放进受控 node（选区由 ReactFlow 内部管理，仅经 onSelectionChange 同步回 store）
  const nodes = useMemo(() => objects.map((o) => ({ ...o })), [objects])
  const edges = useMemo(() => [], [])

  return (
    <div className="canvas-wrap">
      <CanvasToolbar />
      <div className="canvas-body">
        <div className="canvas-flow">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
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
