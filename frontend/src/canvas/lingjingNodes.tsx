// =====================================================================
// 灵境风格节点组件 — 原版架构复刻（活节点版）
// 对应京东云灵境画布的 7 种节点类型，视觉与信息结构照原版还原：
//   image-source（素材图）/ image-config（图片生成）/ video-config（视频生成）
//   text-config（文本生成）/ script-config（剧本生成）
//   storyboard-config（分镜脚本表）/ video-clip（剪辑合成）
// 交互对齐灵境架构：
//   · 生成类节点带内联「生成」按钮 → ljEngine 执行
//   · 结果多版本 resource 条，点选切换 selectedIndex
//   · 输入数量实时来自连线（连线即输入）
// 全部走 NodeShell 语义色（CSS 变量），明暗主题自动切换。
// =====================================================================
import { useMemo, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Film, ImageIcon, ListVideo, Loader2, Pause, PenLine, Play, Clapperboard, Camera, Captions } from 'lucide-react'
import { useCanvasStore } from '../store/canvasStore'
import NodeShell from './NodeShell'
import LjAiChat from './LjAiChat'
import { runLjNode, captureFrame, type LjResource } from './ljEngine'

type AnyObj = Record<string, unknown>

function asObj(v: unknown): AnyObj {
  return v && typeof v === 'object' ? (v as AnyObj) : {}
}

const excerptCls =
  'nodrag nowheel max-h-28 overflow-y-auto rounded-md border border-edge bg-input px-2 py-1.5 text-[11px] leading-relaxed text-ink-2 whitespace-pre-wrap break-words'

/** 模型徽标（如「图片 2.1」「视频 2.1」） */
function ModelBadge({ model }: { model?: string }) {
  if (!model) return null
  const isVideo = model.includes('视频')
  const isImage = model.includes('图片')
  return (
    <span
      className={`nodrag inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        isVideo
          ? 'bg-pink-500/15 text-pink-500'
          : isImage
            ? 'bg-sky-500/15 text-sky-500'
            : 'bg-violet-500/15 text-violet-400'
      }`}
    >
      {isVideo ? <Film size={10} /> : isImage ? <ImageIcon size={10} /> : <PenLine size={10} />}
      {model}
    </span>
  )
}

/** 参数小标签行 */
function ParamChips({ items }: { items: (string | null | undefined)[] }) {
  const chips = items.filter(Boolean) as string[]
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span key={c} className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-3">
          {c}
        </span>
      ))}
    </div>
  )
}

/** 版本资源条：多版本缩略图，点选切换（灵境 resources/selectedIndex 复刻） */
function VersionStrip({ id, resources, selectedIndex }: { id: string; resources: LjResource[]; selectedIndex: number }) {
  const update = useCanvasStore((s) => s.updateObject)
  if (!resources.length) return null
  return (
    <div className="flex items-center gap-1">
      {resources.slice(-6).map((r, i) => {
        const realIdx = resources.length > 6 ? resources.length - 6 + i : i
        const active = realIdx === selectedIndex
        return (
          <button
            key={r.id}
            className={`nodrag relative h-9 w-9 shrink-0 overflow-hidden rounded border transition ${
              active ? 'border-brand-400 ring-1 ring-brand-400' : 'border-edge opacity-70 hover:opacity-100'
            }`}
            title={`版本 ${realIdx + 1}`}
            onClick={() => update(id, { selectedIndex: realIdx })}
          >
            <img src={r.cover ?? r.url} alt={`v${realIdx + 1}`} className="h-full w-full object-cover" draggable={false} />
            <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-0.5 text-[8px] leading-3 text-white">
              {realIdx + 1}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** 内联生成按钮（灵境式：节点上直接执行） */
function GenerateButton({ id, busy }: { id: string; busy: boolean }) {
  return (
    <button
      className="nodrag nowheel flex w-full items-center justify-center gap-1 rounded-md bg-brand-600 px-2 py-1.5 text-sm text-white transition hover:bg-brand-500 disabled:opacity-50"
      disabled={busy}
      onClick={() => void runLjNode(id)}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
      {busy ? '生成中…' : '生成'}
    </button>
  )
}

function useLjData(id: string, data: unknown) {
  const d = asObj(data)
  // 连线即输入：实时统计上游数量
  const inputCount = useCanvasStore((s) => s.edges.filter((e) => e.target === id).length)
  return useMemo(() => {
    const media = asObj(d._media)
    const params = asObj(d._params)
    const resources = Array.isArray(d.resources) ? (d.resources as LjResource[]) : []
    const selectedIndex = typeof d.selectedIndex === 'number' ? d.selectedIndex : Math.max(0, resources.length - 1)
    // 当前展示资源：优先用户生成的版本，回退导入快照
    const cur = resources[selectedIndex]
    return {
      d,
      resources,
      selectedIndex,
      curUrl: cur?.url ?? String(media.url ?? ''),
      curCover: cur?.cover ?? String(media.cover ?? ''),
      kind: cur?.kind ?? String(media.kind ?? 'image'),
      params,
      prompt: String(d.prompt ?? params.prompt ?? ''),
      contentHtml: String(d.content ?? ''),
      model: String(d.model ?? params.model_name ?? ''),
      inputCount,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, inputCount])
}

/** 素材图节点（image-source）：原图预览 + 可编辑地址提示 */
export function LjImageSource({ data, selected }: NodeProps) {
  const { d, curCover } = useLjData('', data)
  const label = String(d.label ?? '素材图')
  return (
    <NodeShell title={label} color="#64748b" selected={!!selected} status={String(d.status ?? 'idle')}>
      {curCover ? (
        <img src={curCover} alt={label} className="w-full rounded-md object-contain" draggable={false} />
      ) : (
        <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-edge bg-soft text-[11px] text-ink-3">
          无预览
        </div>
      )}
    </NodeShell>
  )
}

/** 图片生成节点（image-config） */
export function LjImageConfig({ id, data, selected }: NodeProps) {
  const { d, curCover, prompt, model, resources, selectedIndex } = useLjData(String(id), data)
  const label = String(d.label ?? '图片生成')
  const busy = String(d.status ?? 'idle') === 'running'
  return (
    <NodeShell title={label} color="#0ea5e9" selected={!!selected} status={String(d.status ?? 'idle')}>
      <div className="nodrag nowheel flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-1">
          <ModelBadge model={model || '图片'} />
          <InputCountHint id={String(id)} />
        </div>
        {prompt && <div className={excerptCls}>{prompt.slice(0, 260)}</div>}
        {curCover ? (
          <img src={curCover} alt={label} className="w-full rounded-md object-cover" draggable={false} />
        ) : null}
        <VersionStrip id={String(id)} resources={resources} selectedIndex={selectedIndex} />
        <GenerateButton id={String(id)} busy={busy} />
      </div>
    </NodeShell>
  )
}

/** 上游输入提示（连线即输入） */
function InputCountHint({ id }: { id: string }) {
  const count = useCanvasStore((s) => s.edges.filter((e) => e.target === id).length)
  if (!count) return null
  return <span className="text-[10px] text-ink-3">参考 ×{count}</span>
}

/** 视频生成节点（video-config）：多参考 + 时长/分辨率/音效参数 + 播放取帧 + 字幕开关 */
export function LjVideoConfig({ id, data, selected }: NodeProps) {
  const nid = String(id)
  const { d, curCover, curUrl, kind, prompt, model, params, resources, selectedIndex } = useLjData(nid, data)
  const label = String(d.label ?? '视频生成')
  const busy = String(d.status ?? 'idle') === 'running'
  const duration = Number(d.duration ?? params.duration ?? 0) || undefined
  const resolution = [d.width, d.height].every(Boolean) ? `${d.width}×${d.height}` : String(params.mode ?? '')
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [framing, setFraming] = useState('')
  const update = useCanvasStore((s) => s.updateObject)

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      void v.play()
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }

  const grab = async (mode: 'first' | 'last' | 'current') => {
    if (!curUrl || framing) return
    setFraming(mode)
    const ts = mode === 'current' ? (videoRef.current?.currentTime ?? 0) : undefined
    await captureFrame(nid, mode, ts)
    setFraming('')
  }

  const subtitleOn = d.subtitle === true
  return (
    <NodeShell title={label} color="#ec4899" selected={!!selected} status={String(d.status ?? 'idle')}>
      <div className="nodrag nowheel flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-1">
          <ModelBadge model={model || '视频'} />
          <InputCountHint id={nid} />
        </div>
        <ParamChips
          items={[
            duration ? `⏱ ${duration}s` : null,
            resolution ? `🖥 ${resolution}` : null,
            params.generate_audio === true || d.generate_audio === true ? '🔊 音效' : null,
            subtitleOn ? '💬 字幕' : null,
            d.fps ? `${d.fps}fps` : null,
          ]}
        />
        {prompt && <div className={excerptCls}>{prompt.slice(0, 260)}</div>}
        {kind === 'video' && curUrl ? (
          <div className="flex flex-col gap-1">
            <video ref={videoRef} src={curUrl} className="w-full rounded-md" muted loop playsInline
              onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
            <div className="flex items-center gap-1">
              <button className="nodrag rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-2 hover:text-ink" onClick={togglePlay} title="播放/暂停">
                {playing ? <Pause size={11} /> : <Play size={11} />}
              </button>
              <button className="nodrag rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-2 hover:text-brand-400" onClick={() => grab('first')} title="截取首帧">
                {framing === 'first' ? '…' : '首帧'}
              </button>
              <button className="nodrag rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-2 hover:text-brand-400" onClick={() => grab('current')} title="截取当前画面">
                <Camera size={11} /> 当前
              </button>
              <button className="nodrag rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-2 hover:text-brand-400" onClick={() => grab('last')} title="截取尾帧">
                {framing === 'last' ? '…' : '尾帧'}
              </button>
              <button
                className={`nodrag rounded px-1.5 py-0.5 text-[10px] transition ${subtitleOn ? 'bg-brand-500/20 text-brand-400' : 'bg-soft text-ink-2 hover:text-ink'}`}
                onClick={() => update(nid, { subtitle: !subtitleOn })}
                title="字幕开关"
              >
                <Captions size={11} /> {subtitleOn ? '字幕开' : '字幕'}
              </button>
            </div>
          </div>
        ) : curCover ? (
          <img src={curCover} alt={label} className="w-full rounded-md object-cover" draggable={false} />
        ) : null}
        <VersionStrip id={nid} resources={resources} selectedIndex={selectedIndex} />
        <GenerateButton id={nid} busy={busy} />
      </div>
    </NodeShell>
  )
}

/** 文本/剧本类节点（text-config / script-config）：LLM 产出 + 可再生成 */
export function LjTextLikeConfig({ id, data, selected, kind }: NodeProps & { kind: 'text' | 'script' }) {
  const nid = String(id)
  const { d, prompt, contentHtml } = useLjData(nid, data)
  const label = String(d.label ?? (kind === 'script' ? '剧本生成' : '文本生成'))
  const brief = String(asObj(d._params).brief ?? '')
  // 展示内容优先用户重跑结果（data.text），回退导入快照 HTML
  const plain = useMemo(() => {
    const src = String(d.text ?? '') || contentHtml
    return src
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }, [d.text, contentHtml])
  return (
    <NodeShell
      title={label}
      color={kind === 'script' ? '#f97316' : 'var(--brand)'}
      selected={!!selected}
      status={String(d.status ?? 'idle')}
    >
      <div className="nodrag nowheel flex flex-col gap-1.5">
        {brief && !prompt && (
          <div className="rounded-md border border-edge bg-soft px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
            📝 {brief.slice(0, 160)}
          </div>
        )}
        {/* 点文本框本身在其正下方弹出 AI 对话窗（仿京东云灵镜） */}
        <LjAiChat nodeId={nid} kind={kind} />
        {plain ? (
          <div className={`${excerptCls} max-h-40`}>{plain.slice(0, 800)}</div>
        ) : (
          <div className="flex h-10 items-center justify-center rounded-md border border-dashed border-edge bg-soft text-[11px] text-ink-3">
            点上方文本框唤出 AI 对话，生成内容显示于此
          </div>
        )}
      </div>
    </NodeShell>
  )
}

/** 分镜脚本表节点（storyboard-config） */
export function LjStoryboardConfig({ id, data, selected }: NodeProps) {
  const nid = String(id)
  const { d, prompt } = useLjData(nid, data)
  const label = String(d.label ?? '分镜脚本')
  const columns = Array.isArray(d.columns) ? (d.columns as AnyObj[]) : []
  const rows = Array.isArray(d.rows) ? d.rows : Array.isArray(d.value) ? d.value : []
  const busy = String(d.status ?? 'idle') === 'running'
  return (
    <NodeShell title={label} color="#f59e0b" selected={!!selected} status={String(d.status ?? 'idle')}>
      <div className="nodrag nowheel flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <ListVideo size={12} /> {rows.length} 个镜头 · {columns.length} 列
        </div>
        {columns.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {columns.map((c, i) => (
              <span key={i} className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-2">
                {String(c.headerName ?? c.field ?? '')}
              </span>
            ))}
          </div>
        )}
        {String(d.text ?? '') ? (
          <div className={`${excerptCls} max-h-32 whitespace-pre-wrap`}>{String(d.text).slice(0, 600)}</div>
        ) : rows.length > 0 ? (
          <div className={`${excerptCls} max-h-32 font-mono`}>
            {(rows as AnyObj[]).slice(0, 8).map((r, i) => (
              <div key={i} className="truncate">
                #{String(r.shotId ?? i + 1)} · {String(r.duration ?? '?')}s · {String(r.description ?? '').slice(0, 40)}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-10 items-center justify-center rounded-md border border-dashed border-edge bg-soft text-[11px] text-ink-3">
            分镜表为空，填写提示词后生成
          </div>
        )}
        {prompt ? <GenerateButton id={nid} busy={busy} /> : null}
      </div>
    </NodeShell>
  )
}

/** 剪辑合成节点（video-clip）：时间线片段结构展示 */
export function LjVideoClip({ data, selected }: NodeProps) {
  const { d, curUrl, kind } = useLjData('', data)
  const label = String(d.label ?? '剪辑合成')
  const clip = asObj(d.clipTimeline)
  const lines = Array.isArray(clip.lines) ? (clip.lines as AnyObj[]) : []
  const segments = lines.flatMap((l) => (Array.isArray(l.segments) ? (l.segments as AnyObj[]) : []))
  const totalUs = segments.reduce((acc, s) => acc + (Number(s.durationUs) || 0), 0)
  const totalSec = totalUs ? (totalUs / 1_000_000).toFixed(1) : null
  return (
    <NodeShell title={label} color="#22c55e" selected={!!selected} status={String(d.status ?? 'idle')}>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <Clapperboard size={12} />
          {segments.length} 个片段{totalSec ? ` · 总时长 ${totalSec}s` : ''}
        </div>
        {segments.length > 0 && (
          <div className={excerptCls}>
            {segments.slice(0, 8).map((s, i) => (
              <div key={i} className="truncate">
                ▶ {Number(s.startUs ?? 0) / 1_000_000}s —{' '}
                {(Number(s.startUs ?? 0) + Number(s.durationUs ?? 0)) / 1_000_000}s
              </div>
            ))}
          </div>
        )}
        {kind === 'video' && curUrl ? <video src={curUrl} className="w-full rounded-md" controls muted loop /> : null}
      </div>
    </NodeShell>
  )
}

/** 注册表：供 objectNodes / CanvasCore 使用 */
export const lingjingNodeTypes = {
  // ── 灵境原始类型（双保险：覆盖未经 convert 直接加载原版 JSON 的路径）──
  'image-source': LjImageSource,
  'image-config': LjImageConfig,
  'video-config': LjVideoConfig,
  'text-config': (props: NodeProps) => <LjTextLikeConfig {...props} kind="text" />,
  'script-config': (props: NodeProps) => <LjTextLikeConfig {...props} kind="script" />,
  'storyboard-config': LjStoryboardConfig,
  'video-clip': LjVideoClip,
  // ── convert 后的 lj_ 前缀类型（常规导入路径）──
  lj_image_source: LjImageSource,
  lj_image_config: LjImageConfig,
  lj_video_config: LjVideoConfig,
  lj_text_config: (props: NodeProps) => <LjTextLikeConfig {...props} kind="text" />,
  lj_script_config: (props: NodeProps) => <LjTextLikeConfig {...props} kind="script" />,
  lj_storyboard_config: LjStoryboardConfig,
  lj_video_clip: LjVideoClip,
}
