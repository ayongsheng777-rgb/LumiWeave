// LockedOverlays —— 防误触抽屉/弹窗（界面重构文档：点遮罩不关闭，必须点 完成/取消/右上角 X）
// 图片/视频/音频节点编辑器共用。
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function LockedDrawer({
  open, onClose, title, children, footer, width = 360, side = 'right', zIndex = 120,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
  side?: 'right' | 'bottom'
  zIndex?: number
}) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0" style={{ zIndex }}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className={`absolute flex flex-col bg-panel shadow-2xl ${side === 'right' ? 'right-0 top-0 h-full border-l border-edge' : 'bottom-0 left-0 right-0 max-h-[60vh] border-t border-edge'}`}
        style={side === 'right' ? { width } : undefined}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
          <span className="text-sm font-medium text-ink">{title}</span>
          <button className="rounded p-1 text-ink-3 transition hover:bg-soft hover:text-ink" onClick={onClose} title="取消">
            <X size={16} />
          </button>
        </div>
        <div className="nowheel min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-edge p-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function LockedModal({
  open, onClose, title, children, footer, width = 360,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
}) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative flex max-h-[80vh] w-full flex-col rounded-2xl border border-edge bg-panel shadow-2xl" style={{ maxWidth: width }}>
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
          <span className="text-sm font-medium text-ink">{title}</span>
          <button className="rounded p-1 text-ink-3 transition hover:bg-soft hover:text-ink" onClick={onClose} title="取消">
            <X size={16} />
          </button>
        </div>
        <div className="nowheel min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-edge p-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
