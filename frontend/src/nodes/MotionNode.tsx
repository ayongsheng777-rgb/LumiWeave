/**
 * LumiWeave V2.5 MotionNode
 * 规格书 §2: Motion Node（运动控制）
 */
import type { NodeProps } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import NodeShell from '../canvas/NodeShell'

const MOTION_TYPES = [
  { value: 'static', label: '静止' },
  { value: 'zoom_in', label: '推近' },
  { value: 'zoom_out', label: '拉远' },
  { value: 'pan_left', label: '左摇' },
  { value: 'pan_right', label: '右摇' },
  { value: 'tilt_up', label: '上摇' },
  { value: 'tilt_down', label: '下摇' },
  { value: 'dolly_in', label: '轨道推进' },
  { value: 'dolly_out', label: '轨道拉远' },
  { value: 'track_left', label: '横移左' },
  { value: 'track_right', label: '横移右' },
  { value: 'crane_up', label: '升降上' },
  { value: 'crane_down', label: '升降下' },
  { value: 'handheld', label: '手持抖动' },
  { value: 'spin', label: '旋转' },
]

export function MotionNode({ id, data }: NodeProps) {
  const { updateObject, deleteObjects } = useCanvasStore()
  const d = data as { type?: string; speed?: number; duration?: number; status?: string }

  const update = (patch: Record<string, unknown>) => {
    updateObject(id, { ...d, ...patch })
  }

  const isMotion = d.type && d.type !== 'static'

  return (
    <NodeShell
      title="运动"
      color="#10b981"
      status={d.status}
      onDelete={() => deleteObjects([id])}
    >
      <div className="space-y-2">
        <div>
          <label className="text-[9px] text-[var(--lw-ink-3)]">运动类型</label>
          <div className="grid grid-cols-3 gap-1">
            {MOTION_TYPES.map((m) => (
              <button
                key={m.value}
                className={`text-[9px] py-1 px-0.5 rounded text-center ${d.type === m.value ? 'bg-emerald-500 text-white' : 'bg-[var(--lw-ink-1)] text-[var(--lw-ink-3)]'}`}
                onClick={() => update({ type: m.value })}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[9px] text-[var(--lw-ink-3)]">
            速度 <span className="text-emerald-400">{(d.speed ?? 0.3).toFixed(1)}</span>
          </label>
          <input
            type="range" min={0.1} max={1} step={0.05}
            value={d.speed ?? 0.3}
            onChange={(e) => update({ speed: parseFloat(e.target.value) })}
            className="nodrag w-full h-1"
          />
        </div>

        <div>
          <label className="text-[9px] text-[var(--lw-ink-3)]">
            时长 <span className="text-emerald-400">{d.duration ?? 5}s</span>
          </label>
          <input
            type="range" min={1} max={30} step={0.5}
            value={d.duration ?? 5}
            onChange={(e) => update({ duration: parseFloat(e.target.value) })}
            className="nodrag w-full h-1"
          />
        </div>

        {isMotion && (
          <div className="text-[9px] text-center text-[var(--lw-ink-3)] bg-[var(--lw-ink-1)] rounded py-1">
            运动方向：{MOTION_TYPES.find((m) => m.value === d.type)?.label}
          </div>
        )}
      </div>
    </NodeShell>
  )
}
