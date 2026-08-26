import { useEffect, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Film } from 'lucide-react'
import { useNodeAdapter } from '../../store/nodeAdapter'
import { getProviders, getRenderers, renderMedia } from '../../api'
import { cameraLabel } from '../../cameraLabels'
import { NodeShell, Field, inputCls } from './NodeShell'
import { GenerationModeField, type ProviderInfo, type RendererInfo } from './GenerationModeField'
import { PromptTranslate } from './PromptTranslate'
import { PromptOptimize } from './PromptOptimize'
import { ResultMedia } from './ResultMedia'
import { RefImagePicker } from './RefImagePicker'
import { emitLog, emitRenderLogs } from '../LogPanel'

const CAMERAS  = ['static', 'slow push-in', 'pan-left', 'pan-right', 'handheld', 'orbit', 'zoom-in', 'dolly', 'tracking']
const RATIOS   = ['16:9', '9:16', '1:1', '4:3']
const STYLES   = ['电影感', '动漫', '写实', '3D']
const VIDEO_MODES = [
  { value: 'text2video', label: '文生视频' },
  { value: 'image2video', label: '首帧生视频' },
  { value: 'multi_ref', label: '多参考生视频' },
]

export function FilmVideoNode({ id, data, selected }: NodeProps) {
  const { update } = useNodeAdapter()
  const d = data as Record<string, unknown>
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [renderers, setRenderers] = useState<RendererInfo[]>([])

  useEffect(() => {
    getProviders().then((r) => {
      if (r.ok) setProviders((r.data.providers || []).filter((p: { type: string }) => p.type === 'video'))
    })
    getRenderers().then((r) => {
      if (r.ok) setRenderers((r.data.renderers || []).filter((rr: { type: string }) => rr.type === 'comfyui'))
    })
  }, [])

  const prompt     = String(d.prompt ?? '')
  const camera     = String(d.camera ?? 'static')
  const duration   = Number(d.duration ?? 10)
  const fps        = Number(d.fps ?? 24)
  const ratio      = String(d.ratio ?? '16:9')
  const style      = String(d.style ?? '电影感')
  const images     = (d.images as string[]) || []
  const videoUrl   = String(d.video_url ?? '')
  const renderMode = String(d.render_mode ?? 'comfyui')
  const providerId = String(d.provider_id ?? '')
  const rendererId = String(d.renderer_id ?? '')
  const model      = String(d.model ?? '')
  const videoMode  = String(d.video_mode ?? 'text2video')
  const imageUrl   = String(d.image_url ?? '')
  const referenceImages = (d.reference_images as string[]) || []

  const run = async () => {
    if (!prompt.trim()) { update(id, { status: 'failed', error: '请先输入视频提示词' }); return }
    if (videoMode === 'image2video' && !imageUrl) { update(id, { status: 'failed', error: '首帧生视频需要选一张首帧图' }); return }
    if (videoMode === 'multi_ref' && referenceImages.length === 0) { update(id, { status: 'failed', error: '多参考生视频需要选参考图' }); return }
    update(id, { status: 'running' })
    emitLog({ nodeId: id, nodeLabel: '视频生成', nodeType: 'video', status: 'running', message: `开始生成 · ${videoMode === 'multi_ref' ? '多参考' : videoMode === 'image2video' ? '首帧' : '文生'} · ${renderMode === 'cloud' ? `云端(${providerId || '未选'})` : 'ComfyUI'}` })
    const t0 = Date.now()
    try {
      const finalPrompt = [style, `运镜:${camera}`, prompt].filter(Boolean).join('，')
      const params: Record<string, unknown> = { prompt: finalPrompt, duration, ratio, fps }
      if (videoMode === 'image2video' && imageUrl) params.image_url = imageUrl
      if (videoMode === 'multi_ref' && referenceImages.length) params.reference_images = referenceImages
      const res = await renderMedia({
        kind: 'video',
        render_mode: renderMode,
        provider_id: providerId,
        model,
        renderer_id: rendererId,
        params,
      })
      const data = res.data as Record<string, unknown> | undefined
      if (res.ok && data?.ok !== false) {
        emitRenderLogs(data?.logs, id, '视频生成', 'video')
        const videos = (data?.videos as { url?: string }[] | undefined) || []
        const url = videos[0]?.url || (data?.url as string) || (data?.video_url as string) || ''
        update(id, { status: 'completed', video_url: url })
        emitLog({ nodeId: id, nodeLabel: '视频生成', nodeType: 'video', status: 'completed', message: '视频生成完成', duration: Date.now() - t0 })
      } else {
        const err = String(data?.error || '生成失败')
        emitRenderLogs(data?.logs, id, '视频生成', 'video')
        update(id, { status: 'failed', error: err })
        emitLog({ nodeId: id, nodeLabel: '视频生成', nodeType: 'video', status: 'failed', message: `生成失败 · ${err.slice(0, 80)}`, detail: err })
      }
    } catch (e) {
      update(id, { status: 'failed', error: String(e) })
      emitLog({ nodeId: id, nodeLabel: '视频生成', nodeType: 'video', status: 'failed', message: `生成失败 · ${String(e).slice(0, 80)}` })
    }
  }

  return (
    <NodeShell id={id} selected={selected} title="视频生成" icon={<Film size={15} />} resultView={videoUrl ? <ResultMedia url={videoUrl} type="video" /> : undefined}>
      <Field label="视频提示词">
        <textarea className={inputCls} rows={2} value={prompt} placeholder="描述视频动作/运镜……（原文引用）"
          onChange={(e) => update(id, { prompt: e.target.value })} />
        <PromptTranslate prompt={prompt} />
        <PromptOptimize prompt={prompt} kind="video" model={model} nodeLabel="视频生成"
          onApply={(v) => update(id, { prompt: v })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="运镜">
          <select className={inputCls} value={camera} onChange={(e) => update(id, { camera: e.target.value })}>
            {CAMERAS.map((c) => <option key={c} value={c}>{cameraLabel(c)}</option>)}
            {!CAMERAS.includes(camera) && camera && <option value={camera}>{camera}</option>}
          </select>
        </Field>
        <Field label="比例">
          <select className={inputCls} value={ratio} onChange={(e) => update(id, { ratio: e.target.value })}>
            {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="时长(秒)">
          <input className={inputCls} type="number" min={3} max={60} value={duration}
            onChange={(e) => update(id, { duration: Number(e.target.value) })} />
        </Field>
        <Field label="帧率">
          <input className={inputCls} type="number" min={12} max={60} value={fps}
            onChange={(e) => update(id, { fps: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="风格">
        <select className={inputCls} value={style} onChange={(e) => update(id, { style: e.target.value })}>
          {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="生视频模式">
        <select className={inputCls} value={videoMode} onChange={(e) => update(id, { video_mode: e.target.value })}>
          {VIDEO_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </Field>
      {videoMode === 'image2video' && (
        <Field label="首帧图（选一张）">
          <RefImagePicker value={imageUrl ? [imageUrl] : []} multiple={false} excludeId={id}
            onChange={(urls) => update(id, { image_url: urls[0] || '' })} />
        </Field>
      )}
      {videoMode === 'multi_ref' && (
        <Field label="参考图（角色+场景+道具，多选）">
          <RefImagePicker value={referenceImages} multiple excludeId={id}
            onChange={(urls) => update(id, { reference_images: urls })} />
        </Field>
      )}
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
      {images.length > 0 && (
        <div className="flex gap-1 overflow-x-auto py-1">
          {images.map((img, i) => <img key={i} src={img} className="h-12 w-20 rounded-md object-cover" alt={`img-${i}`} />)}
        </div>
      )}
      {videoUrl
        ? <ResultMedia url={videoUrl} type="video" />
        : <div className="flex h-24 items-center justify-center rounded-md bg-soft text-[11px] text-ink-3">点击生成获取视频</div>}
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={run}>
        生成视频
      </button>
    </NodeShell>
  )
}
