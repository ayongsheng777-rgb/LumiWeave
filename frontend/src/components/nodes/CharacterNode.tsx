import { useEffect, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { User } from 'lucide-react'
import { useNodeAdapter } from '../../store/nodeAdapter'
import { getModelChoices, getRenderers, filmCharacterGenerate } from '../../api'
import { NodeShell, Field, inputCls } from './NodeShell'
import { GenerationModeField, type ProviderInfo, type RendererInfo } from './GenerationModeField'
import { PromptTranslate } from './PromptTranslate'
import { PromptOptimize } from './PromptOptimize'
import { ResultMedia } from './ResultMedia'
import { emitLog, emitRenderLogs } from '../LogPanel'

const STYLES = ['电影感', '动漫', '写实', '水彩', '3D', '赛博朋克', '古风']
const POSES  = ['', '站立', '行走', '战斗姿态', '坐姿', '跑步', '飞行', '持械', '休闲']
const EXPRESSIONS = ['', '冷峻', '微笑', '愤怒', '悲伤', '惊讶', '坚定', '神秘', '欢乐']
const BACKGROUNDS = ['有背景', '无背景']
const VIEWS = ['单视角', '三视图', '四视图']
const VIEW_PROMPT: Record<string, string> = {
  '三视图': 'character turnaround sheet, front view, side view, back view, three-view reference',
  '四视图': 'character turnaround sheet, front view, three-quarter view, side view, back view, four-view reference',
}
// 视角提示词预设（V2.3 多样性选择）：点击拼进提示词，再点取消
const VIEW_PRESETS: { label: string; prompt: string }[] = [
  { label: '正面定妆', prompt: 'front-facing portrait, looking at camera, symmetrical face, centered composition' },
  { label: '45°侧脸',  prompt: 'three-quarter angle view, 45 degree head turn' },
  { label: '正侧面',   prompt: 'side profile view, profile portrait' },
  { label: '背面',     prompt: 'back view, rear perspective' },
  { label: '仰视',     prompt: 'low angle shot, looking up perspective' },
  { label: '俯视',     prompt: 'high angle shot, top-down perspective' },
  { label: '全身',     prompt: 'full body shot, head to toe, standing pose' },
  { label: '半身',     prompt: 'upper body shot, waist up portrait' },
  { label: '面部特写', prompt: 'close-up shot, facial detail, shallow depth of field' },
]

export function CharacterNode({ id, data, selected }: NodeProps) {
  const { update } = useNodeAdapter()
  const d = data as Record<string, unknown>
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [renderers, setRenderers] = useState<RendererInfo[]>([])

  useEffect(() => {
    getModelChoices().then((r) => {
      if (r.ok) setProviders((r.data?.providers || []))
    })
    getRenderers().then((r) => {
      if (r.ok) setRenderers((r.data.renderers || []).filter((rr: { type: string }) => rr.type === 'comfyui'))
    })
  }, [])

  const name    = String(d.name ?? '')
  const desc    = String(d.description ?? '')
  const prompt  = String(d.prompt ?? '')
  const style   = String(d.style ?? '电影感')
  const pose    = String(d.pose ?? '')
  const expr    = String(d.expression ?? '')
  const refs    = (d.reference as string[]) || []
  const seed    = String(d.seed ?? '')
  const url     = String((d.result as Record<string, unknown>)?.url ?? '')
  const renderMode = String(d.render_mode ?? 'comfyui')
  const providerId = String(d.provider_id ?? '')
  const rendererId = String(d.renderer_id ?? '')
  const model    = String(d.model ?? '')
  const background = String(d.background ?? '有背景')
  const views      = String(d.views ?? '单视角')

  const run = async () => {
    if (!name.trim() && !prompt.trim() && !desc.trim()) { update(id, { status: 'failed', error: '请先输入角色名或提示词' }); return }
    update(id, { status: 'running' })
    emitLog({ nodeId: id, nodeLabel: '角色设计', nodeType: 'character', status: 'running', message: `开始生成 · ${renderMode === 'cloud' ? `云端(${providerId || '未选'})` : 'ComfyUI'}` })
    // 无背景 / 多视角：拼成描述后缀
    const suffix = [
      background === '无背景' ? 'isolated on plain white background, no background, studio lighting' : '',
      VIEW_PROMPT[views] || '',
    ].filter(Boolean).join(', ')
    const finalDesc = [desc, suffix].filter(Boolean).join(', ')
    const t0 = Date.now()
    try {
      const res = await filmCharacterGenerate({
        name, description: finalDesc, prompt, style, pose, expression: expr,
        reference_urls: refs, seed,
        render_mode: renderMode, provider_id: providerId, model, renderer_id: rendererId,
      })
      const data = res as unknown as { ok?: boolean; error?: string; data?: Record<string, unknown> }
      if (data.ok !== false && data.data) {
        const logs = (data.data.logs as unknown[]) || []
        emitRenderLogs(logs, id, '角色设计', 'character')
        update(id, { status: 'completed', result: data.data, seed: (data.data.seed as string) || seed })
        emitLog({ nodeId: id, nodeLabel: '角色设计', nodeType: 'character', status: 'completed', message: '角色图生成完成', duration: Date.now() - t0 })
      } else {
        const err = String(data.error || '生成失败')
        emitRenderLogs((data.data as Record<string, unknown> | undefined)?.logs, id, '角色设计', 'character')
        update(id, { status: 'failed', error: err })
        emitLog({ nodeId: id, nodeLabel: '角色设计', nodeType: 'character', status: 'failed', message: `生成失败 · ${err.slice(0, 80)}`, detail: err })
      }
    } catch (e) {
      update(id, { status: 'failed', error: String(e) })
      emitLog({ nodeId: id, nodeLabel: '角色设计', nodeType: 'character', status: 'failed', message: `生成失败 · ${String(e).slice(0, 80)}` })
    }
  }

  return (
    <NodeShell id={id} selected={selected} title="角色设计" icon={<User size={15} />} resultView={url ? <ResultMedia url={url} /> : undefined}>
      <Field label="角色名">
        <input className={inputCls} value={name} placeholder="如：赛博女战士"
          onChange={(e) => update(id, { name: e.target.value })} />
      </Field>
      <Field label="角色描述">
        <textarea className={inputCls} rows={2} value={desc} placeholder="外貌、性格、服装……"
          onChange={(e) => update(id, { description: e.target.value })} />
      </Field>
      <Field label="提示词">
        <textarea className={inputCls} rows={2} value={prompt} placeholder="AI 出图提示词（原文引用，不强制翻译）"
          onChange={(e) => update(id, { prompt: e.target.value })} />
        <PromptTranslate prompt={prompt} />
        <PromptOptimize prompt={prompt} kind="character" model={model} nodeLabel="角色设计"
          onApply={(v) => update(id, { prompt: v })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="风格">
          <select className={inputCls} value={style} onChange={(e) => update(id, { style: e.target.value })}>
            {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="姿态">
          <select className={inputCls} value={pose} onChange={(e) => update(id, { pose: e.target.value })}>
            {POSES.map((p) => <option key={p} value={p}>{p || '未选择'}</option>)}
          </select>
        </Field>
        <Field label="表情">
          <select className={inputCls} value={expr} onChange={(e) => update(id, { expression: e.target.value })}>
            {EXPRESSIONS.map((e) => <option key={e} value={e}>{e || '未选择'}</option>)}
          </select>
        </Field>
        <Field label="背景">
          <select className={inputCls} value={background} onChange={(e) => update(id, { background: e.target.value })}>
            {BACKGROUNDS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        {seed && (
          <div className="col-span-2 rounded bg-soft px-2 py-1 text-[10px] text-ink-3">
            角色种子：{seed}（同一角色复用此种子保持一致性）
          </div>
        )}
      </div>
      {/* 视角 + 角度快捷标签：视角定义在左，角度预设快捷键在右 */}
      <Field label="视角 / 角度（点标签拼进提示词，可叠加）">
        <div className="flex items-start gap-2">
          <select className={`${inputCls} w-24 shrink-0`} value={views} onChange={(e) => update(id, { views: e.target.value })}>
            {VIEWS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {VIEW_PRESETS.map((p) => {
              const active = prompt.toLowerCase().includes(p.prompt.toLowerCase())
              return (
                <button
                  key={p.label}
                  type="button"
                  title={`${active ? '移除' : '追加'}：${p.prompt}`}
                  onClick={() => {
                    if (active) {
                      const next = prompt
                        .replace(new RegExp(`,?\\s*${p.prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), '')
                        .replace(/^\s*,\s*/, '')
                      update(id, { prompt: next })
                    } else {
                      update(id, { prompt: prompt ? `${prompt}, ${p.prompt}` : p.prompt })
                    }
                  }}
                  className={`nodrag rounded-full border px-2 py-0.5 text-[10px] transition ${
                    active
                      ? 'border-brand-500 bg-brand-500/15 text-brand-300'
                      : 'border-edge bg-soft text-ink-3 hover:bg-hover hover:text-ink'
                  }`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>
      </Field>
      {refs.length > 0 && (
        <div className="flex gap-1 overflow-x-auto py-1">
          {refs.map((r, i) => <img key={i} src={r} className="h-12 w-12 rounded-md object-cover" alt="ref" />)}
        </div>
      )}
      {url ? <ResultMedia url={url} />
        : <div className="flex h-20 items-center justify-center rounded-md bg-soft text-[11px] text-ink-3">点击生成获取角色图</div>}
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
        生成角色
      </button>
    </NodeShell>
  )
}
