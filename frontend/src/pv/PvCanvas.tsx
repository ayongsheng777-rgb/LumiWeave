// =====================================================================
// PixVerse 风格通用画布 · 主体
// 一块画布同时是「自由摆放的无限画布」和「按依赖执行的工作流」。
// =====================================================================
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Undo2, Redo2, Save, LayoutGrid, Trash2, Play } from 'lucide-react'
import { usePvStore } from './store'
import { pvNodeTypes } from './nodes'
import { nodeColor } from './registry'
import type { PvNodeData, PvNodeTemplate } from './types'
import { PvNodePalette } from './PvNodePalette'
import { PvBottomBar } from './PvBottomBar'

export const DND_KEY = 'application/lumiweave-pv-node'

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

  const { screenToFlowPosition } = useReactFlow()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // 连线着色：跟着源节点的类型色走，一眼看出数据从哪来
  const coloredEdges = useMemo<Edge[]>(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    return edges.map((e) => {
      const src = byId.get(e.source)
      const sd = src?.data as unknown as PvNodeData | undefined
      const color = nodeColor(sd)
      const active = sd?.status === 'running'
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

  const btn =
    'nodrag flex items-center gap-1.5 rounded-lg border border-edge bg-soft px-2.5 py-1.5 text-xs text-ink-2 transition hover:bg-hover hover:text-ink disabled:opacity-40'

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
        selectionOnDrag
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="var(--lw-canvas-dot)" />
      </ReactFlow>

      {/* ── 左上：撤销重做 / 保存 / 布局 ────────────────────────── */}
      <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2">
        <button className={btn} onClick={undo} disabled={!canUndo || running} title="撤销（Ctrl+Z）">
          <Undo2 size={13} /> 撤销
        </button>
        <button className={btn} onClick={redo} disabled={!canRedo || running} title="重做（Ctrl+Shift+Z）">
          <Redo2 size={13} /> 重做
        </button>
        <button className={btn} onClick={() => void save()} disabled={running} title="保存画布">
          <Save size={13} />
          {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '已保存' : '保存'}
        </button>
        <button
          className={btn}
          onClick={applyAutoLayout}
          disabled={running || nodes.length === 0}
          title="按连线自动排列"
        >
          <LayoutGrid size={13} /> 整理
        </button>
        <button
          className={btn}
          onClick={() => void runAll()}
          disabled={running || nodes.length === 0}
          title="按依赖顺序跑完所有生成节点"
        >
          <Play size={13} /> {running ? '运行中…' : '全部运行'}
        </button>
        <button
          className={btn}
          onClick={() => void clearAll()}
          disabled={running}
          title="清空画布"
        >
          <Trash2 size={13} /> 清空
        </button>
      </div>

      {/* ── 左下：节点库（对标 PixVerse 的 ➕ 添加节点）───────────── */}
      <div className="absolute bottom-16 left-4 z-10">
        <PvNodePalette
          open={paletteOpen}
          onToggle={() => setPaletteOpen((v) => !v)}
          onPick={addAtCenter}
        />
      </div>

      {/* ── 底部：缩放条 ───────────────────────────────────────── */}
      <PvBottomBar />

      {/* ── 空态引导 ───────────────────────────────────────────── */}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center text-center">
          <div
            className="rounded-2xl border px-8 py-6 backdrop-blur-sm"
            style={{ borderColor: 'var(--lw-edge)', background: 'var(--lw-glass-strong-bg)' }}
          >
            <p className="text-sm font-medium text-ink">画布还是空的</p>
            <p className="mt-2 max-w-[22rem] text-xs leading-relaxed text-ink-3">
              从左下角「添加节点」拖一个素材节点进来上传图片，再拖一个生成节点、选好模型，
              把素材连到生成节点上，写提示词就能开跑。
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
