/** StoryboardNodeCanvas — 画布版分镜节点
 * 使用 useCanvasStore，支持 shots 编辑、ShotGenerator 生成、翻译
 * 对应 canvasStore.OBJECT_LIBRARY 的 'storyboard' 类型
 */
import { Clapperboard, Plus } from 'lucide-react'
import { Handle, Position } from '@xyflow/react'
import { useCanvasStore } from '../../store/canvasStore'
import { ShotGenerator, type Shot } from './ShotGenerator'

const CAMERAS = [
  'wide shot', 'medium shot', 'close-up', 'birds-eye view', 'worm-eye view',
  'dolly in', 'dolly out', 'pan left', 'pan right', 'tracking', 'handheld', 'orbit',
]

export function StoryboardNodeCanvas({ id, data }: { id: string; data: Record<string, unknown> }) {
  const updateObject = useCanvasStore((s) => s.updateObject)
  const d = (data || {}) as Record<string, unknown>
  const shots = (d.shots as Shot[]) || []

  const totalDuration = shots.reduce((sum: number, s: Shot) => sum + (s.duration || 3), 0)

  // 生成完成计数
  const doneCount = shots.filter((s: Shot) => s.gen_status === 'done').length
  const totalCount = shots.length

  const updateShot = (idx: number, patch: Partial<Shot>) => {
    const next = shots.map((s: Shot, i: number) => i === idx ? { ...s, ...patch } : s) as Shot[]
    updateObject(id, { shots: next })
  }

  const addShot = () => {
    const next: Shot[] = [...shots, {
      shot: shots.length + 1,
      camera: 'medium shot',
      duration: 3,
      description: '',
      prompt: '',
      gen_status: 'idle',
    }]
    updateObject(id, { shots: next })
  }

  return (
    <div
      className="flex h-full w-full flex-col rounded-xl bg-panel-2 ring-1 ring-edge border border-edge shadow-node-dark"
      style={{ minWidth: 280, maxWidth: 380 }}
    >
      {/* 左侧输入 Handle */}
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-canvas !bg-brand-500" />

      {/* 标题栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <Clapperboard size={14} className="text-orange-400" />
        <span className="text-sm font-medium text-ink">电影分镜</span>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-ink-3">
          <span>{shots.length} 个镜头</span>
          <span>·</span>
          <span>总时长 {totalDuration}s</span>
          {doneCount > 0 && (
            <>
              <span>·</span>
              <span className="text-green-400">已生成 {doneCount}/{totalCount}</span>
            </>
          )}
        </div>
      </div>

      {/* Shots 列表 */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {shots.map((s: Shot, i: number) => (
          <ShotGenerator
            key={s.shot}
            shot={s}
            index={i}
            totalShots={shots.length}
            nodeId={id}
            nodeLabel="电影分镜"
            onUpdate={(patch) => updateShot(i, patch)}
          />
        ))}
      </div>

      {/* 底部操作栏 */}
      <div className="shrink-0 space-y-1.5 border-t border-edge p-3">
        <div className="grid grid-cols-2 gap-1.5">
          <select
            className="nodrag rounded-md border border-edge bg-input px-2 py-1.5 text-[11px] text-ink outline-none"
            defaultValue="medium shot"
            onChange={(e) => {
              if (shots.length === 0) addShot()
              const next = shots.map((s: Shot) => ({ ...s, camera: e.target.value })) as Shot[]
              updateObject(id, { shots: next })
            }}
          >
            {CAMERAS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            className="nodrag rounded-md border border-edge bg-input px-2 py-1.5 text-[11px] text-ink outline-none"
            type="number"
            min={1}
            max={30}
            placeholder="时长(秒)"
            defaultValue={3}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (shots.length === 0) addShot()
              const next = shots.map((s: Shot) => ({ ...s, duration: v })) as Shot[]
              updateObject(id, { shots: next })
            }}
          />
        </div>
        <button
          className="nodrag w-full rounded-md border border-dashed border-edge bg-soft py-1.5 text-[11px] text-ink-3 transition hover:border-orange-400 hover:text-orange-400"
          onClick={addShot}
        >
          <Plus size={11} className="inline mr-1" />添加镜头
        </button>
      </div>

      {/* 右侧输出 Handle */}
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-canvas !bg-brand-500" />
    </div>
  )
}
