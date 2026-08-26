/**
 * 场景专业对象节点（规格书 §9 CanvasObject / §12 对象渲染）
 *
 * 一个组件覆盖全部对象类型：颜色 / 中文名 / 可编辑字段全部来自后端注册表
 * （registry.OBJECT_LIBRARY），新增对象类型无需改前端（§40 可扩展性）。
 *
 * 能力：缩放（NodeResizer）、锁定、删除、媒体预览、关键字段速览。
 */
import { memo, useCallback, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Lock, LockOpen, Trash2, Play, Copy } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { useUiStore } from '../store/uiStore'
import { cameraLabel } from '../cameraLabels'

type Payload = Record<string, unknown>

/** 图片类字段候选（按优先级取第一个有值的） */
const IMAGE_KEYS = ['url', 'image', 'image_url', 'cover', 'thumbnail']
const VIDEO_KEYS = ['video', 'video_url']

function pick(payload: Payload, keys: string[]): string {
  for (const k of keys) {
    const v = payload[k]
    if (typeof v === 'string' && v.trim()) return v
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0]) return v[0] as string
  }
  return ''
}

/** 值转可读文本 */
function readable(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('、')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const SceneObjectNode = memo(({ id, data, selected }: NodeProps) => {
  const objectType = String((data as Payload).objectType || 'text')
  const payload = ((data as Payload).payload || {}) as Payload
  const locked = (data as Payload).locked === true

  const meta = useSceneStore((s) => s.metaOf(objectType))
  const toggleLock = useSceneStore((s) => s.toggleLock)
  const deleteObjects = useSceneStore((s) => s.deleteObjects)
  const duplicateObjects = useSceneStore((s) => s.duplicateObjects)
  const patchObject = useSceneStore((s) => s.patchObject)
  const runAction = useSceneStore((s) => s.runAction)
  const busy = useSceneStore((s) => s.busy)
  const status = useSceneStore((s) => s.objectStatus[id])
  const typeDef = useSceneStore((s) => s.currentTypeDef())
  const openLightbox = useUiStore((s) => s.openLightbox)

  // 右键菜单（§18 Context Menu）
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    setCtx({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [])

  const imageUrl = pick(payload, IMAGE_KEYS)
  const videoUrl = pick(payload, VIDEO_KEYS)
  const fields = meta.fields || {}

  // 该对象类型在当前场景下可直接触发的主要动作（§19）
  const primaryAction = (() => {
    const acts = typeDef?.actions || []
    if (objectType === 'product' && acts.includes('analyze_product')) return 'analyze_product'
    if (objectType === 'shot' && acts.includes('analyze_shot')) return 'analyze_shot'
    if (objectType === 'storyboard' && acts.includes('generate_images')) return 'generate_main_image'
    if (objectType === 'scene' && acts.includes('generate_scene_image')) return 'generate_scene_image'
    return ''
  })()

  const onTitleChange = useCallback(
    (v: string) => {
      // 优先写 name，其次 title，最后 text
      const key = 'name' in payload ? 'name' : 'title' in payload ? 'title' : 'text'
      patchObject(id, { [key]: v })
    },
    [id, patchObject, payload],
  )

  const title =
    readable(payload.name) || readable(payload.title) ||
    (objectType === 'shot' ? `镜头 ${readable(payload.shot_no) || '?'}` : '') ||
    (objectType === 'storyboard' ? `${readable(payload.scene) || '?'}-${readable(payload.shot) || '?'}` : '') ||
    meta.label

  // 速览字段：排除已用于标题/媒体的键，最多 4 条
  const previewFields = Object.entries(fields)
    .filter(([k]) => !['name', 'title', 'url', 'image', 'video'].includes(k))
    .filter(([k]) => readable(payload[k]))
    .slice(0, 4)

  return (
    <>
      <NodeResizer
        isVisible={!!selected && !locked}
        minWidth={200}
        minHeight={140}
        lineClassName="!border-brand-500"
        handleClassName="!h-2 !w-2 !rounded-sm !border-brand-500 !bg-white"
      />

      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-brand-500" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-brand-500" />

      <div
        className={`flex h-full flex-col overflow-hidden rounded-xl border bg-panel shadow-node-dark transition ${
          selected ? 'border-brand-500' : 'border-edge'
        }`}
        style={{ height: '100%' }}
        onContextMenu={onContextMenu}
      >
        {/* 标题栏：色条 + 中文类型名 + 操作 */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-edge px-2 py-1.5">
          <span className="h-3 w-1 shrink-0 rounded-full" style={{ background: meta.color }} />
          <span className="shrink-0 text-[10px] font-medium" style={{ color: meta.color }}>
            {meta.label}
          </span>
          {status && status !== 'idle' && (
            <span
              className={`shrink-0 rounded-full px-1.5 text-[8px] leading-4 ${
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
          <input
            className="nodrag min-w-0 flex-1 truncate bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-3"
            value={title === meta.label ? '' : title}
            placeholder="未命名"
            onChange={(e) => onTitleChange(e.target.value)}
            disabled={locked}
          />
          {primaryAction && (
            <button
              className="nodrag shrink-0 rounded p-0.5 text-ink-3 transition hover:text-brand-500 disabled:opacity-40"
              title={`执行：${primaryAction}`}
              disabled={!!busy}
              onClick={() => void runAction(primaryAction, [id])}
            >
              <Play size={11} />
            </button>
          )}
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

        {/* 内容区：媒体优先，其次字段速览 */}
        <div className="nowheel flex-1 overflow-y-auto p-2">
          {videoUrl ? (
            <video
              src={videoUrl}
              controls
              className="mb-1.5 w-full rounded-lg bg-black"
              style={{ maxHeight: 200 }}
            />
          ) : imageUrl ? (
            <img
              src={imageUrl}
              alt={meta.label}
              className="mb-1.5 w-full cursor-zoom-in rounded-lg object-cover"
              style={{ maxHeight: 200 }}
              onClick={() => openLightbox(imageUrl)}
            />
          ) : null}

          {previewFields.length ? (
            <div className="space-y-1">
              {previewFields.map(([key, label]) => {
                const raw = readable(payload[key])
                // 景别 / 运动等镜头术语自动中英双文显示
                const shown = ['camera', 'motion', 'shot_size', 'camera_motion', 'lens'].includes(key)
                  ? cameraLabel(raw)
                  : raw
                return (
                  <div key={key} className="flex gap-1.5 text-[10px] leading-snug">
                    <span className="shrink-0 text-ink-3">{label}</span>
                    <span className="min-w-0 flex-1 break-words text-ink-2">{shown}</span>
                  </div>
                )
              })}
            </div>
          ) : !imageUrl && !videoUrl ? (
            <div className="flex h-full items-center justify-center text-[10px] text-ink-3">
              在右侧参数面板填写
            </div>
          ) : null}

          {/* 分析结果（拉片场景） */}
          {readable(payload.analysis) ? (
            <div className="mt-1.5 rounded-lg bg-hover/60 p-1.5 text-[10px] leading-relaxed text-ink-2">
              {readable(payload.analysis)}
            </div>
          ) : null}
        </div>
      </div>

      {/* 右键菜单（§18）：复制 / 主动作 / 锁定 / 删除 */}
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
          {primaryAction && (
            <button
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-ink transition hover:bg-hover"
              onClick={() => void runAction(primaryAction, [id])}
              disabled={!!busy}
            >
              <Play size={11} /> 执行动作
            </button>
          )}
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
