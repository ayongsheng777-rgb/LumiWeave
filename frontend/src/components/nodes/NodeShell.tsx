import { Handle, Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import { useWorkflowStore, type NodeStatus } from '../../store/workflowStore'
import StatusBadge from './StatusBadge'

export const inputCls =
  'nodrag nowheel w-full rounded-lg border border-edge bg-input px-2.5 py-1.5 text-sm text-ink outline-none transition focus:border-brand-500 placeholder:text-ink-3'

const ringOf: Record<NodeStatus, string> = {
  idle: 'ring-edge',
  running: 'ring-status-running/70',
  completed: 'ring-status-completed/70',
  failed: 'ring-status-failed/70',
  cancelled: 'ring-status-failed/70',
}

// 把节点输出转成可读的一行摘要
function summarize(output: unknown): string {
  if (output == null) return ''
  if (typeof output === 'string') return output
  if (typeof output === 'object') {
    const o = output as Record<string, unknown>
    for (const key of ['content', 'text', 'prompt', 'result', 'error']) {
      if (o[key]) return String(o[key])
    }
    if (o.render) return JSON.stringify(o.render)
    return JSON.stringify(o)
  }
  return String(output)
}

export function NodeShell({
  id,
  title,
  icon,
  children,
}: {
  id: string
  title: string
  icon?: ReactNode
  children: ReactNode
}) {
  const status = useWorkflowStore((s) => s.nodeStatus[id] || 'idle')
  const output = useWorkflowStore((s) => s.nodeOutputs[id])
  const summary = summarize(output)

  return (
    <div
      className={`w-64 rounded-xl bg-panel-2 ring-1 ${ringOf[status]} border border-edge shadow-node-dark animate-fade-in`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-canvas !bg-brand-500"
      />
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <span className="text-brand-300">{icon}</span>
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="ml-auto">
          <StatusBadge status={status} />
        </span>
      </div>
      <div className="space-y-2 p-3">{children}</div>

      {/* 运行结果回显：完成后展示节点产出，让用户看得到「反应」 */}
      {status === 'completed' && summary && (
        <div className="border-t border-edge px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-3">运行结果</div>
          <div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-input px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
            {summary}
          </div>
        </div>
      )}
      {status === 'failed' && summary && (
        <div className="border-t border-status-failed/30 px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-red-400">失败原因</div>
          <div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-status-failed/10 px-2 py-1.5 text-[11px] leading-relaxed text-red-300">
            {summary}
          </div>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-canvas !bg-brand-500"
      />
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-2">{label}</span>
      {children}
    </label>
  )
}
