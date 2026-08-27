/** ShotGenerator — 单个分镜（shot）的生成组件
 * 内嵌在 StoryboardNode / StoryboardNodeCanvas 每个 shot 里。
 * 生成方式配置（ComfyUI 局域网 / 云端 API + provider + 模型 + 渲染器）、
 * 提示词中英互译、提示词优化、结果自适应展示，均与角色设计节点保持一致。
 * 生成走统一 renderMedia 入口，写入任务化运行日志 + 通知左侧分镜链信息框。
 */
import { useState, useEffect } from 'react'
import { Wand2, ChevronDown, ChevronUp, Loader2, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'
import { getModelChoices, getRenderers, renderMedia } from '../../api'
import { cameraLabel } from '../../cameraLabels'
import { emitLog, emitRenderLogs } from '../LogPanel'
import { notifyShotChain } from '../ShotChainPanel'
import { GenerationModeField, type ProviderInfo, type RendererInfo } from './GenerationModeField'
import { PromptTranslate } from './PromptTranslate'
import { PromptOptimize } from './PromptOptimize'
import { ResultMedia } from './ResultMedia'
import { RefImagePicker } from './RefImagePicker'

export interface Shot {
  shot: number
  camera: string
  duration: number
  description: string
  prompt: string
  prompt_zh?: string       // 兼容旧字段（已改用 PromptTranslate 双向展示）
  generated_url?: string   // 生成结果 URL
  generated_type?: 'image' | 'video'
  output_type?: 'image' | 'video'   // 输出类型：图片 / 视频
  video_mode?: 'text2video' | 'image2video' | 'multi_ref'
  image_url?: string        // 首帧图
  reference_images?: string[]  // 多参考图
  render_mode?: 'comfyui' | 'cloud'
  renderer_id?: string
  provider_id?: string
  model?: string
  // 兼容旧字段
  renderer_type?: 'comfyui' | 'cloud_api'
  gen_status?: 'idle' | 'generating' | 'done' | 'error'
  gen_error?: string
}

const VIDEO_MODES = [
  { value: 'text2video', label: '文生视频' },
  { value: 'image2video', label: '首帧生视频' },
  { value: 'multi_ref', label: '多参考生视频' },
]

interface ShotGeneratorProps {
  shot: Shot
  index: number          // 0-based
  totalShots: number
  nodeId: string
  nodeLabel: string
  onUpdate: (patch: Partial<Shot>) => void
  /** 自动生成信号：>0 时触发一次生成（用于「下一分镜」跳转自动生成） */
  autoGenSignal?: number
}

export function ShotGenerator({ shot, index, totalShots, nodeId, nodeLabel, onUpdate, autoGenSignal }: ShotGeneratorProps) {
  const [imageProviders, setImageProviders] = useState<ProviderInfo[]>([])
  const [videoProviders, setVideoProviders] = useState<ProviderInfo[]>([])
  const [renderers, setRenderers] = useState<RendererInfo[]>([])
  const [genMode, setGenMode] = useState<'comfyui' | 'cloud'>(
    shot.render_mode === 'cloud' || shot.renderer_type === 'cloud_api' ? 'cloud' : 'comfyui',
  )
  const [providerId, setProviderId] = useState(shot.provider_id || '')
  const [model, setModel] = useState(shot.model || '')
  const [selectedRenderer, setSelectedRenderer] = useState(shot.renderer_id || '')
  const [expanded, setExpanded] = useState(true)
  const [genning, setGenning] = useState(false)
  const [genError, setGenError] = useState('')

  const outputType: 'image' | 'video' = shot.output_type || 'image'
  const videoMode: 'text2video' | 'image2video' | 'multi_ref' = shot.video_mode || 'text2video'
  const activeProviders = outputType === 'video' ? videoProviders : imageProviders

  useEffect(() => {
    getModelChoices().then((res) => {
      if (res.ok) {
        const all = (res.data.providers || []) as (ProviderInfo & { type?: string })[]
        setImageProviders(all.filter((p) => p.type === 'image'))
        setVideoProviders(all.filter((p) => p.type === 'video'))
      }
    }).catch(() => {/* ignore */})
    getRenderers().then((res) => {
      if (res.ok) setRenderers((res.data.renderers || []).filter((r: { type: string }) => r.type === 'comfyui'))
    }).catch(() => {/* ignore */})
  }, [])

  // 自动生成信号触发
  useEffect(() => {
    if (autoGenSignal && autoGenSignal > 0 && !genning && shot.prompt.trim()) {
      setExpanded(true)
      doGenerate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenSignal])

  const doGenerate = async () => {
    if (!shot.prompt.trim()) { setGenError('提示词不能为空'); return }

    // 云端模式需要 provider，ComfyUI 模式需要渲染器
    if (genMode === 'cloud' && !providerId) {
      setGenError('请先在「生成方式」里选择一个云端接口')
      return
    }
    const rid = selectedRenderer || renderers[0]?.id || ''
    if (genMode === 'comfyui' && !rid) {
      setGenError('请先在「设置-出图配置」里配置并启用一个 ComfyUI 渲染器')
      return
    }
    if (outputType === 'video' && videoMode === 'image2video' && !shot.image_url) {
      setGenError('首帧生视频需要选一张首帧图')
      return
    }
    if (outputType === 'video' && videoMode === 'multi_ref' && !(shot.reference_images?.length)) {
      setGenError('多参考生视频需要选参考图')
      return
    }

    setGenning(true)
    setGenError('')
    onUpdate({ gen_status: 'generating', render_mode: genMode, provider_id: providerId, model, renderer_id: rid })
    const t0 = Date.now()
    emitLog({
      nodeId, nodeLabel, nodeType: 'storyboard', status: 'running',
      message: `分镜 ${shot.shot} 生成中 · ${genMode === 'cloud' ? `云端(${providerId || '未选'})` : 'ComfyUI'}`,
    })

    try {
      const params: Record<string, unknown> = {
        prompt: shot.prompt,
        negative: '',
        ratio: shot.duration >= 5 ? '16:9' : '1:1',
      }
      if (outputType === 'video') {
        params.duration = shot.duration
        if (videoMode === 'image2video' && shot.image_url) params.image_url = shot.image_url
        if (videoMode === 'multi_ref' && shot.reference_images?.length) params.reference_images = shot.reference_images
      }
      const res = await renderMedia({
        kind: outputType === 'video' ? 'video' : 'image',
        render_mode: genMode,
        provider_id: providerId,
        model,
        renderer_id: rid,
        params,
      })

      const data = res.data as Record<string, unknown> | undefined
      const ok = res.ok && data?.ok !== false
      if (ok) {
        emitRenderLogs(data?.logs, nodeId, nodeLabel, 'storyboard')
        const images = (data?.images as { url?: string }[] | undefined) || []
        const videos = (data?.videos as { url?: string }[] | undefined) || []
        const url = videos[0]?.url || images[0]?.url || (data?.url as string) || ''
        const type: 'image' | 'video' = videos.length > 0 ? 'video' : 'image'
        onUpdate({ generated_url: url, generated_type: type, gen_status: 'done' })
        emitLog({ nodeId, nodeLabel, nodeType: 'storyboard', status: 'completed', message: `分镜 ${shot.shot} 生成完成 · ${type === 'video' ? '视频' : '图片'}`, duration: Date.now() - t0 })
        notifyShotChain({
          nodeId,
          nodeLabel,
          shotIndex: index,
          shotNumber: shot.shot,
          totalShots,
          lastFrameUrl: url,
          isVideo: type === 'video',
          nextShotNumber: index + 1 < totalShots ? shot.shot + 1 : undefined,
        })
      } else {
        const err = String(data?.error || '生成失败')
        emitRenderLogs(data?.logs, nodeId, nodeLabel, 'storyboard')
        setGenError(err)
        onUpdate({ gen_status: 'error', gen_error: err })
        emitLog({ nodeId, nodeLabel, nodeType: 'storyboard', status: 'failed', message: `分镜 ${shot.shot} 失败 · ${err.slice(0, 60)}`, detail: err })
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : '网络错误'
      setGenError(err)
      onUpdate({ gen_status: 'error', gen_error: err })
      emitLog({ nodeId, nodeLabel, nodeType: 'storyboard', status: 'failed', message: `分镜 ${shot.shot} 失败 · ${err.slice(0, 60)}`, detail: err })
    } finally {
      setGenning(false)
    }
  }

  const StatusIcon = () => {
    if (shot.gen_status === 'generating') return <Loader2 size={13} className="animate-spin text-blue-400" />
    if (shot.gen_status === 'done') return <CheckCircle2 size={13} className="text-green-400" />
    if (shot.gen_status === 'error') return <AlertCircle size={13} className="text-red-400" />
    return null
  }

  return (
    <div className="rounded-md border border-edge bg-panel-1">
      {/* 分镜折叠开关 */}
      <button
        className="nodrag flex w-full items-center justify-between px-3 py-2 text-left hover:bg-soft/50"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-brand-400">SHOT {String(shot.shot).padStart(2, '0')}</span>
          <span className="text-[10px] text-ink-3">{cameraLabel(shot.camera)} · {shot.duration}s</span>
        </div>
        <div className="flex items-center gap-2">
          {shot.gen_status && shot.gen_status !== 'idle' && <StatusIcon />}
          {shot.generated_url && (
            <span className="text-[10px] text-green-400">{shot.generated_type === 'video' ? '视频' : '图片'}</span>
          )}
          {expanded ? <ChevronUp size={12} className="text-ink-3" /> : <ChevronDown size={12} className="text-ink-3" />}
        </div>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="border-t border-edge px-3 pb-3 pt-2">
          <textarea
            className="nodrag mb-2 w-full rounded-md border border-edge bg-input px-2 py-1.5 text-[11px] text-ink outline-none focus:border-brand-500"
            rows={2}
            value={shot.description}
            placeholder="镜头描述（动作/情节）"
            onChange={(e) => onUpdate({ description: e.target.value })}
          />

          {/* 提示词 + 中英互译 + 优化 */}
          <div className="mb-2">
            <textarea
              className="nodrag w-full rounded-md border border-edge bg-input px-2 py-1.5 text-[11px] text-ink outline-none focus:border-brand-500"
              rows={2}
              value={shot.prompt}
              placeholder="AI 绘图提示词（原文引用）"
              onChange={(e) => onUpdate({ prompt: e.target.value })}
            />
            <PromptTranslate prompt={shot.prompt} />
            <PromptOptimize prompt={shot.prompt} kind="image" model={model} nodeLabel={`分镜 ${shot.shot}`}
              onApply={(v) => onUpdate({ prompt: v })} />
          </div>

          {/* 输出类型 + 生视频模式 */}
          <div className="mb-2 flex items-center gap-2">
            <span className="shrink-0 text-[10px] text-ink-3">输出</span>
            <div className="flex gap-1">
              {(['image', 'video'] as const).map((t) => (
                <button
                  key={t}
                  className={`nodrag rounded px-2 py-0.5 text-[10px] transition ${outputType === t ? 'bg-brand-600 text-white' : 'bg-soft text-ink-3 hover:bg-soft/80'}`}
                  onClick={() => onUpdate({ output_type: t })}
                >
                  {t === 'image' ? '图片' : '视频'}
                </button>
              ))}
            </div>
          </div>
          {outputType === 'video' && (
            <div className="mb-2 space-y-1.5">
              <select
                className="nodrag w-full rounded-md border border-edge bg-input px-2 py-1 text-[11px] text-ink outline-none"
                value={videoMode}
                onChange={(e) => onUpdate({ video_mode: e.target.value as 'text2video' | 'image2video' | 'multi_ref' })}
              >
                {VIDEO_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              {videoMode === 'image2video' && (
                <RefImagePicker value={shot.image_url ? [shot.image_url] : []} multiple={false} excludeId={nodeId}
                  onChange={(urls) => onUpdate({ image_url: urls[0] || '' })} />
              )}
              {videoMode === 'multi_ref' && (
                <RefImagePicker value={shot.reference_images || []} multiple excludeId={nodeId}
                  onChange={(urls) => onUpdate({ reference_images: urls })} />
              )}
            </div>
          )}

          {/* 生成方式（与角色设计节点一致） */}
          <GenerationModeField
            mode={genMode}
            providerId={providerId}
            providers={activeProviders}
            rendererId={selectedRenderer}
            renderers={renderers}
            model={model}
            onModeChange={(v) => { setGenMode(v as 'comfyui' | 'cloud'); onUpdate({ render_mode: v as 'comfyui' | 'cloud' }) }}
            onProviderChange={(v) => { setProviderId(v); onUpdate({ provider_id: v }) }}
            onRendererChange={(v) => { setSelectedRenderer(v); onUpdate({ renderer_id: v }) }}
            onModelChange={(v) => { setModel(v); onUpdate({ model: v }) }}
          />

          <button
            className="nodrag mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs text-white transition hover:bg-brand-600 disabled:opacity-50"
            onClick={doGenerate}
            disabled={genning || !shot.prompt.trim()}
          >
            {genning ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            {genning ? '生成中…' : '生成'}
          </button>

          {genError && (
            <div className="mt-1.5 rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-[10px] text-red-400">
              {genError}
            </div>
          )}

          {/* 生成结果（自适应画面尺寸） */}
          {shot.generated_url && (
            <div className="mt-2 rounded-md border border-green-500/20 bg-green-500/5 p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-medium text-green-400">
                  {shot.generated_type === 'video' ? '视频生成完成' : '图片生成完成'}
                </span>
                <a href={shot.generated_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] text-brand-400 hover:text-brand-300">
                  <ExternalLink size={9} /> 打开
                </a>
              </div>
              <ResultMedia url={shot.generated_url} type={shot.generated_type === 'video' ? 'video' : 'image'} maxH={260} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
