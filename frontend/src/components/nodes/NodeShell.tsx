import { Handle, Position, NodeResizer } from '@xyflow/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Lock, LockOpen, Trash2, Settings2, ChevronUp, ChevronDown } from 'lucide-react'
import type { NodeStatus } from '../../store/workflowStore'
import { useNodeAdapter } from '../../store/nodeAdapter'
import { useUiStore } from '../../store/uiStore'
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

export type NodeViewMode = 'expanded' | 'collapsed' | 'result-only'

export function NodeShell({
  id,
  title,
  icon,
  selected,
  children,
  resultView,
}: {
  id: string
  title: string
  icon?: ReactNode
  selected?: boolean
  children: ReactNode
  /** 结果态自定义展示（图片/视频等媒体）；不传则回退为文本摘要 */
  resultView?: ReactNode
}) {
  const { getStatus, getOutput, getLocked, toggleLock, remove, setSize } = useNodeAdapter()
  const openNodeConfig = useUiStore((s) => s.openNodeConfig)
  const status = getStatus(id)
  const output = getOutput(id)
  const locked = getLocked(id)
  const summary = summarize(output)

  // 三级形态：expanded(配置全展开) / collapsed(极简标题) / result-only(仅结果)
  // 默认：已完成 → 只看结果；否则展开
  const [viewMode, setViewMode] = useState<NodeViewMode>(status === 'completed' ? 'result-only' : 'expanded')

  // 展开配置：同时松开外壳固定高度（此前缩放过的节点高度被钉死，表单会塞进看不见的滚动区）
  const expandConfig = () => {
    setViewMode('expanded')
    setSize(id, { height: 'auto' })
  }

  const toggleExpand = () => {
    if (viewMode === 'expanded') {
      setViewMode(status === 'completed' && resultView ? 'result-only' : 'collapsed')
    } else {
      expandConfig()
    }
  }

  const isCompact = viewMode !== 'expanded'

  return (
    <div
      className={`flex flex-col rounded-xl bg-panel-2 ring-1 ${ringOf[status]} border border-edge shadow-node-dark animate-fade-in transition-all duration-300`}
      style={
        viewMode === 'expanded'
          ? { width: '100%', minWidth: 240, minHeight: 320 }
          : { width: '100%', height: '100%', minWidth: viewMode === 'collapsed' ? 180 : 240 }
      }
    >
      <NodeResizer
        isVisible={!!selected && !locked && viewMode === 'expanded'}
        minWidth={240}
        minHeight={80}
        color="#8b5cf6"
        lineStyle={{ borderWidth: 1.5 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-canvas !bg-brand-500"
      />

      {/* 标题栏：点击在 展开/收起 间切换 */}
      <div className="flex shrink-0 cursor-pointer items-center gap-2 border-b border-edge px-3 py-2" onClick={toggleExpand}>
        {!isCompact && <span className="text-brand-300">{icon}</span>}
        <span className={`truncate font-medium text-ink ${isCompact ? 'text-[11px] text-ink-2' : 'text-sm'}`}>{title}</span>
        <span className="ml-auto flex items-center gap-0.5">
          {/* 齿轮：弹出右侧参数配置抽屉（实质性面板） */}
          <button
            className="nodrag rounded p-1 text-ink-3 transition hover:bg-soft hover:text-brand-400"
            title="参数配置面板"
            onClick={(e) => { e.stopPropagation(); openNodeConfig(id) }}
          >
            <Settings2 size={13} />
          </button>
          {/* 折叠/展开箭头 */}
          <button
            className="nodrag rounded p-1 text-ink-3 transition hover:bg-soft hover:text-ink"
            title={viewMode === 'expanded' ? '收起' : '展开'}
            onClick={(e) => { e.stopPropagation(); toggleExpand() }}
          >
            {viewMode === 'collapsed' ? <ChevronDown size={13} /> : viewMode === 'result-only' ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          <button
            className="nodrag rounded p-1 text-ink-3 transition hover:bg-soft hover:text-ink"
            title={locked ? '解锁' : '锁定'}
            onClick={(e) => { e.stopPropagation(); toggleLock(id) }}
          >
            {locked ? <LockOpen size={13} /> : <Lock size={13} />}
          </button>
          <button
            className="nodrag rounded p-1 text-ink-3 transition hover:bg-soft hover:text-red-400"
            title="删除节点"
            onClick={(e) => { e.stopPropagation(); remove(id) }}
          >
            <Trash2 size={13} />
          </button>
          {!isCompact && <StatusBadge status={status} />}
        </span>
      </div>

      {/* 展开状态：完整配置表单 */}
      {viewMode === 'expanded' && (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">{children}</div>
      )}

      {/* 结果状态：仅显示结果媒体/摘要 */}
      {viewMode === 'result-only' && (
        <div className="flex items-center justify-center bg-soft p-2">
          {status === 'completed' && (resultView || (summary && (
            <div className="max-h-28 w-full overflow-y-auto whitespace-pre-wrap break-words rounded-md px-2 py-1.5 text-left text-[11px] leading-relaxed text-ink-2">
              {summary}
            </div>
          )))}
          {status !== 'completed' && <span className="text-[10px] text-ink-3">点 ⚙ 或标题展开配置</span>}
        </div>
      )}

      {/* 失败原因（折叠时也显示，方便排错） */}
      {status === 'failed' && summary && (
        <div className="shrink-0 border-t border-status-failed/30 px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-red-400">失败原因</div>
          <div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-status-failed/10 px-2 py-1.5 text-[11px] leading-relaxed text-red-300">
            {summary}
          </div>
        </div>
      )}

      {/* 运行结果回显：仅展开态显示，避免与 result-only 重复 */}
      {viewMode === 'expanded' && status === 'completed' && summary && (
        <div className="shrink-0 border-t border-edge px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-3">运行结果</div>
          <div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-input px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
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
