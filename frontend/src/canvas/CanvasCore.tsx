import { useMemo, useCallback } from 'react'
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
import { objectNodeTypes } from './objectNodes'
import CanvasToolbar from './CanvasToolbar'
import LayerPanel from './LayerPanel'
import CanvasInspector from './CanvasInspector'
import NodePalette from './NodePalette'

function CanvasCoreInner() {
  const objects = useCanvasStore((s) => s.objects)
  const edges = useCanvasStore((s) => s.edges)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange)
  const onConnect = useCanvasStore((s) => s.onConnect)
  const setSelected = useCanvasStore((s) => s.setSelected)
  const snapshot = useCanvasStore((s) => s.snapshot)
  const addObject = useCanvasStore((s) => s.addObject)
  const { screenToFlowPosition } = useReactFlow()

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
