// =====================================================================
// 裁剪对话框：在图片上拖一个框，确认后画布端裁切 → 上传 → 替换节点媒体。
// 纯前端裁切（同源 /uploads 不污染 canvas），后端零改动。
// =====================================================================
import { useRef, useState } from 'react'
import { Loader2, Scissors, X } from 'lucide-react'
import { usePvStore } from './store'
import { usePvDialogs } from './dialogStore'
import { uploadImage } from '../api'
import { emitLog } from '../components/LogPanel'
import type { PvNodeData } from './types'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function PvCropDialog() {
  const nodeId = usePvDialogs((s) => s.cropNodeId)
  if (!nodeId) return null
  return <CropInner key={nodeId} nodeId={nodeId} />
}

function CropInner({ nodeId }: { nodeId: string }) {
  const close = usePvDialogs((s) => s.closeCrop)
  const node = usePvStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNodeData = usePvStore((s) => s.updateNodeData)
  const setNodeStatus = usePvStore((s) => s.setNodeStatus)
  const d = node?.data as unknown as PvNodeData | undefined

  const boxRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!d || !d.url) return null

  /** 屏幕坐标 → 图片显示区内的相对坐标 */
  const toLocal = (e: React.MouseEvent): { x: number; y: number } | null => {
    const img = imgRef.current
    if (!img) return null
    const b = img.getBoundingClientRect()
    const x = Math.min(Math.max(e.clientX - b.left, 0), b.width)
    const y = Math.min(Math.max(e.clientY - b.top, 0), b.height)
    return { x, y }
  }

  const onDown = (e: React.MouseEvent) => {
    const p = toLocal(e)
    if (!p) return
    dragStart.current = p
    setRect({ x: p.x, y: p.y, w: 0, h: 0 })
  }
  const onMove = (e: React.MouseEvent) => {
    const s = dragStart.current
    if (!s) return
    const p = toLocal(e)
    if (!p) return
    setRect({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    })
  }
  const onUp = () => {
    dragStart.current = null
    setRect((r) => (r && r.w >= 8 && r.h >= 8 ? r : null))
  }

  const onConfirm = async () => {
    const img = imgRef.current
    if (!img || !rect) return
    setBusy(true)
    setErr('')
    try {
      const sx = img.naturalWidth / img.getBoundingClientRect().width
      const crop = {
        x: Math.round(rect.x * sx),
        y: Math.round(rect.y * sx),
        w: Math.round(rect.w * sx),
        h: Math.round(rect.h * sx),
      }
      const canvas = document.createElement('canvas')
      canvas.width = crop.w
      canvas.height = crop.h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('画布环境不可用')
      ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('裁切失败')
      const name = `crop_${d.filename || 'image.png'}`
      const res = await uploadImage(new File([blob], name, { type: 'image/png' }))
      const payload = res.data as Record<string, unknown> | undefined
      if (!res.ok || !payload?.url) throw new Error(String(payload?.error || '上传失败'))
      updateNodeData(nodeId, {
        url: String(payload.url),
        file_path: String(payload.file_path || payload.url),
        thumbnail_url: String(payload.url),
        filename: name,
        width: crop.w,
        height: crop.h,
        status: 'completed',
        error: '',
      } as Partial<PvNodeData>)
      setNodeStatus(nodeId, 'completed')
      emitLog({
        nodeId,
        nodeLabel: d.title,
        nodeType: 'pv_asset',
        status: 'completed',
        message: `已裁剪为 ${crop.w}×${crop.h}`,
      })
      close()
    } catch (e) {
      setErr((e as Error).message || '裁剪失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm animate-fade-in"
      onClick={close}
    >
      <div
        className="flex max-h-[88vh] w-[min(94vw,40rem)] flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ borderColor: 'var(--lw-glass-strong-edge)', background: 'var(--lw-node-bg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-3">
          <Scissors size={15} className="text-brand-400" />
          <span className="text-sm font-medium text-ink">裁剪 · {d.title}</span>
          <span className="text-[10px] text-ink-3">在图上拖出要保留的区域</span>
          <button className="ml-auto rounded p-1 text-ink-3 transition hover:bg-soft hover:text-ink" onClick={close}>
            <X size={16} />
          </button>
        </div>

        <div
          ref={boxRef}
          className="nodrag relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/30 p-4"
        >
          <div className="relative select-none">
            <img
              ref={imgRef}
              src={String(d.url)}
              alt={d.title}
              className="max-h-[60vh] max-w-full cursor-crosshair object-contain"
              draggable={false}
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
            />
            {rect && (
              <div
                className="pointer-events-none absolute border-2 border-brand-400 bg-brand-400/15"
                style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              />
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-edge px-4 py-3">
          {err && <span className="text-[11px] text-red-400">{err}</span>}
          {!err && rect && (
            <span className="text-[11px] text-ink-3">
              选区 {Math.round(rect.w)}×{Math.round(rect.h)}（显示像素）
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button
              className="rounded-lg border border-edge px-3 py-1.5 text-xs text-ink-2 transition hover:bg-hover"
              onClick={() => setRect(null)}
              disabled={!rect || busy}
            >
              重选
            </button>
            <button
              className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
              onClick={() => void onConfirm()}
              disabled={!rect || busy}
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              确认裁剪
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
