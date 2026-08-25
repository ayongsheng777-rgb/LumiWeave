import { type NodeProps } from '@xyflow/react'
import { Layout } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { NodeShell, Field, inputCls } from './NodeShell'

const TEMPLATES = [
  { value: 'film_poster', label: '电影海报' },
  { value: 'social_short', label: '社交短视频封面' },
  { value: 'album_cover', label: '专辑封面' },
  { value: 'poster_wide', label: '横版海报' },
]
const RATIOS = ['16:9', '9:16', '1:1', '4:3']

export function LayoutNode({ id, data }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>

  const template = String(d.template ?? 'film_poster')
  const ratio    = String(d.ratio ?? '16:9')
  const result   = d.result as Record<string, unknown> | undefined
  const url      = String(result?.url ?? '')

  const run = () => update(id, { action: 'execute' })

  return (
    <NodeShell id={id} title="排版设计" icon={<Layout size={15} />}>
      <Field label="模板">
        <select className={inputCls} value={template} onChange={(e) => update(id, { template: e.target.value })}>
          {TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <Field label="比例">
        <select className={inputCls} value={ratio} onChange={(e) => update(id, { ratio: e.target.value })}>
          {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      {url ? <img className="h-36 w-full rounded-md object-cover" src={url} alt="排版预览" />
        : <div className="flex h-24 items-center justify-center rounded-md bg-soft text-[11px] text-ink-3">
            排版结果预览
          </div>}
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={run}>
        生成排版
      </button>
    </NodeShell>
  )
}
