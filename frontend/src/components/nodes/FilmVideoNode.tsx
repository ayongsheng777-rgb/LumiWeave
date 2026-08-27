import { useEffect, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { useNodeAdapter } from '../../store/nodeAdapter'
import type { NodeStatus } from '../../store/workflowStore'
import { getModelChoices, renderMedia } from '../../api'
import { VIDEO_PRESETS, videoPreset, matchProvider, buildNative } from '../../data/mediaModels'
import { MediaNodeShell, type LightingState, type LensState } from './media/MediaNodeShell'
import { PromptTranslate } from './PromptTranslate'
import { PromptOptimize } from './PromptOptimize'
import { RefImagePicker } from './RefImagePicker'
import { emitLog, emitRenderLogs } from '../LogPanel'

const DEFAULT_LIGHT: LightingState = { brightness: 50, colorTemp: 5000, direction: 'front' }
const DEFAULT_LENS: LensState = { body: '', lens: '', focal: '', aperture: '' }

export function FilmVideoNode({ id, data, selected }: NodeProps) {
  const { update, getStatus } = useNodeAdapter()
  const d = data as Record<string, unknown>
  const [providers, setProviders] = useState<{ id: string; name: string; models?: string[]; status?: string }[]>([])

  useEffect(() => {
    getModelChoices().then((r) => {
      if (r.ok) setProviders((r.data?.providers || []))
    })
  }, [])

  const prompt     = String(d.prompt ?? '')
  const negative   = String(d.negative ?? '')
  const modelKey   = String(d.model_key ?? 'seedance-2.0')
  const duration   = Number(d.duration ?? 10)
  const resolution = String(d.resolution ?? '720p')
  const ratio      = String(d.ratio ?? '16:9')
  const fps        = Number(d.fps ?? 24)
  const camera     = String(d.camera ?? 'static')
  const light      = (d.light as LightingState) || DEFAULT_LIGHT
  const lens       = (d.lens as LensState) || DEFAULT_LENS
  const imageUrl   = String(d.image_url ?? '')
  const referenceImages = (d.reference_images as string[]) || []
  const videoUrl   = String(d.video_url ?? '')
  const status     = ((d.status as NodeStatus) || getStatus(id) || 'idle') as NodeStatus

  const preset = videoPreset(modelKey) || VIDEO_PRESETS[1]
  const costText = preset.estPerSec ? `≈${preset.estPerSec * duration}点` : ''

  const run = async () => {
    if (!prompt.trim()) { update(id, { status: 'failed', error: '请先输入视频提示词' }); return }
    update(id, { status: 'running', error: '' })
    emitLog({ nodeId: id, nodeLabel: '视频生成', nodeType: 'video', status: 'running', message: `开始生成 · ${preset.name} · ${preset.renderMode === 'cloud' ? '云端' : 'ComfyUI'}` })
    const t0 = Date.now()
    try {
      // 运镜/打光/摄像机 → 提示词 + 模型专属字段(native)
      const { prompt: finalPrompt, native } = buildNative(preset, {
        prompt, camera,
        lightDirection: light.direction, lightBrightness: light.brightness, colorTemp: light.colorTemp,
        lens: lens.lens, focal: lens.focal, aperture: lens.aperture, cameraBody: lens.body,
        resolution, ratio,
      })
      const params: Record<string, unknown> = { prompt: finalPrompt, negative, duration, ratio, fps, native }
      if (imageUrl) params.image_url = imageUrl
      if (referenceImages.length) params.reference_images = referenceImages
      const providerId = matchProvider(preset, providers)
      const res = await renderMedia({
        kind: 'video',
        render_mode: preset.renderMode,
        provider_id: providerId,
        model: preset.modelId,
        renderer_id: String(d.renderer_id ?? ''),
        params,
      })
      const rdata = res.data as Record<string, unknown> | undefined
      if (res.ok && rdata?.ok !== false) {
        emitRenderLogs(rdata?.logs, id, '视频生成', 'video')
        const videos = (rdata?.videos as { url?: string }[] | undefined) || []
        const url = videos[0]?.url || (rdata?.url as string) || (rdata?.video_url as string) || ''
        update(id, { status: 'completed', video_url: url })
        emitLog({ nodeId: id, nodeLabel: '视频生成', nodeType: 'video', status: 'completed', message: '视频生成完成', duration: Date.now() - t0 })
      } else {
        const err = String(rdata?.error || '生成失败')
        emitRenderLogs(rdata?.logs, id, '视频生成', 'video')
        update(id, { status: 'failed', error: err })
        emitLog({ nodeId: id, nodeLabel: '视频生成', nodeType: 'video', status: 'failed', message: `生成失败 · ${err.slice(0, 80)}`, detail: err })
      }
    } catch (e) {
      update(id, { status: 'failed', error: String(e) })
      emitLog({ nodeId: id, nodeLabel: '视频生成', nodeType: 'video', status: 'failed', message: `生成失败 · ${String(e).slice(0, 80)}` })
    }
  }

  const onChange = (patch: Record<string, unknown>) => update(id, patch)

  const promptPanel = (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-2">视频提示词</div>
      <textarea
        rows={3}
        className="nodrag nowheel w-full rounded-lg border border-edge bg-input px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
        value={prompt}
        placeholder="描述视频动作/运镜……"
        onChange={(e) => update(id, { prompt: e.target.value })}
      />
      <PromptTranslate prompt={prompt} />
      <PromptOptimize prompt={prompt} kind="video" model={preset.modelId} nodeLabel="视频生成" onApply={(v) => update(id, { prompt: v })} />
      <div className="mt-2 text-[11px] text-ink-2">首帧图（首帧生视频，可选）</div>
      <RefImagePicker value={imageUrl ? [imageUrl] : []} multiple={false} excludeId={id} onChange={(urls) => update(id, { image_url: urls[0] || '' })} />
      <div className="mt-2 text-[11px] text-ink-2">参考图（角色+场景+道具，多选，多参考生视频）</div>
      <RefImagePicker value={referenceImages} multiple excludeId={id} onChange={(urls) => update(id, { reference_images: urls })} />
    </div>
  )

  return (
    <MediaNodeShell
      id={id} selected={selected} kind="video" status={status} url={videoUrl}
      error={String(d.error ?? '')}
      presets={VIDEO_PRESETS} modelKey={modelKey}
      durations={preset.durations || [10]} resolutions={preset.resolutions || ['720p']} ratios={preset.ratios}
      durationValue={duration} resolutionValue={resolution} ratioValue={ratio}
      camera={camera} light={light} lens={lens} costText={costText}
      promptPreview={prompt} promptPanel={promptPanel}
      onChange={onChange} onGenerate={run}
    />
  )
}
