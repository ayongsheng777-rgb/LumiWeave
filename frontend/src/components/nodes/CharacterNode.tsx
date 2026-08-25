import { useEffect, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { User } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { getProviders } from '../../api'
import { NodeShell, Field, inputCls } from './NodeShell'
import { GenerationModeField } from './GenerationModeField'

const STYLES = ['电影感', '动漫', '写实', '水彩', '3D', '赛博朋克', '古风']
const POSES  = ['', '站立', '行走', '战斗姿态', '坐姿', '跑步', '飞行', '持械', '休闲']
const EXPRESSIONS = ['', '冷峻', '微笑', '愤怒', '悲伤', '惊讶', '坚定', '神秘', '欢乐']

export function CharacterNode({ id, data, selected }: NodeProps) {
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
  const style   = String(d.style ?? '电影感')
  const pose    = String(d.pose ?? '')
  const expr    = String(d.expression ?? '')
  const refs    = (d.reference as string[]) || []
  const seed    = String(d.seed ?? '')
  const url     = String((d.result as Record<string, unknown>)?.url ?? '')
  const renderMode = String(d.render_mode ?? 'comfyui')
  const providerId = String(d.provider_id ?? '')

  const run = () => update(id, { action: 'execute' })

  return (
    <NodeShell id={id} selected={selected} title="角色设计" icon={<User size={15} />}>
      <Field label="角色名">
        <input className={inputCls} value={name} placeholder="如：赛博女战士"
          onChange={(e) => update(id, { name: e.target.value })} />
      </Field>
      <Field label="角色描述">
        <textarea className={inputCls} rows={2} value={desc} placeholder="外貌、性格、服装……"
          onChange={(e) => update(id, { description: e.target.value })} />
      </Field>
      <Field label="提示词">
        <textarea className={inputCls} rows={2} value={prompt} placeholder="AI 出图提示词"
          onChange={(e) => update(id, { prompt: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="风格">
          <select className={inputCls} value={style} onChange={(e) => update(id, { style: e.target.value })}>
            {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="姿态">
          <select className={inputCls} value={pose} onChange={(e) => update(id, { pose: e.target.value })}>
            {POSES.map((p) => <option key={p} value={p}>{p || '未选择'}</option>)}
          </select>
        </Field>
        <Field label="表情">
          <select className={inputCls} value={expr} onChange={(e) => update(id, { expression: e.target.value })}>
            {EXPRESSIONS.map((e) => <option key={e} value={e}>{e || '未选择'}</option>)}
          </select>
        </Field>
        {seed && (
          <div className="col-span-2 rounded bg-soft px-2 py-1 text-[10px] text-ink-3">
            角色种子：{seed}（同一角色复用此种子保持一致性）
          </div>
        )}
      </div>
      {refs.length > 0 && (
        <div className="flex gap-1 overflow-x-auto py-1">
          {refs.map((r, i) => <img key={i} src={r} className="h-12 w-12 rounded-md object-cover" alt="ref" />)}
        </div>
      )}
      {url ? <img className="h-32 w-full rounded-md object-cover" src={url} alt="角色图" />
        : <div className="flex h-20 items-center justify-center rounded-md bg-soft text-[11px] text-ink-3">点击生成获取角色图</div>}
      <GenerationModeField
        mode={renderMode}
        providerId={providerId}
        providers={providers}
        onModeChange={(v) => update(id, { render_mode: v })}
        onProviderChange={(v) => update(id, { provider_id: v })}
      />
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={run}>
        生成角色
      </button>
    </NodeShell>
  )
}
