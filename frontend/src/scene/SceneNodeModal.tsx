// SceneNodeModal —— 场景对象编辑弹窗（V2.8 UI 重构）
// 节点内容优先后，编辑收敛到本弹窗：居中悬浮、可拖拽、点外/Esc 关闭、
// 状态与节点实时双向绑定（patchObject 即时生效，无需手动保存）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Lock, LockOpen } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import SceneNodeEditPanel from './SceneNodeEditPanel'

type Payload = Record<string, unknown>

/** 拖拽：鼠标按住头部拖动弹窗（原生事件，不引第三方库） */
function useDrag(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !ref.current) return
    const header = ref.current.querySelector('[data-drag-handle]') as HTMLElement | null
    const box = ref.current
    if (!header) return
    let dragging = false
    let startX = 0
    let startY = 0
    let baseLeft = 0
    let baseTop = 0
    const onDown = (e: MouseEvent) => {
      dragging = true
      startX = e.clientX
      startY = e.clientY
      baseLeft = box.offsetLeft
      baseTop = box.offsetTop
      header.style.cursor = 'grabbing'
      e.preventDefault()
    }
    const onMove = (e: MouseEvent) => {
      if (!dragging) return
      box.style.left = `${baseLeft + (e.clientX - startX)}px`
      box.style.top = `${baseTop + (e.clientY - startY)}px`
    }
    const onUp = () => {
      dragging = false
      header.style.cursor = 'grab'
    }
    header.addEventListener('mousedown', onDown)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      header.removeEventListener('mousedown', onDown)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [enabled, ref])
}

export default function SceneNodeModal() {
  const modalNodeId = useSceneStore((s) => s.modalNodeId)
  const closeNodeModal = useSceneStore((s) => s.closeNodeModal)
  const toggleLock = useSceneStore((s) => s.toggleLock)
  const objects = useSceneStore((s) => s.objects)
  const metaOf = useSceneStore((s) => s.metaOf)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const obj = objects.find((o) => o.id === modalNodeId)
  const payload = ((obj?.data as Payload)?.payload || {}) as Payload
  const objectType = String(((obj?.data as Payload)?.objectType || 'text'))
  const locked = (obj?.data as Payload)?.locked === true
  const meta = metaOf(objectType)

  // Esc 关闭
  useEffect(() => {
    if (!modalNodeId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeNodeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalNodeId, closeNodeModal])

  // 打开时定位（居中，可被拖拽）
  useEffect(() => {
    if (modalNodeId) {
      setPos({
        left: Math.max(16, window.innerWidth / 2 - 300),
        top: Math.max(16, window.innerHeight / 2 - 240),
      })
    }
  }, [modalNodeId])

  useDrag(boxRef, !!modalNodeId)

  // 点外部关闭
  const onBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closeNodeModal()
  }, [closeNodeModal])

  if (!modalNodeId || !obj) return null

  const title =
    String(payload.title || payload.name || '') ||
    (objectType === 'image' && String(payload.purpose ?? '') ? `${meta.label} · ${String(payload.purpose)}` : '') ||
    meta.label

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30"
      style={{ paddingTop: '6vh' }}
      onMouseDown={onBackdrop}
    >
      <div
        ref={boxRef}
        className="flex max-h-[84vh] w-[640px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-edge bg-panel-2 text-[11px] shadow-2xl"
        style={{ left: pos?.left, top: pos?.top, position: 'fixed' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 头部（拖拽柄） */}
        <div
          data-drag-handle
          className="flex shrink-0 cursor-grab items-center gap-2 border-b border-edge px-3 py-2 select-none"
        >
          <span className="h-3 w-1 shrink-0 rounded-full" style={{ background: meta.color }} />
          <span className="shrink-0 text-sm font-medium" style={{ color: meta.color }}>
            {title}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">
            {meta.label} · 编辑（拖动头部移动，Esc 关闭）
          </span>
          <button
            className="shrink-0 rounded p-1 text-ink-3 transition hover:text-ink"
            title={locked ? '解锁' : '锁定'}
            onClick={() => toggleLock(modalNodeId)}
          >
            {locked ? <Lock size={13} /> : <LockOpen size={13} />}
          </button>
          <button
            className="shrink-0 rounded p-1 text-ink-3 transition hover:text-ink"
            title="关闭"
            onClick={closeNodeModal}
          >
            <X size={14} />
          </button>
        </div>
        {/* 编辑面板 */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <SceneNodeEditPanel id={modalNodeId} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
