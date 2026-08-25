import { type NodeProps } from '@xyflow/react'
import { ImageIcon } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { NodeShell, Field, inputCls } from './NodeShell'

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const STYLES = ['电影感', '动漫', '写实', '水彩', '3D', '赛博朋克', '古风']

export function ImageNode({ id, data }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>

  const prompt  = String(d.prompt ?? '')
  const negative = String(d.negative ?? '')
  const ratio   = String(d.ratio ?? '16:9')
  const style   = String(d.style ?? '电影感')
  const refs    = (d.reference as string[]) || []
  const charIds = (d.character_ids as string[]) || []
  const url     = String(d.url ?? '')

  const run = () => update(id, { action: 'execute' })

  return (
    <NodeShell id={id} title="图片生成" icon={<ImageIcon size={15} />}>
      <Field label="正向提示词">
        <textarea className={inputCls} rows={2} value={prompt} placeholder="描述画面内容……"
          onChange={(e) => update(id, { prompt: e.target.value })} />
      </Field>
      <Field label="负向提示词">
        <input className={inputCls} value={negative} placeholder="不想出现的元素"
          onChange={(e) => update(id, { negative: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="比例">
          <select className={inputCls} value={ratio} onChange={(e) => update(id, { ratio: e.target.value })}>
            {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="风格">
          <select className={inputCls} value={style} onChange={(e) => update(id, { style: e.target.value })}>
            {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      {charIds.length > 0 && (
        <div className="rounded bg-soft px-2 py-1 text-[10px] text-ink-3">
          引用角色：{charIds.join(', ')}
        </div>
      )}
      {refs.length > 0 && (
        <div className="flex gap-1 overflow-x-auto py-1">
          {refs.map((r, i) => <img key={i} src={r} className="h-12 w-12 rounded-md object-cover" alt="ref" />)}
        </div>
      )}
      {url ? <img className="h-40 w-full rounded-md object-cover" src={url} alt="生成图" />
        : <div className="flex h-24 items-center justify-center rounded-md bg-soft text-[11px] text-ink-3">点击生成获取图片</div>}
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={run}>
        生成图片
      </button>
    </NodeShell>
  )
}
