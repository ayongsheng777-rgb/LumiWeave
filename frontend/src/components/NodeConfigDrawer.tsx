// 节点参数配置抽屉（V2.3 交互修复）：齿轮按钮点开，右侧滑出该节点的完整参数面板
// 双画布通用：按 uiStore.mode 读 workflowStore / canvasStore
import { X, Settings2 } from 'lucide-react'
import type { Node } from '@xyflow/react'
import { useUiStore } from '../store/uiStore'
import { useWorkflowStore } from '../store/workflowStore'
import { useCanvasStore } from '../store/canvasStore'

const SKIP_KEYS = new Set(['status', 'result', 'error', 'locked', 'taskId', '__meta', 'seed'])
const TEXTAREA_KEYS = new Set(['text', 'prompt', 'message', 'description', 'system', 'template', 'content', 'negative', 'script'])

export default function NodeConfigDrawer() {
  const open = useUiStore((s) => s.nodeConfig.open)
  const nodeId = useUiStore((s) => s.nodeConfig.nodeId)
  const close = useUiStore((s) => s.closeNodeConfig)
  const mode = useUiStore((s) => s.mode)

  const isWorkflow = mode === 'workflow'
  const wfNode = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId))
  const canvasNode = useCanvasStore((s) => s.objects.find((n) => n.id === nodeId))
  const node: Node | undefined = isWorkflow ? wfNode : canvasNode

  if (!open) return null

  const update = (data: Record<string, unknown>) => {
    if (isWorkflow) useWorkflowStore.getState().updateNodeData(nodeId, data)
    else useCanvasStore.getState().updateObject(nodeId, data)
  }

  if (!node) {
    return (
      <div className="fixed right-0 top-0 z-[45] flex h-full w-80 flex-col border-l border-edge bg-panel shadow-xl">
        <DrawerHead onClose={close} title="参数配置" />
        <div className="p-4 text-xs text-ink-3">节点不存在或已被删除。</div>
      </div>
    )
  }

  const data = (node.data || {}) as Record<string, unknown>
  const editable = Object.keys(data).filter((k) => !SKIP_KEYS.has(k))
  const status = String(data.status || 'idle')

  return (
    <div className="fixed right-0 top-0 z-[45] flex h-full w-80 flex-col border-l border-edge bg-panel shadow-xl animate-fade-in">
      <DrawerHead onClose={close} title={`参数配置 · ${String(data.label || node.type || '')}`} />
      <div className="nowheel min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <div className="flex items-center gap-2 text-[11px] text-ink-3">
          <span className={`rounded-full px-2 py-0.5 ${
            status === 'completed' ? 'bg-green-500/15 text-green-400'
            : status === 'failed' ? 'bg-red-500/15 text-red-400'
            : status === 'running' ? 'bg-blue-500/15 text-blue-400'
            : 'bg-soft text-ink-3'
          }`}>{status}</span>
          <span>类型：{String(node.type)}</span>
        </div>

        {editable.length === 0 && <div className="text-xs text-ink-3">该节点没有可编辑参数。</div>}

        {editable.map((k) => {
          const v = data[k]
          if (Array.isArray(v)) {
            // 数组只读展示（reference/images/shots 等复杂结构在节点内编辑）
            return (
              <label key={k} className="block">
                <span className="mb-1 block text-[11px] text-ink-2">{k}</span>
                <div className="rounded-lg bg-soft px-2 py-1.5 text-[11px] text-ink-3">
                  [{v.length} 项]（请在节点内编辑）
                </div>
              </label>
            )
          }
          if (typeof v === 'object' && v !== null) {
            return (
              <label key={k} className="block">
                <span className="mb-1 block text-[11px] text-ink-2">{k}</span>
                <pre className="max-h-24 overflow-y-auto rounded-lg bg-soft px-2 py-1.5 text-[10px] text-ink-3">{JSON.stringify(v)}</pre>
              </label>
            )
          }
          const isTextarea = TEXTAREA_KEYS.has(k)
          const strVal = v == null ? '' : String(v)
          return (
            <label key={k} className="block">
              <span className="mb-1 block text-[11px] text-ink-2">{k}</span>
              {typeof v === 'boolean' ? (
                <button
                  onClick={() => update({ [k]: !v })}
                  className={`rounded-lg px-3 py-1.5 text-xs ${v ? 'bg-brand-500 text-white' : 'bg-soft text-ink-2'}`}
                >
                  {v ? '开' : '关'}
                </button>
              ) : isTextarea ? (
                <textarea
                  rows={4}
                  className="w-full rounded-lg border border-edge bg-input px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand-500"
                  value={strVal}
                  onChange={(e) => update({ [k]: e.target.value })}
                />
              ) : typeof v === 'number' ? (
                <input
                  type="number"
                  className="w-full rounded-lg border border-edge bg-input px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand-500"
                  value={v}
                  onChange={(e) => update({ [k]: Number(e.target.value) })}
                />
              ) : (
                <input
                  className="w-full rounded-lg border border-edge bg-input px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand-500"
                  value={strVal}
                  onChange={(e) => update({ [k]: e.target.value })}
                />
              )}
            </label>
          )
        })}

        {data.error != null && (
          <div className="rounded-lg bg-red-500/10 px-2 py-1.5 text-[11px] text-red-400">错误：{String(data.error)}</div>
        )}
      </div>
    </div>
  )
}

function DrawerHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-3">
      <Settings2 size={14} className="text-brand-300" />
      <span className="truncate text-sm font-medium text-ink">{title}</span>
      <button className="ml-auto text-ink-3 transition hover:text-ink" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  )
}
