import { useEffect, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import { aiChat, getProviders, getRenderers, renderMedia } from '../api'
import NodeShell from './NodeShell'
import { nodeTypes as filmNodeTypes } from '../components/nodes'
import { StoryboardNodeCanvas } from '../components/nodes/StoryboardNodeCanvas'
import { GenerationModeField, type ProviderInfo, type RendererInfo } from '../components/nodes/GenerationModeField'
import { PromptTranslate } from '../components/nodes/PromptTranslate'
import { PromptOptimize } from '../components/nodes/PromptOptimize'
import { ResultMedia } from '../components/nodes/ResultMedia'
import { RefImagePicker } from '../components/nodes/RefImagePicker'
import { emitLog, emitRenderLogs } from '../components/LogPanel'
import { lingjingNodeTypes } from './lingjingNodes'

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
        className={fieldCls}
        rows={rows}
        placeholder={placeholder}
        value={String(d.text ?? '')}
        disabled={locked}
        style={locked ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
        onChange={(e) => update(id, { text: e.target.value })}
      />
      {!locked && (
        <div className="mt-1.5 flex gap-1.5">
          <input
            className={fieldCls}
            placeholder="输入需求，AI 生成…"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && gen()}
          />
          <button
            className="nodrag nowheel shrink-0 rounded-md bg-brand-600 px-2 py-1 text-xs text-white transition hover:bg-brand-500 disabled:opacity-50"
            onClick={gen}
            disabled={aiBusy}
          >
            {aiBusy ? '生成中' : '生成'}
          </button>
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
        className={fieldCls}
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
      <div className="flex flex-col gap-1 text-xs text-ink-2">
        <div>角色：{chars}</div>
        <div>场景：{scenes}</div>
        <div>道具：{props}</div>
      </div>
      <button className="nodrag mt-2 w-full rounded-lg bg-brand-500 px-2 py-1.5 text-xs text-white transition hover:bg-brand-600" onClick={() => update(id, { action: 'execute' })}>开始解析</button>
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

        {url ? <ResultMedia url={url} maxH={240} /> : <div className="flex items-center justify-center rounded-md border border-dashed border-edge bg-soft text-[11px] text-ink-3" style={{ minHeight: 50 }}>尚未生成</div>}
      </div>
    </NodeShell>
  )
}

// ==================== AI 结果 ====================
function AiResultNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const { update, toggleLock, remove } = useNodeActions(id)
  const locked = d.locked === true
  const kind = String(d.kind ?? 'text')
  return (
    <NodeShell title="AI 结果" color="#ef4444" selected={!!selected} locked={locked} onToggleLock={toggleLock} onDelete={remove}>
      {kind === 'image' && d.url ? <img className="w-full rounded-md object-cover" src={String(d.url)} alt="AI 生成" draggable={false} />
        : kind === 'video' && d.url ? <video className="w-full rounded-md object-cover" src={String(d.url)} controls muted loop />
        : <textarea className={fieldCls} rows={3} value={String(d.text ?? '')} disabled={locked} onChange={(e) => update(id, { text: e.target.value })} />}
    </NodeShell>
  )
}

export const objectNodeTypes = {
  // ── 影视节点：直接复用工作流画布组件（两套画布同步最新形态）─────────
  story: filmNodeTypes.story,
  image_input: filmNodeTypes.image_input,
  character: filmNodeTypes.character,
  scene: filmNodeTypes.scene,
  prop: filmNodeTypes.prop,
  image: filmNodeTypes.image,
  video: filmNodeTypes.video,
  audio: filmNodeTypes.audio,
  subtitle: filmNodeTypes.subtitle,
  layout: filmNodeTypes.layout,
  export: filmNodeTypes.export,
  prompt: filmNodeTypes.prompt,
  skill: filmNodeTypes.skill,
  output: filmNodeTypes.output,
  // ── 画布专属类型（保留原实现）─────────────────────────────────────
  storyboard: StoryboardNodeCanvas,
  asset: AssetNode,
  input: InputNode,
  analyze: AnalyzeNode,
  text: makeTextNode('文本', '#8b5cf6', '双击编辑文本', 3),
  note: makeTextNode('便签', '#f59e0b', '记一笔…', 2),
  ai_result: AiResultNode,
  // ── 灵境复刻节点（原版画布导入用）──────────────────────────────────
  ...lingjingNodeTypes,
}
