// 生成节点 —— 画布的「能力」
// 选一个模型 + 写提示词 + 连上上游素材 → 跑一次出一张图 / 一段视频 / 一段音频。
// 它不关心你在做什么题材：画角色、改海报、重拍分镜，换的只是提示词和模型。
// 图生视频额外提供「首帧 / 尾帧」两个专用输入点（对标 PixVerse 的 firstFrame/lastFrame 连线）。
import { useMemo, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { Sparkles, Loader2, Wand2, Link2, Save } from 'lucide-react'
import { usePvStore } from '../store'
import type { ContentType, PvNodeData } from '../types'
import { ASPECT_RATIOS, CREATE_COUNT_OPTIONS, DURATION_OPTIONS, QUALITY_OPTIONS } from '../types'
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

/** @mention 芯片的配色（按素材形态分色，跟连线颜色一致） */
const MENTION_COLOR: Record<string, string> = {
  image: '#0ea5e9',
  video: '#ec4899',
  audio: '#14b8a6',
}

/** 开关（配音 / 多镜头） */
function Toggle({
  label,
  icon,
  checked,
  onChange,
}: {
  label: string
  icon: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      className="nodrag flex flex-1 items-center justify-between rounded-md border border-edge bg-input px-2 py-1.5"
      onClick={() => onChange(!checked)}
    >
      <span className="text-[11px] text-ink-2">
        {icon} {label}
      </span>
      <span
        className="relative h-[16px] w-[28px] shrink-0 rounded-full transition"
        style={{ background: checked ? 'var(--brand)' : 'var(--lw-edge)' }}
      >
        <span
          className="absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white transition-all"
          style={{ left: checked ? 14 : 2 }}
        />
      </span>
    </button>
  )
}

/** 已连入素材的缩略图芯片（@image1 指代关系一目了然） */
function RefChip({
  thumb,
  token,
  title,
  color,
  ring,
}: {
  thumb?: string
  token: string
  title: string
  color: string
  ring?: string
}) {
  return (
    <span
      className="flex items-center gap-1 rounded-md border border-edge bg-input py-0.5 pl-0.5 pr-1.5 text-[10px] text-ink-2"
      style={ring ? { borderColor: ring } : undefined}
      title={title}
    >
      {thumb ? (
        <img src={thumb} alt="" className="h-4 w-4 rounded object-cover" loading="lazy" />
      ) : (
        <span className="h-4 w-4 rounded" style={{ background: `${color}33` }} />
      )}
      <b style={{ color }}>{token}</b>
      <span className="max-w-[72px] truncate text-ink-3">{title}</span>
    </span>
  )
}

export function GenerateNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as PvNodeData
  const nodes = usePvStore((s) => s.nodes)
  const edges = usePvStore((s) => s.edges)
  const updateNodeData = usePvStore((s) => s.updateNodeData)
  const runNode = usePvStore((s) => s.runNode)
  const addReferenceNode = usePvStore((s) => s.addReferenceNode)
  const running = usePvStore((s) => s.running)
  const profiles = useProfiles(d.content_type)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const params = d.params
  const genType = params?.gen_type
  const meta = genType ? GEN_TYPE_META[genType] : undefined
  const color = nodeColor(d)
  const busy = d.status === 'running'

  // 从连线实时算出这个节点吃到了哪些输入（PixVerse 的「连线即输入」）
  // mention 编号与 store.collectInputs 的顺序保持一致：普通连线按边的先后数图片/视频
  const inputs = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const chips: {
      key: string
      token: string
      title: string
      thumb?: string
      ctype: string
      conn: 'manual' | 'firstFrame' | 'lastFrame'
    }[] = []
    const acc = { images: 0, videos: 0, audios: 0 }
    for (const e of edges) {
      if (e.target !== id) continue
      const src = byId.get(e.source)
      const sd = src?.data as unknown as PvNodeData | undefined
      if (!sd) continue
      const p = String(sd.file_path || sd.url || '')
      if (!p) continue
      const connRaw = (e.data as Record<string, unknown> | undefined)?.connectionType
      const conn =
        connRaw === 'firstFrame' || e.targetHandle === 'ff'
          ? ('firstFrame' as const)
          : connRaw === 'lastFrame' || e.targetHandle === 'lf'
            ? ('lastFrame' as const)
            : ('manual' as const)
      // mention 编号只数普通连线：首尾帧专线在后端不进 reference_images 列表，
      // 若把它们也数进去，UI 显示的 @imageN 会跟后端装配顺序错开
      if (conn === 'manual') {
        if (sd.content_type === 'image') acc.images += 1
        else if (sd.content_type === 'video') acc.videos += 1
        else if (sd.content_type === 'audio') acc.audios += 1
      }
      const token =
        conn === 'firstFrame'
          ? '首帧'
          : conn === 'lastFrame'
            ? '尾帧'
            : sd.content_type === 'image'
              ? `@image${acc.images}`
              : sd.content_type === 'video'
                ? `@video${acc.videos}`
                : `@audio${acc.audios}`
      chips.push({
        key: e.id,
        token,
        title: sd.title || '',
        thumb: String(sd.thumbnail_url || sd.url || '') || undefined,
        ctype: sd.content_type,
        conn,
      })
    }
    return { chips, ...acc }
  }, [nodes, edges, id])

  // 底部摘要统计连入总数（含首尾帧），mention 编号另算（只数普通连线）
  const totalImages = inputs.chips.filter((c) => c.ctype === 'image').length
  const totalVideos = inputs.chips.filter((c) => c.ctype === 'video').length
  const totalAudios = inputs.chips.filter((c) => c.ctype === 'audio').length
  const totalInputs = totalImages + totalVideos + totalAudios
  const isVideo = d.content_type === 'video'
  const isAudio = d.content_type === 'audio'
  const isI2V = genType === 'image_to_video'

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

  const onSaveAsAsset = () => {
    const newId = addReferenceNode(id)
    if (newId) {
      emitLog({
        nodeId: id,
        nodeLabel: d.title,
        nodeType: 'pv_generate',
        status: 'completed',
        message: '产物已另存为引用素材节点',
      })
    }
  }

  return (
    <PvNodeShell
      id={id}
      data={d}
      selected={selected}
      color={color}
      icon={<Sparkles size={14} />}
      preview={d.url ? <PvPreview data={d} /> : undefined}
      // 图生视频：首帧/尾帧两个专用输入点（对标 PixVerse firstFrame/lastFrame 连线语义）
      customTargetHandles={
        isI2V ? (
          <>
            <Handle
              id="ff"
              type="target"
              position={Position.Left}
              className="!z-10 !h-3.5 !w-3.5 !border-2"
              style={{ top: '32%', borderColor: '#22c55e', background: '#22c55e' }}
              isConnectableStart={false}
            />
            <Handle
              id="lf"
              type="target"
              position={Position.Left}
              className="!z-10 !h-3.5 !w-3.5 !border-2"
              style={{ top: '68%', borderColor: '#fb7185', background: '#fb7185' }}
              isConnectableStart={false}
            />
            <span
              className="pointer-events-none absolute -left-9 z-10 rounded px-1 py-px text-[9px] text-white"
              style={{ top: '32%', transform: 'translateY(-50%)', background: '#16a34a' }}
            >
              首帧
            </span>
            <span
              className="pointer-events-none absolute -left-9 z-10 rounded px-1 py-px text-[9px] text-white"
              style={{ top: '68%', transform: 'translateY(-50%)', background: '#e11d48' }}
            >
              尾帧
            </span>
          </>
        ) : undefined
      }
      footer={
        <div className="flex items-center gap-2 text-[10px] text-ink-3">
          <span className="truncate">{d.model || '未选模型'}</span>
          {totalInputs > 0 && (
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <Link2 size={10} />
              {totalImages > 0 && `${totalImages}图`}
              {totalVideos > 0 && `${totalVideos}视频`}
              {totalAudios > 0 && `${totalAudios}音频`}
            </span>
          )}
        </div>
      }
    >
      {/* ── 已连入素材缩略图条（@ 指代关系可视化）────────────────── */}
      {inputs.chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {inputs.chips.map((c) => (
            <RefChip
              key={c.key}
              thumb={c.thumb}
              token={c.token}
              title={c.title}
              color={
                c.conn === 'firstFrame' ? '#22c55e' : c.conn === 'lastFrame' ? '#fb7185' : MENTION_COLOR[c.ctype]
              }
              ring={c.conn === 'firstFrame' ? '#22c55e88' : c.conn === 'lastFrame' ? '#fb718588' : undefined}
            />
          ))}
        </div>
      )}

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
          提示词里用
          <code className="mx-1 rounded bg-input px-1">@image1</code>
          <code className="mx-1 rounded bg-input px-1">@video1</code>
          指代上面连入的素材（编号从左到右）
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

      {/* ── 视频专属：配音 / 多镜头（参考站 audio / multi_shot）────── */}
      {isVideo && (
        <div className="flex gap-2">
          <Toggle
            label="生成配音"
            icon="🔊"
            checked={Boolean(params?.audio)}
            onChange={(v) => patchParams({ audio: v })}
          />
          <Toggle
            label="多镜头分镜"
            icon="🎬"
            checked={Boolean(params?.multi_shot)}
            onChange={(v) => patchParams({ multi_shot: v })}
          />
        </div>
      )}

      {/* ── 批量数量（参考站 create_count）────────────────────────── */}
      {!isAudio && (
        <label className="block">
          <span className="mb-1 block text-[11px] text-ink-2">一次生成</span>
          <select
            className={inputCls}
            value={params?.create_count ?? 1}
            onChange={(e) => patchParams({ create_count: Number(e.target.value) })}
          >
            {CREATE_COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} {isVideo ? '条' : '张'}
              </option>
            ))}
          </select>
        </label>
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

      {/* ── 产物另存为引用素材（参考站 action_type=reference）─────── */}
      {d.status === 'completed' && d.url && (
        <button
          className="nodrag flex w-full items-center justify-center gap-1.5 rounded-lg border border-edge bg-soft px-3 py-1.5 text-[11px] text-ink-2 transition hover:bg-hover hover:text-ink"
          onClick={onSaveAsAsset}
          title="把这次产物变成一个独立的素材节点，可以继续连给别的生成节点"
        >
          <Save size={12} />
          另存为引用素材
        </button>
      )}
    </PvNodeShell>
  )
}
