import type { NodeStatus } from '../../store/workflowStore'

const CFG: Record<NodeStatus, { dot: string; label: string }> = {
  idle: { dot: 'bg-status-idle', label: '空闲' },
  running: { dot: 'bg-status-running', label: '运行中' },
  completed: { dot: 'bg-status-completed', label: '完成' },
  failed: { dot: 'bg-status-failed', label: '失败' },
}

export default function StatusBadge({ status }: { status: NodeStatus }) {
  const c = CFG[status]
  return (
    <span className="inline-flex items-center gap-1.5" title={c.label}>
      <span className={`h-2.5 w-2.5 rounded-full ${c.dot} ${status === 'running' ? 'animate-breathe' : ''}`} />
      <span className="text-[11px] text-ink-2">{c.label}</span>
    </span>
  )
}
