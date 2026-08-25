import { useEffect, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Mountain } from 'lucide-react'
import { useNodeAdapter } from '../../store/nodeAdapter'
import { getProviders, getRenderers, filmSceneGenerate } from '../../api'
import { cameraLabel } from '../../cameraLabels'
import { NodeShell, Field, inputCls } from './NodeShell'
import { GenerationModeField, type ProviderInfo, type RendererInfo } from './GenerationModeField'
import { PromptOptimize } from './PromptOptimize'
import { ResultMedia } from './ResultMedia'
import { emitLog, emitRenderLogs } from '../LogPanel'

const LOCATIONS = ['城市', '森林', '空间站', '房间', '战场', '幻想世界', '海边', '沙漠', '雪地', '废弃工厂', '自定义']
const TIMES     = ['白天', '黄昏', '夜晚', '黎明', '深夜']
const WEATHERS  = ['晴', '雨', '雪', '雾', '风', '雷暴', '多云']
const CAMERAS   = ['wide shot', 'medium shot', 'close-up', 'birds-eye view', 'worm-eye view', 'dolly in', 'dolly out', 'pan left', 'pan right', 'tracking shot']
const STYLES    = ['电影感', '动漫', '写实', '水彩', '3D', '赛博朋克', '蒸汽朋克', '古风']

export function SceneNode({ id, data, selected }: NodeProps) {
  const { update } = useNodeAdapter()
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

  const name    = String(d.name ?? '')
  const loc     = String(d.location ?? '')
  const time    = String(d.time ?? '白天')
  const weather = String(d.weather ?? '晴')
  const camera  = String(d.camera ?? 'wide shot')
  const desc    = String(d.description ?? '')
  const style   = String(d.style ?? '电影感')
  const refs    = (d.reference as string[]) || []
  const url     = String((d.result as Record<string, unknown>)?.url ?? '')
  const renderMode = String(d.render_mode ?? 'comfyui')
  const providerId = String(d.provider_id ?? '')
  const rendererId = String(d.renderer_id ?? '')
  const model    = String(d.model ?? '')

  const run = async () => {
    if (!loc.trim() && !desc.trim()) { update(id, { status: 'failed', error: '请先输入地点或场景描述' }); return }
    update(id, { status: 'running' })
    emitLog({ nodeId: id, nodeLabel: '场景设计', nodeType: 'scene', status: 'running', message: `开始生成 · ${renderMode === 'cloud' ? `云端(${providerId || '未选'})` : 'ComfyUI'}` })
    const t0 = Date.now()
    try {
      const res = await filmSceneGenerate({
        name, location: loc, time, weather, camera, description: desc, style, reference_urls: refs,
        render_mode: renderMode, provider_id: providerId, model, renderer_id: rendererId,
      })
      const data = res as unknown as { ok?: boolean; error?: string; data?: Record<string, unknown> }
      if (data.ok !== false && data.data) {
        emitRenderLogs((data.data.logs as unknown[]) || [], id, '场景设计', 'scene')
        update(id, { status: 'completed', result: data.data })
        emitLog({ nodeId: id, nodeLabel: '场景设计', nodeType: 'scene', status: 'completed', message: '场景图生成完成', duration: Date.now() - t0 })
      } else {
        const err = String(data.error || '生成失败')
        emitRenderLogs((data.data as Record<string, unknown> | undefined)?.logs, id, '场景设计', 'scene')
        update(id, { status: 'failed', error: err })
        emitLog({ nodeId: id, nodeLabel: '场景设计', nodeType: 'scene', status: 'failed', message: `生成失败 · ${err.slice(0, 80)}`, detail: err })
      }
    } catch (e) {
      update(id, { status: 'failed', error: String(e) })
      emitLog({ nodeId: id, nodeLabel: '场景设计', nodeType: 'scene', status: 'failed', message: `生成失败 · ${String(e).slice(0, 80)}` })
    }
  }

  return (
    <NodeShell id={id} selected={selected} title="场景设计" icon={<Mountain size={15} />}>
      <Field label="场景名">
        <input className={inputCls} value={name} placeholder="如：未来都市夜景"
          onChange={(e) => update(id, { name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="地点">
          <select className={inputCls} value={loc} onChange={(e) => update(id, { location: e.target.value })}>
            {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="时间">
          <select className={inputCls} value={time} onChange={(e) => update(id, { time: e.target.value })}>
            {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="天气">
          <select className={inputCls} value={weather} onChange={(e) => update(id, { weather: e.target.value })}>
            {WEATHERS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </Field>
        <Field label="镜头">
          <select className={inputCls} value={camera} onChange={(e) => update(id, { camera: e.target.value })}>
            {CAMERAS.map((c) => <option key={c} value={c}>{cameraLabel(c)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="场景描述">
        <textarea className={inputCls} rows={2} value={desc} placeholder="补充场景细节……"
          onChange={(e) => update(id, { description: e.target.value })} />
        <PromptOptimize prompt={desc} kind="image" model={model} nodeLabel="场景设计"
          onApply={(v) => update(id, { description: v })} />
      </Field>
      <Field label="风格">
        <select className={inputCls} value={style} onChange={(e) => update(id, { style: e.target.value })}>
          {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      {refs.length > 0 && (
        <div className="flex gap-1 overflow-x-auto py-1">
          {refs.map((r, i) => <img key={i} src={r} className="h-12 w-12 rounded-md object-cover" alt="ref" />)}
        </div>
      )}
      {url ? <ResultMedia url={url} />
        : <div className="flex h-20 items-center justify-center rounded-md bg-soft text-[11px] text-ink-3">点击生成获取场景图</div>}
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
        生成场景
      </button>
    </NodeShell>
  )
}
