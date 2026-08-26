/**
 * LumiWeave V2.5 CanvasCore
 * 规格书 §3 React Canvas 核心
 * 支持 6 种标准节点 + 所有原有影视节点
 */
import { useCallback, useState } from 'react'
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import { Layers, Settings2, X } from 'lucide-react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore } from '../store/canvasStore'
import { useUiStore } from '../store/uiStore'
import CanvasToolbar from './CanvasToolbar'
import LayerPanel from './LayerPanel'
import CanvasInspector from './CanvasInspector'
import NodePalette from './NodePalette'
import { objectNodeTypes } from './objectNodes'
import { PromptNode, ReferenceNode, CameraNode, LightingNode, MotionNode, RenderNode } from '../nodes'

// ── V2.5 标准节点注册表 ──────────────────────────────────────────────────────
const V2NodeTypes = {
  prompt:    PromptNode,
  reference: ReferenceNode,
  camera:    CameraNode,
  lighting:  LightingNode,
  motion:    MotionNode,
  render:    RenderNode,
}

// 合并：原有影视节点 + V2.5 标准节点
const allNodeTypes = { ...objectNodeTypes, ...V2NodeTypes }

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

  const [showLayerPanel, setShowLayerPanel] = useState(false)
  const [showInspector,  setShowInspector]  = useState(false)

  // ── 拖拽添加节点（从左侧节点库拖入画布）────────────────────────────────
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
        {/* 左侧节点面板 */}
        <NodePalette />

        {/* 画布主体 */}
        <div className="canvas-flow flex-1" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <ReactFlow
            nodes={objects}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={({ nodes: sel }) => {
              setSelected(sel.map((n) => n.id))
              const uc = useUiStore.getState()
              if (sel.length === 1) uc.openNodeConfig(sel[0].id)
              else if (uc.nodeConfig.open) uc.closeNodeConfig()
            }}
            nodeTypes={allNodeTypes}
            fitView
            deleteKeyCode={['Backspace', 'Delete']}
            selectionOnDrag
            multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          >
            <Background gap={24} size={1} />
          </ReactFlow>

          {/* 右下角浮动按钮 */}
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

          {/* 抽屉面板 */}
          {showLayerPanel && (
            <div className="canvas-drawer drawer-layer">
              <button className="drawer-close" onClick={() => setShowLayerPanel(false)}><X size={14} /></button>
              <LayerPanel />
            </div>
          )}
          {showInspector && !showLayerPanel && (
            <div className="canvas-drawer drawer-inspector">
              <button className="drawer-close" onClick={() => setShowInspector(false)}><X size={14} /></button>
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
      <CanvasCoreInner />
    </ReactFlowProvider>
  )
}
