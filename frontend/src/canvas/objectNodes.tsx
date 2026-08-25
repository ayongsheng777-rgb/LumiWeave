import { useEffect, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import { aiChat, getRenderers, getSkills, rendererGenerate } from '../api'
import NodeShell from './NodeShell'

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
    <NodeShell title={title} color={color} selected={!!selected} locked={locked} onToggleLock={toggleLock} onDelete={remove} input={false}>
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
    <NodeShell title="故事输入" color="#8b5cf6" selected={!!selected} locked={locked} onToggleLock={toggleLock} onDelete={remove} input={false}>
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

function AssetNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const { update, toggleLock, remove } = useNodeActions(id)
  const prompt = String(d.prompt ?? '')
  const url = String(d.url ?? '')
  const locked = d.locked === true
  return (
    <NodeShell title={String(d.assetType ?? '资产')} color="#3b82f6" selected={!!selected} locked={locked} onToggleLock={toggleLock} onDelete={remove}>
      <textarea
        className="nodrag nowheel"
        rows={3}
        value={prompt}
        disabled={locked}
        placeholder="AI 生成提示词"
        onChange={(e) => update(id, { prompt: e.target.value })}
      />
      {url ? <img className="obj-img" src={url} alt="asset" draggable={false} /> : <div className="obj-img-placeholder">尚未生成</div>}
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

// ==================== 智能体节点 ====================

function AgentNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const { update, toggleLock, remove } = useNodeActions(id)
  const message = String(d.message ?? '')
  return (
    <NodeShell title="智能体" color="#8b5cf6" selected={!!selected} onToggleLock={toggleLock} onDelete={remove}>
      <textarea
        className="nodrag nowheel"
        rows={3}
        value={message}
        placeholder="给智能体的指令（留空则透传上游）"
        onChange={(e) => update(id, { message: e.target.value })}
      />
      <input className={fieldCls} placeholder="指定 agent_id（可选，默认 auto）" value={String(d.agent_id ?? '')} onChange={(e) => update(id, { agent_id: e.target.value })} />
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

function VideoNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const { update, toggleLock, remove } = useNodeActions(id)
  const [renderers, setRenderers] = useState<{ id: string; name: string; enabled: boolean }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = d.locked === true

  useEffect(() => {
    getRenderers().then((res) => {
      if (res.ok) setRenderers((res.data.renderers || []).filter((r: { type: string }) => r.type === 'video-api'))
    })
  }, [])

  const prompt = String(d.prompt ?? '')
  const url = String(d.url ?? '')
  const duration = Number(d.duration ?? 6)
  const ratio = String(d.ratio ?? '16:9')
  const camera = String(d.camera ?? 'static')
  const style = String(d.style ?? 'cinematic')
  const rendererId = String(d.renderer_id ?? '')

  const generate = async () => {
    if (!prompt.trim()) { setError('请先输入提示词'); return }
    const rid = rendererId || (renderers[0] && renderers[0].id) || ''
    if (!rid) { setError('未配置视频渲染器'); return }
    setBusy(true); setError('')
    const res = await rendererGenerate(rid, { params: { prompt, duration, ratio, camera, style }, mode: 'text2video' })
    setBusy(false)
    if (res.ok && res.data && res.data.ok) {
      const videos = res.data.videos || []
      if (videos.length) update(id, { url: videos[0].url })
      else setError('生成完成但没返回视频链接')
    } else setError((res.data && res.data.error) || '生成失败')
  }

  return (
    <NodeShell title="视频生成" color="#ec4899" selected={!!selected} locked={locked} onToggleLock={toggleLock} onDelete={remove}>
      <div className="nodrag nowheel flex flex-col gap-1.5" style={{ minHeight: 170 }}>
        <textarea className={fieldCls} rows={2} placeholder="输入视频提示词…" value={prompt} disabled={locked} onChange={(e) => update(id, { prompt: e.target.value })} />
        {!locked && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="text-[10px] text-[var(--lw-ink-3)]">时长(秒)<input className={fieldCls} type="number" min={3} max={30} value={duration} onChange={(e) => update(id, { duration: Number(e.target.value) })} /></label>
              <label className="text-[10px] text-[var(--lw-ink-3)]">比例<select className={fieldCls} value={ratio} onChange={(e) => update(id, { ratio: e.target.value })}>{RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
              <label className="text-[10px] text-[var(--lw-ink-3)]">运镜<select className={fieldCls} value={camera} onChange={(e) => update(id, { camera: e.target.value })}>{CAMERAS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              <label className="text-[10px] text-[var(--lw-ink-3)]">风格<select className={fieldCls} value={style} onChange={(e) => update(id, { style: e.target.value })}>{STYLES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            </div>
            {renderers.length > 0 && (
              <select className={fieldCls} value={rendererId} onChange={(e) => update(id, { renderer_id: e.target.value })}>
                <option value="">自动选择</option>
                {renderers.map((r) => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}
              </select>
            )}
            <button className="nodrag nowheel rounded-md bg-[var(--brand)] px-2 py-1.5 text-xs text-white" onClick={generate} disabled={busy}>{busy ? '生成中…' : '生成视频'}</button>
          </>
        )}
        {error && <div className="text-[11px] text-red-400">{error}</div>}
        {url ? <video className="obj-img" src={url} controls muted loop /> : <div className="obj-img-placeholder" style={{ minHeight: 50 }}>生成后这里播放视频</div>}
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
  agent: AgentNode,
  output: OutputNode,
  image: ImageNode,
  video: VideoNode,
  ai_result: AiResultNode,
}
