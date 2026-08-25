import type { ReactNode } from 'react'
import { Handle, Position } from '@xyflow/react'

// 工作流节点外壳：带 source/target handles + 锁定/删除按钮 + 状态角标
export default function NodeShell({
  title,
  color = '#3b82f6',
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
  return (
    <div
      className={`obj-node ${selected ? 'obj-selected' : ''}`}
      style={{ borderTopColor: color }}
    >
      {input && <Handle type="target" position={Position.Left} className="workflow-handle" />}

      <div className="obj-node-head">
        <span className="obj-node-dot" style={{ background: color }} />
        <span className="obj-node-title">{title}</span>
        {status && status !== 'idle' && (
          <span className={`node-status-badge node-status-${status}`}>{status}</span>
        )}
        <div className="obj-node-actions">
          {onToggleLock && (
            <button className="nodrag obj-node-btn" title={locked ? '解锁' : '锁定'} onClick={onToggleLock}>
              {locked ? '🔒' : '🔓'}
            </button>
          )}
          {onDelete && (
            <button className="nodrag obj-node-btn obj-node-btn-del" title="删除" onClick={onDelete}>
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="obj-node-body">{children}</div>

      {output && <Handle type="source" position={Position.Right} className="workflow-handle" />}
    </div>
  )
}
