import { useEffect, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Package } from 'lucide-react'
import { useNodeAdapter } from '../../store/nodeAdapter'
import { getModelChoices, getRenderers, renderMedia } from '../../api'
import { NodeShell, Field, inputCls } from './NodeShell'
import { GenerationModeField, type ProviderInfo, type RendererInfo } from './GenerationModeField'
import { PromptTranslate } from './PromptTranslate'
import { PromptOptimize } from './PromptOptimize'
import { ResultMedia } from './ResultMedia'
import { emitLog, emitRenderLogs } from '../LogPanel'

const BIND_TYPES = ['', 'character', 'scene']
const BACKGROUNDS = ['有背景', '无背景']
const VIEWS = ['单视角', '三视图', '四视图']
const VIEW_PROMPT: Record<string, string> = {
  '三视图': 'prop turnaround sheet, front view, side view, top view, three-view reference',
  '四视图': 'prop turnaround sheet, front view, side view, back view, top view, four-view reference',
}

export function PropNode({ id, data, selected }: NodeProps) {
  const { update } = useNodeAdapter()
  const d = data as Record<string, unknown>
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [renderers, setRenderers] = useState<RendererInfo[]>([])

  useEffect(() => {
    getModelChoices('image').then((r) => {
      if (r.ok) setProviders((r.data?.providers || []))
    })
    getRenderers().then((r) => {
      if (r.ok) setRenderers((r.data.renderers || []).filter((rr: { type: string }) => rr.type === 'comfyui'))
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
  const rendererId = String(d.renderer_id ?? '')
  const model    = String(d.model ?? '')
  const background = String(d.background ?? '有背景')
  const views      = String(d.views ?? '单视角')

  const run = async () => {
    const suffix = [
      background === '无背景' ? 'isolated on plain white background, no background, studio lighting' : '',
      VIEW_PROMPT[views] || '',
    ].filter(Boolean).join(', ')
    const base = prompt || `${name} ${desc}`.trim()
    const fullPrompt = [base, suffix].filter(Boolean).join(', ')
    if (!base) { update(id, { status: 'failed', error: '请先输入道具名或提示词' }); return }
    update(id, { status: 'running' })
    emitLog({ nodeId: id, nodeLabel: '关键道具', nodeType: 'prop', status: 'running', message: `开始生成 · ${renderMode === 'cloud' ? `云端(${providerId || '未选'})` : 'ComfyUI'}` })
    const t0 = Date.now()
    try {
      const res = await renderMedia({
        kind: 'image',
        render_mode: renderMode,
        provider_id: providerId,
        model,
        renderer_id: rendererId,
        params: { prompt: fullPrompt },
      })
      const data = res.data as Record<string, unknown> | undefined
      if (res.ok && data?.ok !== false) {
        emitRenderLogs(data?.logs, id, '关键道具', 'prop')
        const images = (data?.images as { url?: string }[] | undefined) || []
        const url = images[0]?.url || (data?.url as string) || ''
        update(id, { status: 'completed', result: { url, prompt: fullPrompt } })
        emitLog({ nodeId: id, nodeLabel: '关键道具', nodeType: 'prop', status: 'completed', message: '道具图生成完成', duration: Date.now() - t0 })
      } else {
        const err = String(data?.error || '生成失败')
        emitRenderLogs(data?.logs, id, '关键道具', 'prop')
        update(id, { status: 'failed', error: err })
        emitLog({ nodeId: id, nodeLabel: '关键道具', nodeType: 'prop', status: 'failed', message: `生成失败 · ${err.slice(0, 80)}`, detail: err })
      }
    } catch (e) {
      update(id, { status: 'failed', error: String(e) })
      emitLog({ nodeId: id, nodeLabel: '关键道具', nodeType: 'prop', status: 'failed', message: `生成失败 · ${String(e).slice(0, 80)}` })
    }
  }

  return (
    <NodeShell id={id} selected={selected} title="关键道具" icon={<Package size={15} />} resultView={url ? <ResultMedia url={url} /> : undefined}>
      <Field label="道具名">
        <input className={inputCls} value={name} placeholder="如：能源核心、未来武器"
          onChange={(e) => update(id, { name: e.target.value })} />
      </Field>
      <Field label="描述">
        <textarea className={inputCls} rows={2} value={desc} placeholder="道具外观、功能……"
          onChange={(e) => update(id, { description: e.target.value })} />
      </Field>
      <Field label="提示词">
        <textarea className={inputCls} rows={2} value={prompt} placeholder="AI 出图提示词（原文引用）"
          onChange={(e) => update(id, { prompt: e.target.value })} />
        <PromptTranslate prompt={prompt || `${name} ${desc}`} />
        <PromptOptimize prompt={prompt || `${name} ${desc}`} kind="image" model={model} nodeLabel="关键道具"
          onApply={(v) => update(id, { prompt: v })} />
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
        <Field label="背景">
          <select className={inputCls} value={background} onChange={(e) => update(id, { background: e.target.value })}>
            {BACKGROUNDS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="视角">
          <select className={inputCls} value={views} onChange={(e) => update(id, { views: e.target.value })}>
            {VIEWS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
      </div>
      {refs.length > 0 && (
        <div className="flex gap-1 overflow-x-auto py-1">
          {refs.map((r, i) => <img key={i} src={r} className="h-12 w-12 rounded-md object-cover" alt="ref" />)}
        </div>
      )}
      {url ? <ResultMedia url={url} />
        : <div className="flex h-16 items-center justify-center rounded-md bg-soft text-[11px] text-ink-3">点击生成获取道具图</div>}
      <GenerationModeField
        mode={renderMode}
        providerId={providerId}
        providers={providers}
        rendererId={rendererId}
        renderers={renderers}
        model={model}
        onModeChange={(v) => update(id, { render_mode: v })}
        onProviderChange={(v) => update(id, { provider_id: v })}
        onRendererChange={(v) => update(id, { renderer_id: v })}
        onModelChange={(v) => update(id, { model: v })}
      />
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={run}>
        生成道具
      </button>
    </NodeShell>
  )
}
