import { type NodeProps } from '@xyflow/react'
import { Clapperboard, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useWorkflowStore } from '../../store/workflowStore'
import { NodeShell } from './NodeShell'
import { ShotGenerator, type Shot } from './ShotGenerator'
import { filmStoryboardGenerate } from '../../api'
import { emitLog } from '../LogPanel'
import { subscribeShotJump } from '../ShotChainPanel'

export function StoryboardNode({ id, data, selected }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)

  const d = data as Record<string, unknown>
  // 兼容读取：shots 优先，storyboard 兜底
  const shots = ((d.shots as Shot[]) || (d.storyboard as Shot[]) || []) as Shot[]

  const ratio = String(d.ratio ?? '16:9')
  const style = String(d.style ?? '电影感')
  const total_duration = Number(d.total_duration ?? shots.reduce((sum, s) => sum + (s.duration || 3), 0))

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 左侧信息框「下一分镜」跳转目标：{ index, signal }，signal 变化触发对应 shot 自动生成
  const [jumpTarget, setJumpTarget] = useState<{ index: number; signal: number } | null>(null)
  const shotRefs = useRef<Record<number, HTMLDivElement | null>>({})

  // 订阅「下一分镜」跳转请求
  useEffect(() => {
    const unsub = subscribeShotJump((nodeId, shotIndex) => {
      if (nodeId !== id) return
      setJumpTarget({ index: shotIndex, signal: Date.now() })
      const el = shotRefs.current[shotIndex]
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return unsub
  }, [id])

  const addShot = () => {
    const next: Shot[] = [...shots, { shot: shots.length + 1, camera: 'medium shot', duration: 3, description: '', prompt: '', gen_status: 'idle' }]
    update(id, { shots: next })
  }

  const updateShot = (idx: number, patch: Partial<Shot>) => {
    const next = shots.map((s, i) => i === idx ? { ...s, ...patch } : s) as Shot[]
    update(id, { shots: next })
  }

  const removeShot = (idx: number) => {
    const next = shots.filter((_, i) => i !== idx).map((s, i) => ({ ...s, shot: i + 1 })) as Shot[]
    update(id, { shots: next })
  }

  // 「生成分镜」按钮：调用后端 AI 生成分镜列表
  const genStoryboard = async () => {
    setBusy(true); setError('')
    emitLog({ nodeId: id, nodeLabel: '电影分镜', nodeType: 'storyboard', status: 'running', message: 'AI 生成分镜表…' })
    const t0 = Date.now()
    try {
      // 从上游 story 节点取角色/场景/故事
      const upstream = edges.filter((e) => e.target === id).map((e) => e.source)
      const storyNode = nodes.find((n) => upstream.includes(n.id) && n.type === 'story')
      const sd = (storyNode?.data as Record<string, unknown>) || {}
      const chars = (sd.characters as unknown[]) || []
      const scenes = (sd.scenes as unknown[]) || []
      const storyText = String(sd.text ?? '')

      const res = await filmStoryboardGenerate({
        characters_json: JSON.stringify(chars),
        scenes_json: JSON.stringify(scenes),
        story_text: storyText,
        genre: String(sd.genre ?? '科幻'),
        style,
        ratio,
        total_duration,
      })

      if (res.ok !== false && res.data?.shots) {
        update(id, { shots: res.data.shots, total_duration: res.data.total_duration ?? total_duration })
        emitLog({ nodeId: id, nodeLabel: '电影分镜', nodeType: 'storyboard', status: 'completed', message: `分镜生成完成 · ${(res.data.shots as unknown[]).length} 个镜头`, duration: Date.now() - t0 })
      } else {
        const err = String(res.error || '生成失败')
        setError(err)
        emitLog({ nodeId: id, nodeLabel: '电影分镜', nodeType: 'storyboard', status: 'failed', message: `分镜生成失败 · ${err.slice(0, 60)}`, detail: err })
      }
    } catch (e) {
      setError(String(e))
      emitLog({ nodeId: id, nodeLabel: '电影分镜', nodeType: 'storyboard', status: 'failed', message: `分镜生成失败 · ${String(e).slice(0, 60)}` })
    } finally {
      setBusy(false)
    }
  }

  const doneCount = shots.filter((s) => s.gen_status === 'done').length

  return (
    <NodeShell id={id} selected={selected} title="电影分镜" icon={<Clapperboard size={15} />}>
      <div className="mb-2 flex items-center justify-between text-[11px] text-ink-3">
        <span>{shots.length} 个镜头</span>
        <span>总时长 {shots.reduce((sum, s) => sum + (s.duration || 3), 0)}s</span>
        {doneCount > 0 && <span className="text-green-400">已生成 {doneCount}/{shots.length}</span>}
      </div>

      {error && <div className="mb-2 rounded bg-status-failed/10 px-2 py-1 text-[11px] text-status-failed">{error}</div>}

      <div className="space-y-1.5">
        {shots.map((s, i) => (
          <div key={i} ref={(el) => { shotRefs.current[i] = el }}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-brand-400">SHOT {String(s.shot).padStart(2, '0')}</span>
              <button className="text-[10px] text-red-400 hover:text-red-300" onClick={() => removeShot(i)}>删除</button>
            </div>
            <ShotGenerator
              shot={s}
              index={i}
              totalShots={shots.length}
              nodeId={id}
              nodeLabel="电影分镜"
              onUpdate={(patch) => updateShot(i, patch)}
              autoGenSignal={jumpTarget?.index === i ? jumpTarget.signal : 0}
            />
          </div>
        ))}
      </div>

      <button className="nodrag mt-1 w-full rounded-md border border-dashed border-edge bg-soft py-1.5 text-[11px] text-ink-3 hover:border-brand-400 hover:text-brand-400"
        onClick={addShot}>
        <Plus size={11} className="mr-1 inline" />添加镜头
      </button>

      <button className="nodrag mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={busy ? undefined : genStoryboard} disabled={busy}>
        <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
        {busy ? '生成中…' : '生成分镜'}
      </button>
    </NodeShell>
  )
}
