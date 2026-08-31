// =====================================================================
// PixVerse 风格通用画布 · 主体
// 一块画布同时是「自由摆放的无限画布」和「按依赖执行的工作流」。
// V2：左侧窄工具栏（添加/选择/平移/撤销重做/整理/运行/保存/清空）、
//     首尾帧语义连线（虚线+标签）、视口随图落库、改动自动保存。
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Undo2,
  Redo2,
  Save,
  LayoutGrid,
  Trash2,
  Play,
  Plus,
  MousePointer2,
  Hand,
} from 'lucide-react'
import { usePvStore } from './store'
import { pvNodeTypes } from './nodes'
import { nodeColor } from './registry'
import type { PvNodeData, PvNodeTemplate } from './types'
import { PvNodePalette } from './PvNodePalette'
import { PvBottomBar } from './PvBottomBar'
import { PvComposer } from './PvComposer'
import { PvCropDialog } from './PvCropDialog'

export const DND_KEY = 'application/lumiweave-pv-node'

/** 画布交互模式：选择（框选节点）/ 平移（拖空白处移动画布） */
type ToolMode = 'select' | 'pan'

const AUTOSAVE_DELAY = 2500

function PvCanvasInner() {
  const nodes = usePvStore((s) => s.nodes)
  const edges = usePvStore((s) => s.edges)
  const onNodesChange = usePvStore((s) => s.onNodesChange)
  const onEdgesChange = usePvStore((s) => s.onEdgesChange)
  const onConnect = usePvStore((s) => s.onConnect)
  const addFromTemplate = usePvStore((s) => s.addFromTemplate)
  const save = usePvStore((s) => s.save)
  const saveStatus = usePvStore((s) => s.saveStatus)
  const runAll = usePvStore((s) => s.runAll)
  const running = usePvStore((s) => s.running)
  const runError = usePvStore((s) => s.runError)
  const setRunError = usePvStore((s) => s.setRunError)
  const applyAutoLayout = usePvStore((s) => s.applyAutoLayout)
  const clearAll = usePvStore((s) => s.clearAll)
  const undo = usePvStore((s) => s.undo)
  const redo = usePvStore((s) => s.redo)
  const canUndo = usePvStore((s) => s.undoStack.length > 0)
  const canRedo = usePvStore((s) => s.redoStack.length > 0)
  const workflowId = usePvStore((s) => s.workflowId)
  const savedViewport = usePvStore((s) => s.viewport)
  const setViewport = usePvStore((s) => s.setViewport)

  const rf = useReactFlow()
  const { screenToFlowPosition } = rf
  const wrapRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [tool, setTool] = useState<ToolMode>('select')

  // ── 视口还原：加载到旧画布时回到上次的位置，没存过就 fitView ──
  useEffect(() => {
    if (savedViewport) {
      void rf.setViewport(savedViewport)
    } else if (usePvStore.getState().nodes.length > 0) {
      void rf.fitView({ maxZoom: 1, padding: 0.25 })
    }
    // 只在切换画布（workflowId 变化）时还原，平时拖动视口不触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId])

  // ── 自动保存：改动停手 2.5s 后落库（对标 PixVerse 的自动保存）──
  useEffect(() => {
    if (nodes.length === 0 || running) return
    const timer = setTimeout(() => {
      void save()
    }, AUTOSAVE_DELAY)
    return () => clearTimeout(timer)
  }, [nodes, edges, savedViewport, running, save])

  // 连线着色 + 首尾帧语义：跟着源节点的类型色走，首帧绿/尾帧红虚线带标签
  const coloredEdges = useMemo<Edge[]>(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    return edges.map((e) => {
      const src = byId.get(e.source)
      const sd = src?.data as unknown as PvNodeData | undefined
      const active = sd?.status === 'running'
      const ct = (e.data as Record<string, unknown> | undefined)?.connectionType
      if (ct === 'firstFrame' || ct === 'lastFrame') {
        const c = ct === 'firstFrame' ? '#22c55e' : '#fb7185'
        return {
          ...e,
          type: 'smoothstep',
          style: { stroke: c, strokeWidth: 2, strokeDasharray: '7 5' },
          label: ct === 'firstFrame' ? '首帧' : '尾帧',
          labelStyle: { fill: c, fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: 'transparent' },
          animated: active,
        }
      }
      const color = nodeColor(sd)
      return {
        ...e,
        type: 'smoothstep',
        style: { stroke: color, strokeWidth: 2 },
        animated: active,
      }
    })
  }, [nodes, edges])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const raw = e.dataTransfer.getData(DND_KEY)
      if (!raw) return
      try {
        const tpl = JSON.parse(raw) as PvNodeTemplate
        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
        addFromTemplate(tpl, position)
      } catch {
        /* 拖进来的不是节点模板就忽略 */
      }
    },
    [screenToFlowPosition, addFromTemplate],
  )

  // 面板保持展开：连续拖/点好几个节点时不用反复开关
  // （落点若被占，store 会自动往右下错开，不会叠成一坨）
  const addAtCenter = useCallback(
    (tpl: PvNodeTemplate) => {
      const box = wrapRef.current?.getBoundingClientRect()
      const cx = box ? box.x + box.width / 2 : 600
      const cy = box ? box.y + box.height / 2 : 300
      const position = screenToFlowPosition({ x: cx, y: cy })
      addFromTemplate(tpl, position)
    },
    [screenToFlowPosition, addFromTemplate],
  )

  const toolBtn = (active: boolean) =>
    `nodrag flex h-9 w-9 items-center justify-center rounded-lg transition ${
      active ? 'bg-brand-500 text-white' : 'text-ink-2 hover:bg-hover hover:text-ink'
    } disabled:opacity-40`

  return (
    <div
      ref={wrapRef}
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
        onConnect={onConnect}
        nodeTypes={pvNodeTypes}
        fitView
        // 空画布时 fitView 会把缩放顶到 maxZoom（默认 2 倍），
        // 限死 1 倍，免得一进来就是 200% 的大字报
        fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={['Backspace', 'Delete']}
        // 工具模式：选择=拖空白框选节点；平移=拖空白移动画布
        selectionOnDrag={tool === 'select'}
        panOnDrag={tool === 'pan'}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        onMoveEnd={(_, vp) => setViewport(vp)}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="var(--lw-canvas-dot)" />
      </ReactFlow>

      {/* ── 左侧窄工具栏（对标 PixVerse）────────────────────────── */}
      <div
        className="absolute left-4 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border px-1.5 py-2 backdrop-blur-xl"
        style={{
          borderColor: 'var(--lw-glass-strong-edge)',
          background: 'var(--lw-glass-strong-bg)',
          boxShadow: 'var(--lw-node-shadow-hover)',
        }}
      >
        <div className="relative">
          <button
            className={toolBtn(paletteOpen)}
            onClick={() => setPaletteOpen((v) => !v)}
            title="添加节点"
          >
            <Plus size={16} className={paletteOpen ? 'rotate-45 transition' : 'transition'} />
          </button>
          {/* 节点库弹层（挂在工具栏右侧） */}
          <PvNodePalette
            open={paletteOpen}
            onToggle={() => setPaletteOpen((v) => !v)}
            onPick={addAtCenter}
            hideFab
            popupClassName="absolute left-12 top-0 z-20"
          />
        </div>
        <button
          className={toolBtn(tool === 'select')}
          onClick={() => setTool('select')}
          title="选择（拖空白框选节点）"
        >
          <MousePointer2 size={15} />
        </button>
        <button
          className={toolBtn(tool === 'pan')}
          onClick={() => setTool('pan')}
          title="平移（拖空白移动画布）"
        >
          <Hand size={15} />
        </button>
        <span className="my-0.5 h-px w-6" style={{ background: 'var(--lw-edge)' }} />
        <button className={toolBtn(false)} onClick={undo} disabled={!canUndo || running} title="撤销（Ctrl+Z）">
          <Undo2 size={15} />
        </button>
        <button className={toolBtn(false)} onClick={redo} disabled={!canRedo || running} title="重做（Ctrl+Shift+Z）">
          <Redo2 size={15} />
        </button>
        <span className="my-0.5 h-px w-6" style={{ background: 'var(--lw-edge)' }} />
        <button
          className={toolBtn(false)}
          onClick={applyAutoLayout}
          disabled={running || nodes.length === 0}
          title="按连线自动排列"
        >
          <LayoutGrid size={15} />
        </button>
        <button
          className={toolBtn(false)}
          onClick={() => void runAll()}
          disabled={running || nodes.length === 0}
          title="按依赖顺序跑完所有生成节点"
        >
          <Play size={15} />
        </button>
        <button
          className={toolBtn(false)}
          onClick={() => void save()}
          disabled={running}
          title={saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '已保存（改动会自动保存）' : '保存画布'}
        >
          <Save size={15} className={saveStatus === 'saved' ? 'text-teal-400' : undefined} />
        </button>
        <button className={toolBtn(false)} onClick={() => void clearAll()} disabled={running} title="清空画布">
          <Trash2 size={15} />
        </button>
      </div>

      {/* ── 底部：缩放条 ───────────────────────────────────────── */}
      <PvBottomBar />

      {/* ── 弹出层：提示词 composer（改完再生成）+ 裁剪对话框 ────── */}
      <PvComposer />
      <PvCropDialog />

      {/* ── 空态引导 ───────────────────────────────────────────── */}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center text-center">
          <div
            className="rounded-2xl border px-8 py-6 backdrop-blur-sm"
            style={{ borderColor: 'var(--lw-edge)', background: 'var(--lw-glass-strong-bg)' }}
          >
            <p className="text-sm font-medium text-ink">画布还是空的</p>
            <p className="mt-2 max-w-[22rem] text-xs leading-relaxed text-ink-3">
              点左侧「＋」拖一个素材节点进来上传图片，再加一个生成节点、选好模型，
              把素材连到生成节点上，写提示词就能开跑。改动会自动保存。
            </p>
          </div>
        </div>
      )}

      {/* ── 运行错误 ───────────────────────────────────────────── */}
      {runError && (
        <div
          className="absolute bottom-24 left-1/2 z-20 w-[min(92%,28rem)] -translate-x-1/2 animate-fade-in rounded-xl border border-red-500/40 px-4 py-3 text-sm shadow-node-dark"
          style={{ background: 'var(--lw-toast-bg)' }}
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5">⚠️</span>
            <div className="min-w-0">
              <p className="font-medium text-ink">运行提示</p>
              <p className="mt-1 break-words text-ink-2">{runError}</p>
              <button
                className="mt-2 text-xs text-ink-3 underline"
                onClick={() => setRunError(null)}
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default function PvCanvas() {
  return (
    <ReactFlowProvider>
      <PvCanvasInner />
    </ReactFlowProvider>
  )
}
