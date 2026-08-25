import { useEffect, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { ImageIcon } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { getProviders, getRenderers, renderMedia } from '../../api'
import { NodeShell, Field, inputCls } from './NodeShell'
import { GenerationModeField, type ProviderInfo, type RendererInfo } from './GenerationModeField'
import { PromptTranslate } from './PromptTranslate'
import { PromptOptimize } from './PromptOptimize'
import { ResultMedia } from './ResultMedia'
import { emitLog, emitRenderLogs } from '../LogPanel'

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const STYLES = ['电影感', '动漫', '写实', '水彩', '3D', '赛博朋克', '古风']

export function ImageNode({ id, data, selected }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [renderers, setRenderers] = useState<RendererInfo[]>([])

  useEffect(() => {
    getProviders().then((r) => {
      if (r.ok) setProviders((r.data.providers || []).filter((p: { type: string }) => p.type === 'image'))
    })
    getRenderers().then((r) => {
      if (r.ok) setRenderers((r.data.renderers || []).filter((rr: { type: string }) => rr.type === 'comfyui'))
    })
  }, [])

  const prompt  = String(d.prompt ?? '')
  const negative = String(d.negative ?? '')
  const ratio   = String(d.ratio ?? '16:9')
  const style   = String(d.style ?? '电影感')
  const refs    = (d.reference as string[]) || []
  const charIds = (d.character_ids as string[]) || []
  const url     = String(d.url ?? '')
  const renderMode = String(d.render_mode ?? 'comfyui')
  const providerId = String(d.provider_id ?? '')
  const rendererId = String(d.renderer_id ?? '')
  const model    = String(d.model ?? '')

  const run = async () => {
    if (!prompt.trim()) { update(id, { status: 'failed', error: '请先输入提示词' }); return }
    update(id, { status: 'running' })
    emitLog({ nodeId: id, nodeLabel: '图片生成', nodeType: 'image', status: 'running', message: `开始生成 · ${renderMode === 'cloud' ? `云端(${providerId || '未选'})` : 'ComfyUI'}` })
    const t0 = Date.now()
    try {
      const finalPrompt = style && !prompt.includes(style) ? `${style}，${prompt}` : prompt
      const res = await renderMedia({
        kind: 'image',
        render_mode: renderMode,
        provider_id: providerId,
        model,
        renderer_id: rendererId,
        params: { prompt: finalPrompt, negative, ratio },
      })
      const data = res.data as Record<string, unknown> | undefined
      if (res.ok && data?.ok !== false) {
        emitRenderLogs(data?.logs, id, '图片生成', 'image')
        const images = (data?.images as { url?: string }[] | undefined) || []
        const url = images[0]?.url || (data?.url as string) || ''
        update(id, { status: 'completed', url })
        emitLog({ nodeId: id, nodeLabel: '图片生成', nodeType: 'image', status: 'completed', message: '图片生成完成', duration: Date.now() - t0 })
      } else {
        const err = String(data?.error || '生成失败')
        emitRenderLogs(data?.logs, id, '图片生成', 'image')
        update(id, { status: 'failed', error: err })
        emitLog({ nodeId: id, nodeLabel: '图片生成', nodeType: 'image', status: 'failed', message: `生成失败 · ${err.slice(0, 80)}`, detail: err })
      }
    } catch (e) {
      update(id, { status: 'failed', error: String(e) })
      emitLog({ nodeId: id, nodeLabel: '图片生成', nodeType: 'image', status: 'failed', message: `生成失败 · ${String(e).slice(0, 80)}` })
    }
  }

  return (
    <NodeShell id={id} selected={selected} title="图片生成" icon={<ImageIcon size={15} />}>
      <Field label="正向提示词">
        <textarea className={inputCls} rows={2} value={prompt} placeholder="描述画面内容……（原文引用）"
          onChange={(e) => update(id, { prompt: e.target.value })} />
        <PromptTranslate prompt={prompt} />
        <PromptOptimize prompt={prompt} kind="image" model={model} nodeLabel="图片生成"
          onApply={(v) => update(id, { prompt: v })} />
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
      {url ? <ResultMedia url={url} />
        : <div className="flex h-24 items-center justify-center rounded-md bg-soft text-[11px] text-ink-3">点击生成获取图片</div>}
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={run}>
        生成图片
      </button>
    </NodeShell>
  )
}
