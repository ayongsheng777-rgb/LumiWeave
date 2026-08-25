import { useEffect, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import { aiChat, getProviders, getRenderers, getSkills, renderMedia } from '../api'
import { cameraLabel } from '../cameraLabels'
import NodeShell from './NodeShell'
import { StoryboardNodeCanvas } from '../components/nodes/StoryboardNodeCanvas'
import { GenerationModeField, type ProviderInfo, type RendererInfo } from '../components/nodes/GenerationModeField'
import { PromptTranslate } from '../components/nodes/PromptTranslate'
import { PromptOptimize } from '../components/nodes/PromptOptimize'
import { ResultMedia } from '../components/nodes/ResultMedia'
import { RefImagePicker } from '../components/nodes/RefImagePicker'
import { emitLog, emitRenderLogs } from '../components/LogPanel'

type ObjData = Record<string, unknown>

const fieldCls =
  'nodrag nowheel w-full rounded-md border border-[var(--lw-edge)] bg-[var(--lw-input-bg)] px-2 py-1 text-xs text-[var(--lw-ink)] outline-none'

function useNodeActions(id: string) {
  const update = useCanvasStore((s) => s.updateObject)
  const toggleLock = useCanvasStore((s) => s.toggleLock)
  const deleteObjects = useCanvasStore((s) => s.deleteObjects)
  return {
    update,
    toggleLock: () => toggleLock(id),
    remove: () => deleteObjects([id]),
  }
}

// ==================== 基础：文本 / 便签 / 提示词 ====================

function TextLikeNode({ id, data, selected, title, color, placeholder, rows }: NodeProps & { title: string; color: string; placeholder: string; rows: number }) {
  const d = data as ObjData
  const { update, toggleLock, remove } = useNodeActions(id)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const locked = d.locked === true

  const gen = async () => {
    if (!aiPrompt.trim()) return
    setAiBusy(true)
    const res = await aiChat({ system: '你是内容生成助手，按要求生成内容，直接输出结果，不要多余解释。', user: aiPrompt, scenario: 'general' })
    setAiBusy(false)
    if (res.ok && res.data.result) update(id, { text: String(res.data.result) })
  }

  return (
    <NodeShell title={title} color={color} selected={!!selected} locked={locked} onToggleLock={toggleLock} onDelete={remove}>
      <textarea
        className="nodrag nowheel"
        rows={rows}
        placeholder={placeholder}
        value={String(d.text ?? '')}
        disabled={locked}
        style={locked ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
        onChange={(e) => update(id, { text: e.target.value })}
      />
      {!locked && (
        <div className="obj-ai-gen nodrag nowheel">
          <input placeholder="输入需求，AI 生成…" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && gen()} />
          <button onClick={gen} disabled={aiBusy}>{aiBusy ? '生成中' : '生成'}</button>
        </div>
      )}
    </NodeShell>
  )
}

const makeTextNode = (title: string, color: string, placeholder: string, rows: number) =>
  (props: NodeProps) => <TextLikeNode {...props} title={title} color={color} placeholder={placeholder} rows={rows} />

// ==================== 输入节点 ====================

function InputNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const { update, toggleLock, remove } = useNodeActions(id)
  const locked = d.locked === true
  return (
    <NodeShell title="故事输入" color="#8b5cf6" selected={!!selected} locked={locked} onToggleLock={toggleLock} onDelete={remove}>
      <textarea
        className="nodrag nowheel"
        rows={5}
        value={String(d.text ?? '')}
        disabled={locked}
        placeholder="输入故事、小说、广告需求或视频创意..."
        onChange={(e) => update(id, { text: e.target.value })}
      />
    </NodeShell>
  )
}

// ==================== AI 剧本解析节点 ====================

function AnalyzeNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const { update, toggleLock, remove } = useNodeActions(id)
  const status = String(d.status ?? 'idle')
  const result = d.result as ObjData | undefined
  const chars = Array.isArray(result?.characters) ? (result!.characters as unknown[]).length : 0
  const scenes = Array.isArray(result?.scenes) ? (result!.scenes as unknown[]).length : 0
  const props = Array.isArray(result?.props) ? (result!.props as unknown[]).length : 0
  return (
    <NodeShell title="AI 剧本解析" color="#10b981" selected={!!selected} status={status} onToggleLock={toggleLock} onDelete={remove}>
      <div className="analyze-summary">
        <div>角色：{chars}</div>
        <div>场景：{scenes}</div>
        <div>道具：{props}</div>
      </div>
      <button className="nodrag node-run-btn" onClick={() => update(id, { action: 'execute' })}>开始解析</button>
    </NodeShell>
  )
}

// ==================== 资产节点（角色/场景/道具图） ====================

const ASSET_TYPES = ['角色', '场景', '道具', '资产']
const ASSET_BACKGROUNDS = ['有背景', '无背景']
const ASSET_VIEWS = ['单视角', '三视图', '四视图']
const ASSET_VIEW_PROMPT: Record<string, string> = {
  '三视图': 'character turnaround sheet, front view, side view, back view, three-view reference',
  '四视图': 'character turnaround sheet, front view, three-quarter view, side view, back view, four-view reference',
}
const inputBoxCls =
  'nodrag nowheel w-full rounded-md border border-edge bg-input px-2 py-1.5 text-xs text-ink outline-none focus:border-brand-500'

function AssetNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const { update, toggleLock, remove } = useNodeActions(id)
  const locked = d.locked === true
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [renderers, setRenderers] = useState<RendererInfo[]>([])
  const [busy, setBusy] = useState(false)

  const assetType = String(d.assetType ?? '资产')
  const name = String(d.name ?? '')
  const prompt = String(d.prompt ?? '')
  const background = String(d.background ?? '有背景')
  const views = String(d.views ?? '单视角')
  const reference = (d.reference as string[]) || []
  const url = String(d.url ?? '')
  const renderMode = String(d.render_mode ?? 'comfyui')
  const providerId = String(d.provider_id ?? '')
  const rendererId = String(d.renderer_id ?? '')
  const model = String(d.model ?? '')

  useEffect(() => {
    getProviders().then((r) => {
      if (r.ok) setProviders((r.data.providers || []).filter((p: { type: string }) => p.type === 'image'))
    })
    getRenderers().then((r) => {
      if (r.ok) setRenderers((r.data.renderers || []).filter((rr: { type: string }) => rr.type === 'comfyui'))
    })
  }, [])

  const run = async () => {
    if (!prompt.trim()) { update(id, { status: 'failed' }); return }
    setBusy(true)
    update(id, { status: 'running' })
    emitLog({ nodeId: id, nodeLabel: assetType, nodeType: 'asset', status: 'running', message: `开始生成${assetType} · ${renderMode === 'cloud' ? `云端(${providerId || '未选'})` : 'ComfyUI'}` })
    const t0 = Date.now()
    try {
      const suffix = [
        background === '无背景' ? 'isolated on plain white background, no background, studio lighting' : '',
        ASSET_VIEW_PROMPT[views] || '',
      ].filter(Boolean).join(', ')
      const fullPrompt = [prompt, suffix].filter(Boolean).join(', ')
      const params: Record<string, unknown> = { prompt: fullPrompt }
      if (reference.length) params.reference = reference
      const res = await renderMedia({
        kind: 'image',
        render_mode: renderMode,
        provider_id: providerId,
        model,
        renderer_id: rendererId,
        params,
      })
      const rdata = res.data as Record<string, unknown> | undefined
      if (res.ok && rdata?.ok !== false) {
        emitRenderLogs(rdata?.logs, id, assetType, 'asset')
        const images = (rdata?.images as { url?: string }[] | undefined) || []
        const u = images[0]?.url || (rdata?.url as string) || ''
        update(id, { url: u, status: 'completed' })
        emitLog({ nodeId: id, nodeLabel: assetType, nodeType: 'asset', status: 'completed', message: `${assetType}生成完成`, duration: Date.now() - t0 })
      } else {
        const err = String(rdata?.error || '生成失败')
        emitRenderLogs(rdata?.logs, id, assetType, 'asset')
        update(id, { status: 'failed' })
        emitLog({ nodeId: id, nodeLabel: assetType, nodeType: 'asset', status: 'failed', message: `生成失败 · ${err.slice(0, 60)}`, detail: err })
      }
    } catch (e) {
      update(id, { status: 'failed' })
      emitLog({ nodeId: id, nodeLabel: assetType, nodeType: 'asset', status: 'failed', message: `生成失败 · ${String(e).slice(0, 60)}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <NodeShell title={assetType} color="#3b82f6" selected={!!selected} locked={locked} status={String(d.status ?? 'idle')} onToggleLock={toggleLock} onDelete={remove}>
      <div className="nodrag nowheel flex flex-col gap-1.5" style={{ minHeight: 120 }}>
        {!locked && (
          <select className={inputBoxCls} value={assetType} onChange={(e) => update(id, { assetType: e.target.value })}>
            {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {assetType !== '资产' && (
          <input className={inputBoxCls} placeholder="名称" value={name} disabled={locked} onChange={(e) => update(id, { name: e.target.value })} />
        )}
        <textarea className={inputBoxCls} rows={3} value={prompt} disabled={locked} placeholder="AI 生成提示词（原文引用）"
          onChange={(e) => update(id, { prompt: e.target.value })} />
        {!locked && <PromptTranslate prompt={prompt} />}
        {!locked && (
          <PromptOptimize prompt={prompt} kind="image" model={model} nodeLabel={assetType} onApply={(v) => update(id, { prompt: v })} />
        )}

        {/* 无背景 + 多视角（角色/道具） */}
        {!locked && (assetType === '角色' || assetType === '道具') && (
          <div className="grid grid-cols-2 gap-1.5">
            <select className={inputBoxCls} value={background} onChange={(e) => update(id, { background: e.target.value })}>
              {ASSET_BACKGROUNDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select className={inputBoxCls} value={views} onChange={(e) => update(id, { views: e.target.value })}>
              {ASSET_VIEWS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        )}

        {/* 场景：参考角色图（图生图合成） */}
        {!locked && assetType === '场景' && (
          <RefImagePicker value={reference} multiple excludeId={id} onChange={(urls) => update(id, { reference: urls })} />
        )}

        {!locked && (
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
        )}

        {!locked && (
          <button className="nodrag nowheel rounded-md bg-brand-600 px-2 py-1.5 text-xs text-white transition hover:bg-brand-500 disabled:opacity-50"
            onClick={run} disabled={busy || !prompt.trim()}>
            {busy ? '生成中…' : `生成${assetType}`}
          </button>
        )}

        {url ? <ResultMedia url={url} maxH={240} /> : <div className="obj-img-placeholder" style={{ minHeight: 50 }}>尚未生成</div>}
      </div>
    </NodeShell>
  )
}

// ==================== 技能节点 ====================

function SkillNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const { update, toggleLock, remove } = useNodeActions(id)
  const [skills, setSkills] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    getSkills().then((r) => { if (r.ok) setSkills(r.data.skills || []) })
  }, [])
  const skillId = String(d.skill_id ?? '')
  return (
    <NodeShell title="技能" color="#f59e0b" selected={!!selected} onToggleLock={toggleLock} onDelete={remove}>
      <select className={fieldCls} value={skillId} onChange={(e) => update(id, { skill_id: e.target.value })}>
        <option value="">选择技能…</option>
        {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </NodeShell>
  )
}

// ==================== 输出节点 ====================

function OutputNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const { toggleLock, remove } = useNodeActions(id)
  const result = d.result
  return (
    <NodeShell title="输出" color="#64748b" selected={!!selected} onToggleLock={toggleLock} onDelete={remove} output={false}>
      {result != null ? (
        <pre className="output-pre">{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
      ) : (
        <div className="obj-img-placeholder" style={{ minHeight: 40 }}>等待上游结果</div>
      )}
    </NodeShell>
  )
}

// ==================== 图片 / 视频 / AI 结果 ====================

function ImageNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const { update, toggleLock, remove } = useNodeActions(id)
  const locked = d.locked === true
  const url = String(d.url ?? '')
  return (
    <NodeShell title="图片" color="#3b82f6" selected={!!selected} locked={locked} onToggleLock={toggleLock} onDelete={remove}>
      {url ? <img className="obj-img" src={url} alt="生成图" draggable={false} /> : <div className="obj-img-placeholder">未生成</div>}
      <input className="nodrag nowheel" type="text" placeholder="图片 URL" value={url} disabled={locked} onChange={(e) => update(id, { url: e.target.value })} />
    </NodeShell>
  )
}

const CAMERAS = ['static', 'slow push-in', 'pan-left', 'pan-right', 'handheld', 'orbit', 'zoom-in']
const STYLES = ['cinematic', 'anime', 'realistic', 'watercolor', '3d']
const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const VIDEO_MODES = [
  { value: 'text2video', label: '文生视频' },
  { value: 'image2video', label: '首帧生视频' },
  { value: 'multi_ref', label: '多参考生视频' },
]

function VideoNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const { update, toggleLock, remove } = useNodeActions(id)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [renderers, setRenderers] = useState<RendererInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = d.locked === true

  useEffect(() => {
    getProviders().then((res) => {
      if (res.ok) setProviders((res.data.providers || []).filter((p: { type: string }) => p.type === 'video'))
    })
    getRenderers().then((res) => {
      if (res.ok) setRenderers((res.data.renderers || []).filter((r: { type: string }) => r.type === 'comfyui'))
    })
  }, [])

  const prompt = String(d.prompt ?? '')
  const url = String(d.url ?? '')
  const duration = Number(d.duration ?? 6)
  const ratio = String(d.ratio ?? '16:9')
  const camera = String(d.camera ?? 'static')
  const style = String(d.style ?? 'cinematic')
  const renderMode = String(d.render_mode ?? 'comfyui')
  const providerId = String(d.provider_id ?? '')
  const rendererId = String(d.renderer_id ?? '')
  const model = String(d.model ?? '')
  const videoMode = String(d.video_mode ?? 'text2video')
  const imageUrl = String(d.image_url ?? '')
  const referenceImages = (d.reference_images as string[]) || []

  const generate = async () => {
    if (!prompt.trim()) { setError('请先输入提示词'); return }
    if (videoMode === 'image2video' && !imageUrl) { setError('首帧生视频需要选一张首帧图'); return }
    if (videoMode === 'multi_ref' && !referenceImages.length) { setError('多参考生视频需要选参考图'); return }
    setBusy(true); setError('')
    update(id, { status: 'running' })
    emitLog({ nodeId: id, nodeLabel: '视频生成', nodeType: 'video', status: 'running', message: `开始生成 · ${videoMode === 'multi_ref' ? '多参考' : videoMode === 'image2video' ? '首帧' : '文生'}` })
    const t0 = Date.now()
    try {
      const finalPrompt = [style, `运镜:${camera}`, prompt].filter(Boolean).join('，')
      const params: Record<string, unknown> = { prompt: finalPrompt, duration, ratio }
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
      const rdata = res.data as Record<string, unknown> | undefined
      if (res.ok && rdata?.ok !== false) {
        emitRenderLogs(rdata?.logs, id, '视频生成', 'video')
        const videos = (rdata?.videos as { url?: string }[] | undefined) || []
        const u = videos[0]?.url || (rdata?.url as string) || ''
        update(id, { url: u, status: 'completed' })
        emitLog({ nodeId: id, nodeLabel: '视频生成', nodeType: 'video', status: 'completed', message: '视频生成完成', duration: Date.now() - t0 })
      } else {
        const err = String(rdata?.error || '生成失败')
        emitRenderLogs(rdata?.logs, id, '视频生成', 'video')
        setError(err)
        update(id, { status: 'failed' })
        emitLog({ nodeId: id, nodeLabel: '视频生成', nodeType: 'video', status: 'failed', message: `生成失败 · ${err.slice(0, 60)}`, detail: err })
      }
    } catch (e) {
      setError(String(e))
      update(id, { status: 'failed' })
      emitLog({ nodeId: id, nodeLabel: '视频生成', nodeType: 'video', status: 'failed', message: `生成失败 · ${String(e).slice(0, 60)}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <NodeShell title="视频生成" color="#ec4899" selected={!!selected} locked={locked} status={String(d.status ?? 'idle')} onToggleLock={toggleLock} onDelete={remove}>
      <div className="nodrag nowheel flex flex-col gap-1.5" style={{ minHeight: 170 }}>
        <textarea className={inputBoxCls} rows={2} placeholder="输入视频提示词…" value={prompt} disabled={locked} onChange={(e) => update(id, { prompt: e.target.value })} />
        {!locked && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="text-[10px] text-ink-3">时长(秒)<input className={inputBoxCls} type="number" min={3} max={30} value={duration} onChange={(e) => update(id, { duration: Number(e.target.value) })} /></label>
              <label className="text-[10px] text-ink-3">比例<select className={inputBoxCls} value={ratio} onChange={(e) => update(id, { ratio: e.target.value })}>{RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
              <label className="text-[10px] text-ink-3">运镜<select className={inputBoxCls} value={camera} onChange={(e) => update(id, { camera: e.target.value })}>{CAMERAS.map((c) => <option key={c} value={c}>{cameraLabel(c)}</option>)}</select></label>
              <label className="text-[10px] text-ink-3">风格<select className={inputBoxCls} value={style} onChange={(e) => update(id, { style: e.target.value })}>{STYLES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            </div>

            <label className="text-[10px] text-ink-3">生视频模式
              <select className={inputBoxCls} value={videoMode} onChange={(e) => update(id, { video_mode: e.target.value })}>
                {VIDEO_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
            {videoMode === 'image2video' && (
              <RefImagePicker value={imageUrl ? [imageUrl] : []} multiple={false} excludeId={id} onChange={(urls) => update(id, { image_url: urls[0] || '' })} />
            )}
            {videoMode === 'multi_ref' && (
              <RefImagePicker value={referenceImages} multiple excludeId={id} onChange={(urls) => update(id, { reference_images: urls })} />
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
            <button className="nodrag nowheel rounded-md bg-brand-600 px-2 py-1.5 text-xs text-white transition hover:bg-brand-500 disabled:opacity-50" onClick={generate} disabled={busy}>{busy ? '生成中…' : '生成视频'}</button>
          </>
        )}
        {error && <div className="text-[11px] text-red-400">{error}</div>}
        {url ? <ResultMedia url={url} type="video" maxH={240} /> : <div className="obj-img-placeholder" style={{ minHeight: 50 }}>生成后这里播放视频</div>}
      </div>
    </NodeShell>
  )
}

function AiResultNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const { update, toggleLock, remove } = useNodeActions(id)
  const locked = d.locked === true
  const kind = String(d.kind ?? 'text')
  return (
    <NodeShell title="AI 结果" color="#ef4444" selected={!!selected} locked={locked} onToggleLock={toggleLock} onDelete={remove}>
      {kind === 'image' && d.url ? <img className="obj-img" src={String(d.url)} alt="AI 生成" draggable={false} />
        : kind === 'video' && d.url ? <video className="obj-img" src={String(d.url)} controls muted loop />
        : <textarea className="nodrag nowheel" rows={3} value={String(d.text ?? '')} disabled={locked} onChange={(e) => update(id, { text: e.target.value })} />}
    </NodeShell>
  )
}

export const objectNodeTypes = {
  text: makeTextNode('文本', '#8b5cf6', '双击编辑文本', 3),
  note: makeTextNode('便签', '#f59e0b', '记一笔…', 2),
  prompt: makeTextNode('提示词', '#10b981', '输入提示词…', 3),
  input: InputNode,
  analyze: AnalyzeNode,
  asset: AssetNode,
  skill: SkillNode,
  output: OutputNode,
  image: ImageNode,
  video: VideoNode,
  ai_result: AiResultNode,
  storyboard: StoryboardNodeCanvas,
}
