/**
 * 场景专业对象节点 —— 内容优先外壳（V2.8 UI 重构）
 *
 * 节点主体只展示生成结果（大图/视频/排版文本），下方提示词极简摘要（2 行截断，点击展开）。
 * 编辑能力全部收敛到弹窗（SceneNodeModal），由双击节点或悬浮工具栏（SceneHoverToolbar）打开。
 * 标题色按数据流分类（视觉橙黄/逻辑蓝紫/音频绿），连线色由 SceneCanvas 按 source 节点实例色渲染。
 */
import { memo, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Lock, LockOpen, Trash2, Copy, ChevronDown, ChevronUp, Play } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { useUiStore } from '../store/uiStore'
import { isStoryNode } from './sceneScript'
import { classifyFlow, FLOW_TITLE_COLORS } from './sceneColors'
import SceneHoverToolbar from './SceneHoverToolbar'

type Payload = Record<string, unknown>

const MATCH_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const NUMBERED_KINDS = new Set(['人物', '道具', '配音', 'BGM', '音效', '对白'])

/** 图片类字段候选 */
const IMAGE_KEYS = ['url', 'image', 'image_url', 'cover', 'thumbnail', 'main_image']
const VIDEO_KEYS = ['video', 'video_url']

function pick(payload: Payload, keys: string[]): string {
  for (const k of keys) {
    const v = payload[k]
    if (typeof v === 'string' && v.trim()) return v
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0]) return v[0] as string
  }
  return ''
}

function readable(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('、')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

interface ParsedShotForView {
  no: number
  location: string
  time: string
  goal: string
  bgm: string
  duration: string
  shots: { no: string; desc: string }[]
  dialogue: { speaker: string; emotion: string; line: string }[]
}
interface ParsedScriptForView {
  characters: string[]
  props: string[]
  shots: ParsedShotForView[]
}
const EMPTY_PARSED: ParsedScriptForView = { characters: [], props: [], shots: [] }

/** 匹配标签：图片(用途)/音频(类型) 连线剧情后按顺序编号 */
function computeMatchLabel(
  objects: { id: string; type?: string; data?: unknown }[],
  edges: { source: string; target: string }[],
  oid: string,
): string {
  const obj = objects.find((o) => o.id === oid)
  if (!obj) return ''
  const t = obj.type
  if (t !== 'image' && t !== 'audio') return ''
  const p = ((obj.data as Payload)?.payload || {}) as Payload
  const kind = t === 'audio' ? String(p.audio_type ?? '') : String(p.purpose ?? '')
  if (!kind) return ''
  const linked = edges
    .map((e) => (e.source === oid ? e.target : e.target === oid ? e.source : ''))
    .find((x) => !!x && isStoryNode(objects.find((o) => o.id === x)))
  if (!linked) return ''
  if (!NUMBERED_KINDS.has(kind)) return kind
  const order = edges
    .filter((e) => e.source === linked || e.target === linked)
    .map((e) => (e.source === linked ? e.target : e.source))
    .filter((x) => {
      const o = objects.find((o) => o.id === x)
      if (!o) return false
      if (t === 'audio') return o.type === 'audio' && String(((o.data as Payload)?.payload as Payload)?.audio_type ?? '') === kind
      return o.type === 'image' && String(((o.data as Payload)?.payload as Payload)?.purpose ?? '') === kind
    })
  const idx = order.indexOf(oid)
  if (idx < 0) return ''
  return `${kind}${MATCH_NUMS[idx] ?? idx + 1}`
}

/** 取摘要文本（提示词/描述/正文，按类型优先级） */
function summaryOf(objectType: string, payload: Payload): string {
  if (objectType === 'story') return String(payload.script || payload.text || payload.summary || '').trim()
  if (objectType === 'product') return String(payload.name || payload.info || '').trim()
  return String(payload.prompt || payload.desc || payload.text || '').trim()
}

const SceneObjectNode = memo(({ id, data, selected }: NodeProps) => {
  const objectType = String((data as Payload).objectType || 'text')
  const payload = ((data as Payload).payload || {}) as Payload
  const locked = (data as Payload).locked === true

  const meta = useSceneStore((s) => s.metaOf(objectType))
  const toggleLock = useSceneStore((s) => s.toggleLock)
  const deleteObjects = useSceneStore((s) => s.deleteObjects)
  const duplicateObjects = useSceneStore((s) => s.duplicateObjects)
  const openNodeModal = useSceneStore((s) => s.openNodeModal)
  const status = useSceneStore((s) => s.objectStatus[id])
  const objects = useSceneStore((s) => s.objects)
  const edges = useSceneStore((s) => s.edges)
  const openLightbox = useUiStore((s) => s.openLightbox)

  const matchLabel = computeMatchLabel(objects, edges, id)
  const imageUrl = pick(payload, IMAGE_KEYS)
  const videoUrl = pick(payload, VIDEO_KEYS)
  const audioUrl = String(payload.url ?? '')
  const summary = summaryOf(objectType, payload)
  const [expanded, setExpanded] = useState(false)

  // 导演台：从连线的剧情节点读剧本（精简展示）
  const directorStory = objectType === 'director'
    ? (() => {
        const sid = edges
          .map((e) => (e.source === id ? e.target : e.target === id ? e.source : ''))
          .find((x) => !!x && isStoryNode(objects.find((o) => o.id === x)))
        if (!sid) return null
        const so = objects.find((o) => o.id === sid)
        const pp = ((so?.data as Payload)?.payload as Payload) || {}
        return { script: String(pp.script ?? ''), parsed: (pp.parsed as ParsedScriptForView) || EMPTY_PARSED }
      })()
    : null

  // 视频参考资料（连到本视频节点的图片/音频）
  const videoRefs =
    objectType === 'video'
      ? edges
          .filter((e) => e.target === id)
          .map((e) => e.source)
          .filter((oid) => {
            const t = objects.find((o) => o.id === oid)?.type
            return t === 'image' || t === 'audio'
          })
      : []

  // 右键菜单
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    setCtx({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  const flow = classifyFlow(objectType)
  const titleColor = FLOW_TITLE_COLORS[flow]
  const title =
    readable(payload.name) || readable(payload.title) ||
    (objectType === 'shot' ? `镜头 ${readable(payload.shot_no) || '?'}` : '') ||
    (objectType === 'storyboard' ? `${readable(payload.scene) || '?'}-${readable(payload.shot) || '?'}` : '') ||
    meta.label

  return (
    <>
      <NodeResizer
        isVisible={!!selected && !locked}
        minWidth={200}
        minHeight={120}
        lineClassName="!border-brand-500"
        handleClassName="!h-2 !w-2 !rounded-sm !border-brand-500 !bg-white"
      />
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-brand-500" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-brand-500" />

      <div
        className={`canvas-node group flex h-full flex-col overflow-hidden rounded-xl text-[11px] transition ${
          selected ? 'ring-2 ring-[var(--lw-edge-active)]' : ''
        }`}
        style={{ height: '100%' }}
        onContextMenu={onContextMenu}
        onDoubleClick={() => openNodeModal(id)}
        title="双击打开编辑面板"
      >
        {/* 悬浮工具栏（悬停/选中浮现） */}
        <SceneHoverToolbar id={id} objectType={objectType} payload={payload} />

        {/* 标题栏：分类色条 + 类型名 + 状态 + 匹配标签 + 标题 */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-edge px-2 py-1.5">
          <span className="h-3 w-1 shrink-0 rounded-full" style={{ background: titleColor }} />
          <span className="shrink-0 text-[11px] font-medium" style={{ color: titleColor }}>
            {meta.label}
          </span>
          {status && status !== 'idle' && (
            <span
              className={`shrink-0 rounded-full px-1.5 text-[11px] leading-4 ${
                status === 'running'
                  ? 'animate-pulse bg-amber-400/20 text-amber-400'
                  : status === 'completed'
                    ? 'bg-emerald-400/20 text-emerald-400'
                    : status === 'failed'
                      ? 'bg-red-400/20 text-red-400'
                      : ''
              }`}
            >
              {status === 'running' ? '执行中' : status === 'completed' ? '完成' : status === 'failed' ? '失败' : status}
            </span>
          )}
          {matchLabel && (
            <span className="shrink-0 rounded-full bg-brand-500/15 px-1.5 text-[10px] font-medium text-brand-300">
              {matchLabel}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{title === meta.label ? '' : title}</span>
          <button
            className="nodrag shrink-0 rounded p-0.5 text-ink-3 transition hover:text-ink"
            title={locked ? '解锁' : '锁定'}
            onClick={() => toggleLock(id)}
          >
            {locked ? <Lock size={11} /> : <LockOpen size={11} />}
          </button>
          <button
            className="nodrag shrink-0 rounded p-0.5 text-ink-3 transition hover:text-red-400"
            title="删除"
            onClick={() => void deleteObjects([id])}
          >
            <Trash2 size={11} />
          </button>
        </div>

        {/* 主体：内容优先 —— 展示生成结果 */}
        <div className="nowheel min-h-0 flex-1 overflow-y-auto p-2">
          {videoUrl ? (
            <video src={videoUrl} controls className="mb-1.5 w-full rounded-lg bg-black" style={{ maxHeight: 220 }} />
          ) : imageUrl ? (
            <img
              src={imageUrl}
              alt={meta.label}
              className="mb-1.5 w-full cursor-zoom-in rounded-lg object-cover"
              style={{ maxHeight: 220 }}
              onClick={() => openLightbox(imageUrl)}
            />
          ) : null}

          {objectType === 'director' && directorStory ? (
            <div className="space-y-1.5 rounded-lg border border-brand-500/30 bg-brand-500/5 px-2 py-1.5">
              <div className="text-[10px] text-brand-300">
                🎬 剧本（来自剧情节点）
                {directorStory.parsed.shots.length > 0 && (
                  <span className="ml-1 text-ink-3">
                    · {directorStory.parsed.shots.length} 分镜 / {directorStory.parsed.characters.length} 人物 / {directorStory.parsed.props.length} 道具
                  </span>
                )}
              </div>
              <div className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded bg-soft px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
                {directorStory.script || '（剧情节点尚未生成剧本）'}
              </div>
            </div>
          ) : objectType === 'story' ? (
            <div className="whitespace-pre-wrap break-words rounded-lg bg-soft px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
              {summary || '（尚未生成剧本，双击打开编辑面板用 AI 生成）'}
            </div>
          ) : audioUrl ? (
            <audio src={audioUrl} controls className="w-full" />
          ) : (
            <div className="flex min-h-[46px] items-center justify-center rounded-lg border border-dashed border-edge px-2 py-2 text-[11px] text-ink-3">
              {objectType === 'image' ? '🖼 未生成图片' : objectType === 'video' ? '▶ 未生成视频' : objectType === 'audio' ? '♪ 未生成音频' : '双击打开编辑面板'}
            </div>
          )}

          {objectType === 'video' && videoRefs.length > 0 && (
            <div className="mt-1.5 rounded-lg border border-edge bg-soft px-2 py-1.5">
              <div className="mb-1 text-[10px] text-ink-3">视频参考资料（{videoRefs.length}）</div>
              <div className="flex flex-wrap gap-1">
                {videoRefs.map((oid) => {
                  const o = objects.find((x) => x.id === oid)
                  return (
                    <span key={oid} className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-2">
                      {o?.type === 'audio' ? '音频' : '图片'}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {/* 提示词极简摘要：2 行截断，点击展开 */}
          {summary && (
            <div
              className="mt-1.5 cursor-pointer rounded-lg border border-edge bg-canvas px-2 py-1.5"
              onClick={(e) => {
                e.stopPropagation()
                setExpanded((v) => !v)
              }}
            >
              <div className={`text-[10px] leading-snug text-ink-2 ${expanded ? '' : 'line-clamp-2'}`}>{summary}</div>
              <div className="mt-0.5 flex items-center gap-0.5 text-[9px] text-ink-3">
                {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
                {expanded ? '收起' : '展开提示词'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右键菜单 */}
      {ctx && (
        <div
          className="absolute z-50 min-w-[140px] overflow-hidden rounded-lg border border-edge bg-panel py-1 shadow-node-dark"
          style={{ left: ctx.x, top: ctx.y }}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => setCtx(null)}
        >
          <button
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-ink transition hover:bg-hover"
            onClick={() => void duplicateObjects([id])}
          >
            <Copy size={11} /> 复制为新对象
          </button>
          <button
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-ink transition hover:bg-hover"
            onClick={() => openNodeModal(id)}
          >
            <Play size={11} /> 打开编辑面板
          </button>
          <button
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-ink transition hover:bg-hover"
            onClick={() => toggleLock(id)}
          >
            {locked ? <LockOpen size={11} /> : <Lock size={11} />} {locked ? '解锁' : '锁定'}
          </button>
          <button
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-red-400 transition hover:bg-hover"
            onClick={() => void deleteObjects([id])}
          >
            <Trash2 size={11} /> 删除
          </button>
        </div>
      )}
    </>
  )
})

SceneObjectNode.displayName = 'SceneObjectNode'

export const sceneNodeTypes = { sceneObject: SceneObjectNode }
export default SceneObjectNode
