import { type NodeProps } from '@xyflow/react'
import { BookOpen } from 'lucide-react'
import { useState } from 'react'
import { useWorkflowStore } from '../../store/workflowStore'
import { NodeShell, Field, inputCls } from './NodeShell'
import { filmStoryParse } from '../../api'

const GENRES = ['科幻', '奇幻', '爱情', '战争', '悬疑', '喜剧', '动作', '动画', '惊悚', '纪录片']
const STYLES = ['电影感', '动漫', '写实', '水彩', '3D', '赛博朋克', '蒸汽朋克', '古风']
const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4']

export function StoryNode({ id, data }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>

  const story    = String(d.text ?? '')
  const genre    = String(d.genre ?? '科幻')
  const style    = String(d.style ?? '电影感')
  const ratio    = String(d.ratio ?? '16:9')
  const duration = Number(d.duration ?? 30)
  const chars    = (d.characters as unknown[]) || []
  const scenes   = (d.scenes as unknown[]) || []
  const props    = (d.props as unknown[]) || []
  const shots    = (d.storyboard as unknown[]) || []
  const status   = String(d.status ?? 'idle')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    if (!story.trim()) { setError('请先输入故事内容'); return }
    setBusy(true); setError('')
    update(id, { status: 'running' })
    try {
      const res = await filmStoryParse({ text: story, genre, style, ratio, duration })
      if (res.ok !== false && res.data) {
        const parsed = res.data
        update(id, {
          status: 'completed',
          characters: parsed.characters || [],
          scenes:    parsed.scenes    || [],
          props:     parsed.props     || [],
          storyboard: parsed.shots    || [],
        })
      } else {
        setError((res.error || '解析失败') as string)
        update(id, { status: 'failed' })
      }
    } catch (e) {
      setError(String(e))
      update(id, { status: 'failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <NodeShell id={id} title="故事输入" icon={<BookOpen size={15} />}>
      <Field label="故事内容">
        <textarea
          className={inputCls}
          rows={4}
          value={story}
          placeholder="输入故事、小说、广告需求或视频创意……"
          onChange={(e) => update(id, { text: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="类型">
          <select className={inputCls} value={genre} onChange={(e) => update(id, { genre: e.target.value })}>
            {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="风格">
          <select className={inputCls} value={style} onChange={(e) => update(id, { style: e.target.value })}>
            {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="比例">
          <select className={inputCls} value={ratio} onChange={(e) => update(id, { ratio: e.target.value })}>
            {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="时长(秒)">
          <input className={inputCls} type="number" min={5} max={300} value={duration}
            onChange={(e) => update(id, { duration: Number(e.target.value) })} />
        </Field>
      </div>
      {error && <div className="rounded bg-status-failed/10 px-2 py-1 text-[11px] text-status-failed">{error}</div>}
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={busy ? undefined : run} disabled={busy}>
        {busy ? 'AI 解析中…' : 'AI 解析生成流程'}
      </button>
      {/* 解析预览 */}
      {(chars.length > 0 || status === 'completed') && (
        <div className="mt-2 rounded-md bg-soft px-2 py-1.5 text-[11px] text-ink-2">
          <span className="text-[10px] text-ink-3">解析结果：</span>
          {chars.length}个角色 · {scenes.length}个场景 · {props.length}个道具 · {shots.length}个分镜
        </div>
      )}
    </NodeShell>
  )
}
