/**
 * LumiWeave V2.5 LightingNode
 * 规格书 §2: Lighting Node（灯光控制）
 */
import type { NodeProps } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import NodeShell from '../canvas/NodeShell'

const DIRECTIONS = [
  { value: 'front', label: '正面', icon: '◉' },
  { value: 'left', label: '左侧', icon: '◐' },
  { value: 'right', label: '右侧', icon: '◒' },
  { value: 'back', label: '背面', icon: '◎' },
  { value: 'top', label: '顶光', icon: '▣' },
  { value: 'low', label: '脚光', icon: '▤' },
  { value: 'side_left', label: '侧逆', icon: '◔' },
  { value: 'side_right', label: '侧顺', icon: '◑' },
]

const TEMP_PRESETS = [
  { label: '烛光 1800K', value: 1800, color: '#ffb347' },
  { label: '白炽 2700K', value: 2700, color: '#ffe4b5' },
  { label: '暖黄 3200K', value: 3200, color: '#ffd27f' },
  { label: '日光 4200K', value: 4200, color: '#fff8dc' },
  { label: '正午 5600K', value: 5600, color: '#fffaf0' },
  { label: '阴天 6500K', value: 6500, color: '#e8f4ff' },
  { label: '日光灯 7500K', value: 7500, color: '#d6ecff' },
]

export function LightingNode({ id, data }: NodeProps) {
  const { updateObject, deleteObjects } = useCanvasStore()
  const d = data as { direction?: string; temperature?: number; intensity?: number; status?: string }

  const update = (patch: Record<string, unknown>) => {
    updateObject(id, { ...d, ...patch })
  }

  return (
    <NodeShell
      title="灯光"
      color="#f59e0b"
      status={d.status}
      onDelete={() => deleteObjects([id])}
    >
      <div className="space-y-2">
        <div>
          <label className="text-[9px] text-[var(--lw-ink-3)]">方向</label>
          <div className="grid grid-cols-4 gap-1">
            {DIRECTIONS.map((dir) => (
              <button
                key={dir.value}
                className={`text-[9px] py-1 rounded flex flex-col items-center gap-0.5 ${d.direction === dir.value ? 'bg-amber-500 text-white' : 'bg-[var(--lw-ink-1)] text-[var(--lw-ink-3)]'}`}
                onClick={() => update({ direction: dir.value })}
              >
                <span>{dir.icon}</span>
                <span>{dir.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[9px] text-[var(--lw-ink-3)]">色温</label>
          <div className="flex gap-1 flex-wrap">
            {TEMP_PRESETS.map((p) => (
              <button
                key={p.value}
                className={`text-[8px] px-1 py-0.5 rounded border ${d.temperature === p.value ? 'border-amber-500' : 'border-[var(--lw-ink-1)]'}`}
                style={{ backgroundColor: d.temperature === p.value ? p.color : undefined }}
                onClick={() => update({ temperature: p.value })}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[9px] text-[var(--lw-ink-3)]">
            强度 <span className="text-amber-400">{(d.intensity ?? 0.8).toFixed(1)}</span>
          </label>
          <input
            type="range" min={0} max={1} step={0.05}
            value={d.intensity ?? 0.8}
            onChange={(e) => update({ intensity: parseFloat(e.target.value) })}
            className="nodrag w-full h-1"
          />
        </div>
      </div>
    </NodeShell>
  )
}
