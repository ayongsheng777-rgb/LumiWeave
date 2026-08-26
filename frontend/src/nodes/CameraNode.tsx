/**
 * LumiWeave V2.5 CameraNode
 * 规格书 §2: Camera Node（镜头控制）
 */
import type { NodeProps } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import NodeShell from '../canvas/NodeShell'

const LENS_PRESETS = [
  { label: '24mm 超广', value: 24 },
  { label: '35mm 广角', value: 35 },
  { label: '50mm 标准', value: 50 },
  { label: '85mm 人像', value: 85 },
  { label: '135mm 长焦', value: 135 },
]

const SHOT_TYPES = [
  { value: 'extreme_wide', label: '极远景' },
  { value: 'wide', label: '远景' },
  { value: 'full', label: '全景' },
  { value: 'medium_full', label: '中全景' },
  { value: 'medium', label: '中景' },
  { value: 'medium_close', label: '中近景' },
  { value: 'close_up', label: '特写' },
  { value: 'extreme_close_up', label: '大特写' },
  { value: 'over_shoulder', label: '过肩' },
  { value: 'pov', label: '主观镜头' },
]

const ANGLES = [
  { value: 'eye', label: '平视' },
  { value: 'high', label: '俯拍' },
  { value: 'low', label: '仰拍' },
  { value: 'bird', label: '鸟瞰' },
  { value: 'worm', label: '蚁视' },
  { value: 'dutch', label: '倾斜' },
]

export function CameraNode({ id, data }: NodeProps) {
  const { updateObject, deleteObjects } = useCanvasStore()
  const d = data as { lens?: number; shot?: string; angle?: string; status?: string }

  const update = (patch: Record<string, unknown>) => {
    updateObject(id, { ...d, ...patch })
  }

  return (
    <NodeShell
      title="镜头"
      color="#06b6d4"
      status={d.status}
      onDelete={() => deleteObjects([id])}
    >
      <div className="space-y-2">
        <div>
          <label className="text-[9px] text-[var(--lw-ink-3)]">焦距</label>
          <div className="flex gap-1 flex-wrap">
            {LENS_PRESETS.map((p) => (
              <button
                key={p.value}
                className={`text-[9px] px-1.5 py-0.5 rounded ${d.lens === p.value ? 'bg-cyan-500 text-white' : 'bg-[var(--lw-ink-1)] text-[var(--lw-ink-3)]'}`}
                onClick={() => update({ lens: p.value })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="range" min={10} max={200}
            value={d.lens ?? 85}
            onChange={(e) => update({ lens: parseInt(e.target.value) })}
            className="nodrag w-full mt-1"
          />
          <div className="text-center text-[9px] text-[var(--lw-ink-3)]">{d.lens ?? 85}mm</div>
        </div>

        <div>
          <label className="text-[9px] text-[var(--lw-ink-3)]">景别</label>
          <select
            className="nodrag w-full text-xs bg-[var(--lw-ink-1)] rounded px-1.5 py-1 focus:outline-none"
            value={d.shot || 'medium'}
            onChange={(e) => update({ shot: e.target.value })}
          >
            {SHOT_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div>
          <label className="text-[9px] text-[var(--lw-ink-3)]">角度</label>
          <div className="flex gap-1 flex-wrap">
            {ANGLES.map((a) => (
              <button
                key={a.value}
                className={`text-[9px] px-1.5 py-0.5 rounded ${d.angle === a.value ? 'bg-cyan-500 text-white' : 'bg-[var(--lw-ink-1)] text-[var(--lw-ink-3)]'}`}
                onClick={() => update({ angle: a.value })}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </NodeShell>
  )
}
