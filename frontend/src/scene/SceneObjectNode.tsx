/**
 * 场景专业对象节点 —— 内容优先外壳（V2.8 UI 重构）
 *
 * 节点主体只展示生成结果（大图/视频/排版文本），下方提示词极简摘要（2 行截断，点击展开）。
 * 编辑能力全部收敛到弹窗（SceneNodeModal），由双击节点或悬浮工具栏（SceneHoverToolbar）打开。
 * 标题色按数据流分类（视觉橙黄/逻辑蓝紫/音频绿），连线色由 SceneCanvas 按 source 节点实例色渲染。
 */
import { memo, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Lock, LockOpen, Trash2, Copy, ChevronDown, ChevronUp, Play, Loader2, Wand2 } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { useUiStore } from '../store/uiStore'
import { sceneRunAction } from '../api'
import { isStoryNode, isImageUrl } from './sceneScript'
import { classifyFlow, FLOW_TITLE_COLORS } from './sceneColors'
import SceneHoverToolbar from './SceneHoverToolbar'
import { StoryboardTable, STORYBOARD_TABLE_W } from './StoryboardView'

type Payload = Record<string, unknown>

const MATCH_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const NUMBERED_KINDS = new Set(['人物', '道具', '配音', 'BGM', '音效', '对白'])

/** 图片类字段候选 */
const IMAGE_KEYS = ['url', 'image', 'image_url', 'cover', 'thumbnail', 'main_image']
/** 视频类字段候选（含 url：本地上传/素材入库只写 url 字段） */
const VIDEO_KEYS = ['video', 'video_url', 'url']

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
  // 🔴 场景对象节点 type 恒为 sceneObject，真实类型在 data.objectType
  const t = String(((obj.data as Payload)?.objectType) ?? '')
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
      if (t === 'audio') return String(((o.data as Payload)?.objectType) ?? '') === 'audio' && String(((o.data as Payload)?.payload as Payload)?.audio_type ?? '') === kind
      return String(((o.data as Payload)?.objectType) ?? '') === 'image' && String(((o.data as Payload)?.payload as Payload)?.purpose ?? '') === kind
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
  const patchObject = useSceneStore((s) => s.patchObject)
  const resizeObject = useSceneStore((s) => s.resizeObject)
  const status = useSceneStore((s) => s.objectStatus[id])
  const objects = useSceneStore((s) => s.objects)
  const edges = useSceneStore((s) => s.edges)
  const openLightbox = useUiStore((s) => s.openLightbox)

  const matchLabel = computeMatchLabel(objects, edges, id)
  const imageUrl = pick(payload, IMAGE_KEYS)
  const videoUrl = pick(payload, VIDEO_KEYS)
  const audioUrl = objectType === 'audio' ? String(payload.url ?? '') : ''
  const summary = summaryOf(objectType, payload)
  const [expanded, setExpanded] = useState(false)
  const [genBusy, setGenBusy] = useState(false)
  const [genErr, setGenErr] = useState('')
  // 文本自适应：内容变化时自动撑高节点（上限 60vh），仍可手动拖拽调整
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const maybeGrow = () => {
      const maxH = Math.round(window.innerHeight * 0.6)
      // 内容被截断（scrollHeight > clientHeight）→ 撑高到内容高度（≤ 60vh）
      if (el.scrollHeight > el.clientHeight + 24) {
        resizeObject(id, el.offsetWidth || 300, Math.min(el.scrollHeight + 48, maxH))
      }
    }
    maybeGrow()
    const mo = new MutationObserver(maybeGrow)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => mo.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, summary, objectType, videoUrl, imageUrl])

  // 导演台骨架节点：待生成（无 url 但有 prompt）→ 节点上直接出图/出视频并回填
  const sceneId = useSceneStore((s) => s.currentSceneId)
  const genNode = async (kind: 'image' | 'video') => {
    if (!sceneId || genBusy) return
    setGenBusy(true)
    setGenErr('')
    try {
      const res = await sceneRunAction(sceneId, {
        action: kind === 'image' ? 'generate_node_image' : 'generate_node_video',
        object_ids: [id],
      })
      if (res.ok) {
        await useSceneStore.getState().openScene(sceneId)
      } else {
        setGenErr(String(res.data?.error || '生成失败'))
      }
    } catch (e) {
      setGenErr(String(e))
    } finally {
      setGenBusy(false)
    }
  }

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
            const t = String(((objects.find((o) => o.id === oid)?.data as Payload)?.objectType) ?? '')
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
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-brand-500 dark:!border-white/30" isConnectableStart={false} />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-brand-500 dark:!border-white/30" isConnectableEnd={false} />

      <div
        className={`canvas-node jelly group flex h-full flex-col overflow-hidden rounded-2xl text-[11px] transition ${
          selected ? 'ring-2 ring-[var(--lw-edge-active)]' : ''
        }`}
        style={{
          height: '100%',
          ...(objectType === 'storyboard' ? { minWidth: STORYBOARD_TABLE_W } : {}),
          '--lw-node-tint': titleColor,
        } as React.CSSProperties}
        onContextMenu={onContextMenu}
        onDoubleClick={() => openNodeModal(id)}
        title="双击打开编辑面板"
      >
        {/* 悬浮工具栏（悬停/选中浮现） */}
        <SceneHoverToolbar id={id} objectType={objectType} payload={payload} />

        {/* 标题栏：分类色条 + 类型名 + 状态 + 匹配标签 + 标题（玻璃内边） */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-white/30 px-2 py-1.5 dark:border-white/10">
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

        {/* 主体：内容优先 —— 展示生成结果（文本自适应：bodyRef 测量内容自动撑高节点） */}
        <div ref={bodyRef} className="nowheel min-h-0 flex-1 overflow-y-auto p-2">
          {videoUrl && objectType === 'video' && !isImageUrl(videoUrl) ? (
            <div className="relative mb-1.5 w-full overflow-hidden rounded-lg bg-black">
              {Boolean(payload.shot_no) && (
                <span className="absolute left-1.5 top-1.5 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  分镜 {String(payload.shot_no)}
                </span>
              )}
              <video src={videoUrl} controls className="w-full" style={{ maxHeight: 220 }} />
            </div>
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
              <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded bg-soft px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
                {directorStory.script || '（剧情节点尚未生成剧本）'}
              </div>
            </div>
          ) : objectType === 'storyboard' ? (
            <StoryboardTable
              shots={Array.isArray(payload.shots) ? payload.shots : []}
              locked={locked}
              onPatch={(next) => patchObject(id, { shots: next })}
            />
          ) : objectType === 'story' ? (
            <div className="whitespace-pre-wrap break-words rounded-lg bg-soft px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
              {summary || '（尚未生成剧本，双击打开编辑面板用 AI 生成）'}
            </div>
          ) : audioUrl ? (
            <audio src={audioUrl} controls className="w-full" />
          ) : objectType === 'image' || objectType === 'video' ? (
            <div className="flex min-h-[46px] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-edge px-2 py-2 text-[11px] text-ink-3">
              {objectType === 'image' && !imageUrl ? (
                <>
                  <span>🖼 待生成{payload.purpose ? `（${String(payload.purpose)}）` : ''}{payload.title ? `·${String(payload.title)}` : ''}</span>
                  {genBusy ? (
                    <span className="flex items-center gap-1 text-brand-400"><Loader2 size={11} className="animate-spin" />出图中…</span>
                  ) : (
                    <button
                      className="nodrag flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-[11px] text-white transition hover:bg-brand-500 disabled:opacity-50"
                      disabled={!String(payload.prompt ?? '').trim()}
                      onClick={(e) => { e.stopPropagation(); void genNode('image') }}
                      title="按提示词生成图片并回填本节点"
                    >
                      <Wand2 size={11} /> 生成图片
                    </button>
                  )}
                </>
              ) : objectType === 'video' && !videoUrl ? (
                <>
                  <span>▶ 待生成{payload.shot_no ? `（分镜 ${String(payload.shot_no)}）` : ''}</span>
                  {genBusy ? (
                    <span className="flex items-center gap-1 text-brand-400"><Loader2 size={11} className="animate-spin" />出视频中…</span>
                  ) : (
                    <button
                      className="nodrag flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-[11px] text-white transition hover:bg-brand-500 disabled:opacity-50"
                      disabled={!String(payload.prompt ?? '').trim()}
                      onClick={(e) => { e.stopPropagation(); void genNode('video') }}
                      title="按提示词生成视频并回填本节点（素材库参考图自动带入）"
                    >
                      <Wand2 size={11} /> 生成视频
                    </button>
                  )}
                </>
              ) : (
                <>
                  <span>{objectType === 'image' ? '🖼 未生成图片' : '▶ 未生成视频'}</span>
                  <span className="text-[10px] text-ink-3">双击打开编辑面板配置</span>
                </>
              )}
              {genErr && <span className="max-w-full truncate text-[10px] text-red-400">{genErr}</span>}
            </div>
          ) : (
            <div className="flex min-h-[46px] items-center justify-center rounded-lg border border-dashed border-edge px-2 py-2 text-[11px] text-ink-3">
              双击打开编辑面板
            </div>
          )}

          {objectType === 'video' && videoRefs.length > 0 && (
            <div className="mt-1.5 rounded-lg border border-edge bg-soft px-2 py-1.5">
              <div className="mb-1 text-[10px] text-ink-3">视频参考资料（{videoRefs.length}）</div>
              <div className="flex flex-wrap gap-1">
                {videoRefs.map((oid) => {
                  const o = objects.find((x) => x.id === oid)
                  const ot = String(((o?.data as Payload)?.objectType) ?? '')
                  return (
                    <span key={oid} className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-2">
                      {ot === 'audio' ? '音频' : '图片'}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {/* 提示词极简摘要：2 行截断，点击展开（玻璃内衬保证半透明背景上可读） */}
          {summary && (
            <div
              className="jelly-inner mt-1.5 cursor-pointer rounded-lg px-2 py-1.5"
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
