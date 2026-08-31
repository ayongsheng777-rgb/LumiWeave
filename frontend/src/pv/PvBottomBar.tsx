// 底部工具条 —— 对标 PixVerse 画布底部的缩放控件（滑杆版）
import { useReactFlow, useStore } from '@xyflow/react'
import { ZoomIn, ZoomOut, Maximize2, Boxes } from 'lucide-react'
import { usePvStore } from './store'

// 滑杆行程映射到缩放倍率：0 → 0.2x，100 → 2x（对数手感，中间是 1x）
function zoomToSlider(z: number): number {
  return Math.round((Math.log(z / 0.2) / Math.log(10)) * 100)
}
function sliderToZoom(v: number): number {
  return 0.2 * Math.pow(10, v / 100)
}

export function PvBottomBar() {
  const { zoomIn, zoomOut, fitView, zoomTo } = useReactFlow()
  const zoom = useStore((s) => s.transform[2])
  const nodeCount = usePvStore((s) => s.nodes.length)
  const edgeCount = usePvStore((s) => s.edges.length)

  const btn =
    'flex h-7 w-7 items-center justify-center rounded-md text-ink-2 transition hover:bg-soft hover:text-ink'

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
      <div
        className="pointer-events-auto flex items-center gap-1 rounded-full border px-2 py-1 backdrop-blur-xl"
        style={{
          borderColor: 'var(--lw-glass-strong-edge)',
          background: 'var(--lw-glass-strong-bg)',
          boxShadow: 'var(--lw-node-shadow-hover)',
        }}
      >
        <button className={btn} onClick={() => zoomOut({ duration: 150 })} title="缩小">
          <ZoomOut size={14} />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={zoomToSlider(zoom)}
          onChange={(e) => void zoomTo(sliderToZoom(Number(e.target.value)), { duration: 80 })}
          className="nodrag mx-1 h-1 w-24 cursor-pointer appearance-none rounded-full accent-brand-500"
          style={{ background: 'var(--lw-edge)' }}
          title="拖动缩放"
        />
        <button className={btn} onClick={() => zoomIn({ duration: 150 })} title="放大">
          <ZoomIn size={14} />
        </button>
        <span className="min-w-[3rem] text-center text-xs tabular-nums text-ink-2">
          {Math.round(zoom * 100)}%
        </span>
        <span className="mx-1 h-4 w-px" style={{ background: 'var(--lw-edge)' }} />
        <button
          className={btn}
          onClick={() => fitView({ duration: 300, padding: 0.2, maxZoom: 1 })}
          title="适应视图"
        >
          <Maximize2 size={14} />
        </button>
        <span
          className="ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-ink-3"
          title="画布上的节点数 / 连线数"
        >
          <Boxes size={11} />
          {nodeCount} 节点 · {edgeCount} 连线
        </span>
      </div>
    </div>
  )
}
