// 生成节点 —— 画布的「能力」
// 选一个模型 + 写提示词 + 连上上游素材 → 跑一次出一张图 / 一段视频 / 一段音频。
// 它不关心你在做什么题材：画角色、改海报、重拍分镜，换的只是提示词和模型。
import { useMemo, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Sparkles, Loader2, Wand2, Link2 } from 'lucide-react'
import { usePvStore } from '../store'
import type { ContentType, PvNodeData } from '../types'
import { ASPECT_RATIOS, DURATION_OPTIONS, QUALITY_OPTIONS } from '../types'
import { GEN_TYPE_META, nodeColor } from '../registry'
import { useProfiles, type Profile } from '../useProfiles'
import { PvNodeShell, PvPreview } from './PvNodeShell'
import { emitLog } from '../../components/LogPanel'

const inputCls =
  'nodrag nowheel w-full rounded-md border border-edge bg-input px-2 py-1.5 text-xs text-ink outline-none transition focus:border-brand-500 placeholder:text-ink-3'

/** 内容形态 → 后端 scene key（用于取档位里该场景专属的模型名） */
const SCENE_OF: Record<ContentType, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  text: 'prompt',
}

/** 某个档位在这个形态下实际用的模型名 */
function modelOf(p: Profile, contentType: ContentType): string {
  const override = p.scene_models?.[SCENE_OF[contentType]]
  return override || p.model || ''
}

export function GenerateNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as PvNodeData
  const nodes = usePvStore((s) => s.nodes)
  const edges = usePvStore((s) => s.edges)
  const updateNodeData = usePvStore((s) => s.updateNodeData)
  const runNode = usePvStore((s) => s.runNode)
  const running = usePvStore((s) => s.running)
  const profiles = useProfiles(d.content_type)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const params = d.params
  const genType = params?.gen_type
  const meta = genType ? GEN_TYPE_META[genType] : undefined
  const color = nodeColor(d)
  const busy = d.status === 'running'

  // 从连线实时算出这个节点吃到了哪些输入（PixVerse 的「连线即输入」）
  const inputs = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const acc = { images: 0, videos: 0, audios: 0 }
    for (const e of edges) {
      if (e.target !== id) continue
      const src = byId.get(e.source)
      const sd = src?.data as unknown as PvNodeData | undefined
      if (!sd) continue
      const p = String(sd.file_path || sd.url || '')
      if (!p) continue
      if (sd.content_type === 'image') acc.images += 1
      else if (sd.content_type === 'video') acc.videos += 1
      else if (sd.content_type === 'audio') acc.audios += 1
    }
    return acc
  }, [nodes, edges, id])

  const totalInputs = inputs.images + inputs.videos + inputs.audios
  const isVideo = d.content_type === 'video'
  const isAudio = d.content_type === 'audio'

  const patchParams = (patch: Partial<NonNullable<PvNodeData['params']>>) => {
    updateNodeData(id, { params: { ...(params as NonNullable<PvNodeData['params']>), ...patch } } as Partial<PvNodeData>)
  }

  const pickProfile = (pid: string) => {
    const p = profiles.find((x) => x.id === pid)
    updateNodeData(id, {
      profile_id: pid,
      model: p ? modelOf(p, d.content_type) : '',
    } as Partial<PvNodeData>)
  }

  const onRun = async () => {
    await runNode(id)
    const after = usePvStore.getState().nodes.find((n) => n.id === id)
    const st = (after?.data as unknown as PvNodeData)?.status
    emitLog({
      nodeId: id,
      nodeLabel: d.title,
      nodeType: 'pv_generate',
      status: st === 'completed' ? 'completed' : st === 'failed' ? 'failed' : 'running',
      message: st === 'completed' ? '生成完成' : st === 'failed' ? '生成失败' : '开始生成',
    })
  }

  return (
    <PvNodeShell
      id={id}
      data={d}
      selected={selected}
      color={color}
      icon={<Sparkles size={14} />}
      preview={d.url ? <PvPreview data={d} /> : undefined}
      footer={
        <div className="flex items-center gap-2 text-[10px] text-ink-3">
          <span className="truncate">{d.model || '未选模型'}</span>
          {totalInputs > 0 && (
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <Link2 size={10} />
              {inputs.images > 0 && `${inputs.images}图`}
              {inputs.videos > 0 && `${inputs.videos}视频`}
              {inputs.audios > 0 && `${inputs.audios}音频`}
            </span>
          )}
        </div>
      }
    >
      {/* ── 提示词 ─────────────────────────────────────────────── */}
      <label className="block">
        <span className="mb-1 flex items-center gap-1 text-[11px] text-ink-2">
          <Wand2 size={11} /> 提示词
        </span>
        <textarea
          className={`${inputCls} min-h-[72px] resize-y`}
          placeholder={meta?.hint || '描述你想要的效果'}
          value={params?.prompt || ''}
          onChange={(e) => patchParams({ prompt: e.target.value })}
        />
      </label>

      {totalInputs > 0 && (
        <div className="rounded-md bg-soft px-2 py-1 text-[10px] leading-relaxed text-ink-3">
          已连入 {inputs.images} 张图 / {inputs.videos} 段视频，提示词里可用
          <code className="mx-1 rounded bg-input px-1">@image1</code>
          <code className="mx-1 rounded bg-input px-1">@video1</code>
          指代
        </div>
      )}

      {/* ── 模型 ───────────────────────────────────────────────── */}
      <label className="block">
        <span className="mb-1 block text-[11px] text-ink-2">模型</span>
        <select
          className={inputCls}
          value={d.profile_id || ''}
          onChange={(e) => pickProfile(e.target.value)}
        >
          <option value="">选择模型…</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {modelOf(p, d.content_type) ? ` · ${modelOf(p, d.content_type)}` : ''}
            </option>
          ))}
        </select>
        {profiles.length === 0 && (
          <span className="mt-1 block text-[10px] text-amber-400">
            没有可用模型，去右上角「模型」里配置
          </span>
        )}
      </label>

      {/* ── 参数 ───────────────────────────────────────────────── */}
      {!isAudio && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-2">比例</span>
            <select
              className={inputCls}
              value={params?.aspect_ratio || '16:9'}
              onChange={(e) => patchParams({ aspect_ratio: e.target.value })}
            >
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          {isVideo ? (
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-2">时长</span>
              <select
                className={inputCls}
                value={params?.duration ?? 5}
                onChange={(e) => patchParams({ duration: Number(e.target.value) })}
              >
                {DURATION_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s} 秒
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-2">清晰度</span>
              <select
                className={inputCls}
                value={params?.quality || '1080p'}
                onChange={(e) => patchParams({ quality: e.target.value })}
              >
                {QUALITY_OPTIONS.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <button
        className="nodrag w-full text-[10px] text-ink-3 underline"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? '收起高级参数' : '高级参数（负面词 / 种子）'}
      </button>

      {showAdvanced && (
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-2">负面提示词</span>
            <textarea
              className={`${inputCls} min-h-[48px] resize-y`}
              placeholder="不想要出现的内容"
              value={params?.negative || ''}
              onChange={(e) => patchParams({ negative: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-2">随机种子</span>
            <input
              type="number"
              className={inputCls}
              placeholder="留空则随机"
              value={params?.seed ?? ''}
              onChange={(e) =>
                patchParams({ seed: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </label>
        </div>
      )}

      {/* ── 生成按钮 ───────────────────────────────────────────── */}
      <button
        className="nodrag flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={onRun}
        disabled={busy || running}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
        {busy ? '生成中…' : d.status === 'completed' ? '重新生成' : '生成'}
      </button>
    </PvNodeShell>
  )
}
