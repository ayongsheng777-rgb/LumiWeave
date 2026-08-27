import type { ReactNode } from 'react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { Lock, LockOpen, Trash2 } from 'lucide-react'

// 画布节点外壳（Tailwind 现代样式，与工作流画布 NodeShell 同视觉语言）
// 保留原有 props 签名，画布专属节点无需改动即可换皮。
export default function NodeShell({
  title,
  color = 'var(--brand)',
  selected,
  locked,
  status,
  onToggleLock,
  onDelete,
  input = true,
  output = true,
  children,
}: {
  title: string
  color?: string
  selected?: boolean
  locked?: boolean
  status?: string
  onToggleLock?: () => void
  onDelete?: () => void
  input?: boolean
  output?: boolean
  children: ReactNode
}) {
  const badge =
    status && status !== 'idle'
      ? status === 'completed'
        ? 'bg-status-completed/15 text-status-completed'
        : status === 'failed' || status === 'error'
          ? 'bg-status-failed/15 text-status-failed'
          : 'bg-status-running/15 text-status-running animate-pulse'
      : null

  return (
    <div
      className={`canvas-node flex flex-col rounded-xl animate-fade-in ${
        selected ? 'ring-2 ring-[var(--lw-edge-active)]' : ''
      }`}
      style={{ width: '100%', height: '100%', minWidth: 180 }}
    >
      <NodeResizer
        isVisible={!!selected && !locked}
        minWidth={180}
        minHeight={60}
        color="var(--brand)"
        lineStyle={{ borderWidth: 1.5 }}
      />
      {input && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-canvas !bg-brand-500" />}

      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="ml-auto flex items-center gap-1">
          {badge && <span className={`rounded px-1.5 py-0.5 text-[10px] ${badge}`}>{status}</span>}
          {onToggleLock && (
            <button className="nodrag rounded p-1 text-ink-3 transition hover:bg-soft hover:text-ink" title={locked ? '解锁' : '锁定'} onClick={onToggleLock}>
              {locked ? <LockOpen size={13} /> : <Lock size={13} />}
            </button>
          )}
          {onDelete && (
            <button className="nodrag rounded p-1 text-ink-3 transition hover:bg-soft hover:text-red-400" title="删除" onClick={onDelete}>
              <Trash2 size={13} />
            </button>
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>

      {output && <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-canvas !bg-brand-500" />}
    </div>
  )
}
