// =====================================================================
// 弹出式提示词 Composer（对标 PixVerse 的 prompt 对话框）
// 点「生成」或智能动作后弹出：参考图缩略图条 + 提示词（@ 指代）+
// 底部条（模型选择[候选池含 ComfyUI] / 参数 / 字数 / 提交）。
// 确认后才真正跑节点 —— 改完再生成，不浪费积分。
// =====================================================================
import { useMemo, useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import { usePvStore } from './store'
import { usePvDialogs } from './dialogStore'
import { useNodeInputs } from './useNodeInputs'
import { useScenePools, type ScenePools } from './pools'
import { useProfiles, type Profile } from './useProfiles'
import type { ContentType, PvNodeData } from './types'
import { ASPECT_RATIOS, CREATE_COUNT_OPTIONS, DURATION_OPTIONS, QUALITY_OPTIONS } from './types'
import { GEN_TYPE_META } from './registry'
import { emitLog } from '../components/LogPanel'

const inputCls =
  'nodrag nowheel w-full rounded-md border border-edge bg-input px-2 py-1.5 text-xs text-ink outline-none transition focus:border-brand-500 placeholder:text-ink-3'

const SCENE_OF: Record<ContentType, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  text: 'prompt',
}

function modelOf(p: Profile, contentType: ContentType): string {
  const override = p.scene_models?.[SCENE_OF[contentType]]
  return override || p.model || ''
}

/** 模型选项值：pool::<候选id>（候选池，含 ComfyUI）/ profile::<模型库id>（兜底全量） */
type ModelSel = { kind: 'pool'; candidateId: string } | { kind: 'profile'; profileId: string } | null

function parseSel(v: string): ModelSel {
  if (v.startsWith('pool::')) return { kind: 'pool', candidateId: v.slice(6) }
  if (v.startsWith('profile::')) return { kind: 'profile', profileId: v.slice(9) }
  return null
}

/** 从节点当前数据反推下拉值 */
function selOfNode(d: PvNodeData, pools: ScenePools): string {
  if (d.render_mode === 'comfyui') return `pool::comfyui::${d.model || ''}`
  if (d.profile_id) {
    const scene = d.content_type === 'video' ? 'video' : 'image'
    const hit = pools[scene].candidates.find((c) => c.profile_id === d.profile_id && c.model === d.model)
    if (hit) return `pool::${hit.id}`
    return `profile::${d.profile_id}`
  }
  return ''
}

export function PvComposer() {
  const nodeId = usePvDialogs((s) => s.composerNodeId)
  if (!nodeId) return null
  // key=nodeId：切换节点时整棵子树重建，表单初始值跟着新节点走
  return <ComposerDialog key={nodeId} nodeId={nodeId} />
}

function ComposerDialog({ nodeId }: { nodeId: string }) {
  const close = usePvDialogs((s) => s.closeComposer)
  const node = usePvStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNodeData = usePvStore((s) => s.updateNodeData)
  const runNode = usePvStore((s) => s.runNode)
  const running = usePvStore((s) => s.running)
  const pools = useScenePools()
  const profiles = useProfiles(node ? ((node.data as unknown as PvNodeData).content_type) : 'image')
  const inputs = useNodeInputs(nodeId)

  const d = node?.data as unknown as PvNodeData | undefined
  const params = d?.params
  const genType = params?.gen_type
  const meta = genType ? GEN_TYPE_META[genType] : undefined
  const isVideo = d?.content_type === 'video'
  const isAudio = d?.content_type === 'audio'
  const scene = isVideo ? 'video' : 'image'
  const pool = pools[scene]

  const [prompt, setPrompt] = useState(params?.prompt || '')
  const [negative, setNegative] = useState(params?.negative || '')
  const [ratio, setRatio] = useState(params?.aspect_ratio || '16:9')
  const [duration, setDuration] = useState(params?.duration ?? 5)
  const [quality, setQuality] = useState(params?.quality || '1080p')
  const [count, setCount] = useState(params?.create_count ?? 1)
  const [seed, setSeed] = useState(params?.seed != null ? String(params.seed) : '')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [sel, setSel] = useState(() => (d ? selOfNode(d, pools) : ''))
  const [busy, setBusy] = useState(false)

  // 候选池异步拉到后，若节点还没选过模型则默认选中池默认项
  const effectiveSel = useMemo(() => {
    if (sel) return sel
    if (pool.default) return `pool::${pool.default}`
    return ''
  }, [sel, pool.default])

  if (!node || !d || !params) return null

  const onSubmit = async () => {
    const parsed = parseSel(effectiveSel)
    const patch: Partial<PvNodeData> = {
      params: {
        ...params,
        prompt,
        negative,
        aspect_ratio: ratio,
        duration: isVideo ? duration : params.duration,
        quality,
        create_count: count,
        seed: seed === '' ? undefined : Number(seed),
      },
    }
    if (parsed?.kind === 'pool') {
      const c = pool.candidates.find((x) => x.id === parsed.candidateId)
        ?? pools.video.candidates.find((x) => x.id === parsed.candidateId)
      if (c) {
        if (c.renderer === 'comfyui') {
          patch.render_mode = 'comfyui'
          patch.profile_id = undefined
          patch.model = c.model
        } else {
          patch.render_mode = 'cloud'
          patch.profile_id = c.profile_id
          patch.model = c.model
        }
      }
    } else if (parsed?.kind === 'profile') {
      const p = profiles.find((x) => x.id === parsed.profileId)
      patch.render_mode = 'cloud'
      patch.profile_id = parsed.profileId
      patch.model = p ? modelOf(p, d.content_type) : ''
    }
    updateNodeData(nodeId, patch)
    close()
    setBusy(true)
    try {
      await runNode(nodeId)
      const after = usePvStore.getState().nodes.find((n) => n.id === nodeId)
      const st = (after?.data as unknown as PvNodeData)?.status
      emitLog({
        nodeId,
        nodeLabel: d.title,
        nodeType: 'pv_generate',
        status: st === 'completed' ? 'completed' : st === 'failed' ? 'failed' : 'running',
        message: st === 'completed' ? '生成完成' : st === 'failed' ? '生成失败' : '开始生成',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm animate-fade-in"
      onClick={close}
    >
      <div
        className="flex max-h-[86vh] w-[min(94vw,34rem)] flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{
          borderColor: 'var(--lw-glass-strong-edge)',
          background: 'var(--lw-node-bg)',
          boxShadow: 'var(--lw-node-shadow-hover)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 头部 ─────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-3">
          <Sparkles size={15} className="text-brand-400" />
          <span className="truncate text-sm font-medium text-ink">{d.title}</span>
          <span className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-3">{meta?.label || '生成'}</span>
          <button className="ml-auto rounded p-1 text-ink-3 transition hover:bg-soft hover:text-ink" onClick={close}>
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {/* ── 参考素材缩略图条（@ 指代关系）────────────────── */}
          {inputs.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {inputs.chips.map((c) => (
                <span
                  key={c.key}
                  className="flex items-center gap-1 rounded-md border border-edge bg-input py-0.5 pl-0.5 pr-1.5 text-[10px] text-ink-2"
                  title={c.title}
                >
                  {c.thumb && c.ctype === 'image' ? (
                    <img src={c.thumb} alt="" className="h-5 w-5 rounded object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-soft text-[9px]">
                      {c.ctype === 'video' ? '🎬' : c.ctype === 'audio' ? '🎵' : '🖼'}
                    </span>
                  )}
                  <b className="text-brand-400">{c.token}</b>
                  <span className="max-w-[80px] truncate text-ink-3">{c.title}</span>
                </span>
              ))}
            </div>
          )}

          {/* ── 提示词 ─────────────────────────────────────── */}
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[11px] text-ink-2">
              <span>提示词{inputs.chips.length > 0 && '（用 @image1 @video1 指代上方素材）'}</span>
              <span className="text-[10px] text-ink-3">{prompt.length} 字</span>
            </span>
            <textarea
              className={`${inputCls} min-h-[110px] resize-y`}
              placeholder={meta?.hint || '描述你想要的效果'}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              autoFocus
            />
          </label>

          {/* ── 高级参数 ───────────────────────────────────── */}
          <button className="text-[10px] text-ink-3 underline" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? '收起高级参数' : '高级参数（负面词 / 种子）'}
          </button>
          {showAdvanced && (
            <div className="space-y-2">
              <textarea
                className={`${inputCls} min-h-[48px] resize-y`}
                placeholder="负面提示词：不想要出现的内容"
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
              />
              <input
                type="number"
                className={inputCls}
                placeholder="随机种子（留空则随机）"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* ── 底部条：模型 + 参数 + 提交（对标 PixVerse 底栏）────── */}
        <div className="shrink-0 space-y-2 border-t border-edge px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 block">
              <span className="mb-1 block text-[11px] text-ink-2">模型</span>
              <select className={inputCls} value={effectiveSel} onChange={(e) => setSel(e.target.value)}>
                <option value="">选择模型…</option>
                {pool.candidates.length > 0 && (
                  <optgroup label={`候选池 · ${scene === 'image' ? '出图' : '出视频'}`}>
                    {pool.candidates.map((c) => (
                      <option key={c.id} value={`pool::${c.id}`}>
                        {c.label}
                        {c.id === pool.default ? '（默认）' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="模型库（全部）">
                  {profiles.map((p) => (
                    <option key={p.id} value={`profile::${p.id}`}>
                      {p.name}
                      {modelOf(p, d.content_type) ? ` · ${modelOf(p, d.content_type)}` : ''}
                    </option>
                  ))}
                </optgroup>
              </select>
              {pool.candidates.length === 0 && (
                <span className="mt-1 block text-[10px] text-amber-400">
                  候选池为空：可在「设置 → 画布」里为{scene === 'image' ? '出图' : '出视频'}配多个候选模型（含 ComfyUI）
                </span>
              )}
            </label>
            {!isAudio && (
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-2">比例</span>
                <select className={inputCls} value={ratio} onChange={(e) => setRatio(e.target.value)}>
                  {ASPECT_RATIOS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isVideo && (
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-2">时长</span>
                <select className={inputCls} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  {DURATION_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s} 秒
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!isAudio && !isVideo && (
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-2">清晰度</span>
                <select className={inputCls} value={quality} onChange={(e) => setQuality(e.target.value)}>
                  {QUALITY_OPTIONS.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!isAudio && (
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-2">一次生成</span>
                <select className={inputCls} value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {CREATE_COUNT_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} {isVideo ? '条' : '张'}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <button
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
            onClick={() => void onSubmit()}
            disabled={busy || running || !prompt.trim()}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {busy ? '生成中…' : '生成'}
          </button>
        </div>
      </div>
    </div>
  )
}
