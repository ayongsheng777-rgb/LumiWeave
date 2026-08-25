import { useEffect, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Package } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { getProviders } from '../../api'
import { NodeShell, Field, inputCls } from './NodeShell'
import { GenerationModeField } from './GenerationModeField'

const BIND_TYPES = ['', 'character', 'scene']

export function PropNode({ id, data, selected }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    getProviders().then((r) => {
      if (r.ok) setProviders((r.data.providers || []).filter((p: { type: string }) => p.type === 'image'))
    })
  }, [])

  const name    = String(d.name ?? '')
  const desc    = String(d.description ?? '')
  const prompt  = String(d.prompt ?? '')
  const bindT   = String(d.bind_type ?? '')
  const bindId  = String(d.bind_id ?? '')
  const refs    = (d.reference as string[]) || []
  const url     = String((d.result as Record<string, unknown>)?.url ?? '')
  const renderMode = String(d.render_mode ?? 'comfyui')
  const providerId = String(d.provider_id ?? '')

  const run = () => update(id, { action: 'execute' })

  return (
    <NodeShell id={id} selected={selected} title="关键道具" icon={<Package size={15} />}>
      <Field label="道具名">
        <input className={inputCls} value={name} placeholder="如：能源核心、未来武器"
          onChange={(e) => update(id, { name: e.target.value })} />
      </Field>
      <Field label="描述">
        <textarea className={inputCls} rows={2} value={desc} placeholder="道具外观、功能……"
          onChange={(e) => update(id, { description: e.target.value })} />
      </Field>
      <Field label="提示词">
        <textarea className={inputCls} rows={2} value={prompt} placeholder="AI 出图提示词"
          onChange={(e) => update(id, { prompt: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="绑定到">
          <select className={inputCls} value={bindT} onChange={(e) => update(id, { bind_type: e.target.value, bind_id: '' })}>
            {BIND_TYPES.map((b) => <option key={b} value={b}>{b || '不绑定'}</option>)}
          </select>
        </Field>
        {bindT && (
          <Field label={`${bindT} ID`}>
            <input className={inputCls} value={bindId} placeholder="节点ID"
              onChange={(e) => update(id, { bind_id: e.target.value })} />
          </Field>
        )}
      </div>
      {refs.length > 0 && (
        <div className="flex gap-1 overflow-x-auto py-1">
          {refs.map((r, i) => <img key={i} src={r} className="h-12 w-12 rounded-md object-cover" alt="ref" />)}
        </div>
      )}
      {url ? <img className="h-24 w-full rounded-md object-cover" src={url} alt="道具图" />
        : <div className="flex h-16 items-center justify-center rounded-md bg-soft text-[11px] text-ink-3">点击生成获取道具图</div>}
      <GenerationModeField
        mode={renderMode}
        providerId={providerId}
        providers={providers}
        onModeChange={(v) => update(id, { render_mode: v })}
        onProviderChange={(v) => update(id, { provider_id: v })}
      />
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={run}>
        生成道具
      </button>
    </NodeShell>
  )
}
