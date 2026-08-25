import { type NodeProps } from '@xyflow/react'
import { Clapperboard } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { cameraLabel } from '../../cameraLabels'
import { NodeShell, inputCls } from './NodeShell'

const CAMERAS = ['wide shot', 'medium shot', 'close-up', 'birds-eye view', 'worm-eye view',
  'dolly in', 'dolly out', 'pan left', 'pan right', 'tracking', 'handheld', 'orbit']

interface Shot { shot: number; camera: string; duration: number; description: string; prompt: string }

export function StoryboardNode({ id, data, selected }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>
  const shots = (d.shots as Shot[]) || []

  const totalDuration = shots.reduce((sum, s) => sum + (s.duration || 3), 0)

  const addShot = () => {
    const next = [...shots, { shot: shots.length + 1, camera: 'medium shot', duration: 3, description: '', prompt: '' }]
    update(id, { shots: next })
  }

  const updateShot = (idx: number, patch: Partial<Shot>) => {
    const next = shots.map((s, i) => i === idx ? { ...s, ...patch } : s)
    update(id, { shots: next })
  }

  const removeShot = (idx: number) => {
    const next = shots.filter((_, i) => i !== idx).map((s, i) => ({ ...s, shot: i + 1 }))
    update(id, { shots: next })
  }

  const run = () => update(id, { action: 'execute' })

  return (
    <NodeShell id={id} selected={selected} title="电影分镜" icon={<Clapperboard size={15} />}>
      <div className="mb-2 flex items-center justify-between text-[11px] text-ink-3">
        <span>{shots.length} 个镜头</span>
        <span>总时长 {totalDuration}s</span>
      </div>
      <div className="space-y-1.5">
        {shots.map((s, i) => (
          <div key={i} className="rounded-md border border-edge bg-soft p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-brand-400">SHOT {String(s.shot).padStart(2, '0')}</span>
              <button className="text-[10px] text-red-400 hover:text-red-300" onClick={() => removeShot(i)}>删除</button>
            </div>
            <input className={`${inputCls} mb-1`} value={s.description} placeholder="镜头描述"
              onChange={(e) => updateShot(i, { description: e.target.value })} />
            <div className="grid grid-cols-2 gap-1">
              <select className={`${inputCls} text-[11px]`} value={s.camera}
                onChange={(e) => updateShot(i, { camera: e.target.value })}>
                {CAMERAS.map((c) => <option key={c} value={c}>{cameraLabel(c)}</option>)}
                {!CAMERAS.includes(s.camera) && s.camera && <option value={s.camera}>{s.camera}</option>}
              </select>
              <input className={`${inputCls} text-[11px]`} type="number" min={1} max={30} value={s.duration}
                placeholder="秒" onChange={(e) => updateShot(i, { duration: Number(e.target.value) })} />
            </div>
          </div>
        ))}
      </div>
      <button className="nodrag mt-1 w-full rounded-md border border-dashed border-edge bg-soft py-1.5 text-[11px] text-ink-3 hover:border-brand-400 hover:text-brand-400"
        onClick={addShot}>
        + 添加镜头
      </button>
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={run}>
        生成分镜
      </button>
    </NodeShell>
  )
}
