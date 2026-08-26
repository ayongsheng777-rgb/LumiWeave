import { useEffect, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { useNodeAdapter } from '../../store/nodeAdapter'
import type { NodeStatus } from '../../store/workflowStore'
import { getProviders, renderMedia } from '../../api'
import { IMAGE_PRESETS, imagePreset, matchProvider, buildNative } from '../../data/mediaModels'
import { MediaNodeShell, type LightingState, type LensState } from './media/MediaNodeShell'
import { PromptTranslate } from './PromptTranslate'
import { PromptOptimize } from './PromptOptimize'
import { emitLog, emitRenderLogs } from '../LogPanel'

const DEFAULT_LIGHT: LightingState = { brightness: 50, colorTemp: 5000, direction: 'front' }
const DEFAULT_LENS: LensState = { body: '', lens: '', focal: '', aperture: '' }

export function ImageNode({ id, data, selected }: NodeProps) {
  const { update, getStatus } = useNodeAdapter()
  const d = data as Record<string, unknown>
  const [providers, setProviders] = useState<{ id: string; name: string; type: string; endpoint: string }[]>([])

  useEffect(() => {
    getProviders().then((r) => {
      if (r.ok) setProviders((r.data.providers || []).filter((p: { type: string }) => p.type === 'image'))
    })
  }, [])

  const prompt     = String(d.prompt ?? '')
  const negative   = String(d.negative ?? '')
  const modelKey   = String(d.model_key ?? 'flux-dev')
  const resolution = String(d.resolution ?? '1K')
  const ratio      = String(d.ratio ?? '16:9')
  const light      = (d.light as LightingState) || DEFAULT_LIGHT
  const lens       = (d.lens as LensState) || DEFAULT_LENS
  const url        = String(d.url ?? '')
  const status     = ((d.status as NodeStatus) || getStatus(id) || 'idle') as NodeStatus

  const preset = imagePreset(modelKey) || IMAGE_PRESETS[0]
  const costText = preset.estPerImage ? `≈${preset.estPerImage}点` : ''

  const run = async () => {
    if (!prompt.trim()) { update(id, { status: 'failed', error: '请先输入图片提示词' }); return }
    update(id, { status: 'running', error: '' })
    emitLog({ nodeId: id, nodeLabel: '图片生成', nodeType: 'image', status: 'running', message: `开始生成 · ${preset.name} · ${preset.renderMode === 'cloud' ? '云端' : 'ComfyUI'}` })
    const t0 = Date.now()
    try {
      const { prompt: finalPrompt, native } = buildNative(preset, {
        prompt,
        lightDirection: light.direction, lightBrightness: light.brightness, colorTemp: light.colorTemp,
        lens: lens.lens, focal: lens.focal, aperture: lens.aperture, cameraBody: lens.body,
        resolution, ratio,
      })
      const params: Record<string, unknown> = { prompt: finalPrompt, negative, ratio, native }
      const providerId = matchProvider(preset, providers)
      const res = await renderMedia({
        kind: 'image',
        render_mode: preset.renderMode,
        provider_id: providerId,
        model: preset.modelId,
        renderer_id: String(d.renderer_id ?? ''),
        params,
      })
      const rdata = res.data as Record<string, unknown> | undefined
      if (res.ok && rdata?.ok !== false) {
        emitRenderLogs(rdata?.logs, id, '图片生成', 'image')
        const images = (rdata?.images as { url?: string }[] | undefined) || []
        const u = images[0]?.url || (rdata?.url as string) || ''
        update(id, { status: 'completed', url: u })
        emitLog({ nodeId: id, nodeLabel: '图片生成', nodeType: 'image', status: 'completed', message: '图片生成完成', duration: Date.now() - t0 })
      } else {
        const err = String(rdata?.error || '生成失败')
        emitRenderLogs(rdata?.logs, id, '图片生成', 'image')
        update(id, { status: 'failed', error: err })
        emitLog({ nodeId: id, nodeLabel: '图片生成', nodeType: 'image', status: 'failed', message: `生成失败 · ${err.slice(0, 80)}`, detail: err })
      }
    } catch (e) {
      update(id, { status: 'failed', error: String(e) })
      emitLog({ nodeId: id, nodeLabel: '图片生成', nodeType: 'image', status: 'failed', message: `生成失败 · ${String(e).slice(0, 80)}` })
    }
  }

  const onChange = (patch: Record<string, unknown>) => update(id, patch)

  const promptPanel = (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-2">图片提示词</div>
      <textarea
        rows={3}
        className="nodrag nowheel w-full rounded-lg border border-edge bg-input px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
        value={prompt}
        placeholder="描述画面内容……"
        onChange={(e) => update(id, { prompt: e.target.value })}
      />
      <PromptTranslate prompt={prompt} />
      <PromptOptimize prompt={prompt} kind="image" model={preset.modelId} nodeLabel="图片生成" onApply={(v) => update(id, { prompt: v })} />
    </div>
  )

  return (
    <MediaNodeShell
      id={id} selected={selected} kind="image" status={status} url={url}
      error={String(d.error ?? '')}
      presets={IMAGE_PRESETS} modelKey={modelKey}
      resolutions={preset.resolutions || ['1K']} ratios={preset.ratios}
      durationValue={0} resolutionValue={resolution} ratioValue={ratio}
      camera="static" light={light} lens={lens} costText={costText}
      promptPreview={prompt} promptPanel={promptPanel}
      onChange={onChange} onGenerate={run}
    />
  )
}
