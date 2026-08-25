// =====================================================================
// 节点能力适配层 — 让同一套节点组件同时服务「工作流画布」和「无限画布」
// 节点组件通过 useNodeAdapter() 拿 update/status/locked/remove 等能力，
// 具体读写哪个 store 由渲染它的画布决定：
//   - 工作流画布 → workflowStore（nodes/edges/nodeStatus/nodeOutputs）
//   - 无限画布   → canvasStore（objects/edges + data.status/data.result）
// 无 Provider 时兜底走 workflowStore，保证旧渲染路径不崩。
// =====================================================================
import { createContext, useContext, type ReactNode } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { useWorkflowStore, type NodeStatus } from './workflowStore'
import { useCanvasStore } from './canvasStore'

export interface NodeAdapter {
  nodes: Node[]
  edges: Edge[]
  update: (id: string, data: Record<string, unknown>) => void
  getStatus: (id: string) => NodeStatus
  getOutput: (id: string) => unknown
  getLocked: (id: string) => boolean
  toggleLock: (id: string) => void
  remove: (id: string) => void
}

const NodeAdapterContext = createContext<NodeAdapter | null>(null)

function buildWorkflowAdapter(): NodeAdapter {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const status = useWorkflowStore((s) => s.nodeStatus)
  const outputs = useWorkflowStore((s) => s.nodeOutputs)
  const update = useWorkflowStore((s) => s.updateNodeData)
  const toggleLock = useWorkflowStore((s) => s.toggleLock)
  const remove = useWorkflowStore((s) => s.removeNode)
  return {
    nodes,
    edges,
    update,
    toggleLock,
    remove,
    getStatus: (id) => status[id] || 'idle',
    getOutput: (id) => outputs[id],
    getLocked: (id) => (nodes.find((n) => n.id === id)?.data as Record<string, unknown> | undefined)?.locked === true,
  }
}

function buildCanvasAdapter(): NodeAdapter {
  const objects = useCanvasStore((s) => s.objects)
  const edges = useCanvasStore((s) => s.edges)
  const update = useCanvasStore((s) => s.updateObject)
  const toggleLock = useCanvasStore((s) => s.toggleLock)
  const removeObjects = useCanvasStore((s) => s.deleteObjects)
  const byId = (id: string) => objects.find((n) => n.id === id)?.data as Record<string, unknown> | undefined
  return {
    nodes: objects,
    edges,
    update,
    toggleLock,
    remove: (id) => removeObjects([id]),
    getStatus: (id) => String(byId(id)?.status ?? 'idle') as NodeStatus,
    getOutput: (id) => {
      const r = byId(id)?.result ?? byId(id)?.output
      return typeof r === 'string' || typeof r === 'number' ? r : undefined
    },
    getLocked: (id) => byId(id)?.locked === true,
  }
}

export function NodeAdapterProvider({ variant, children }: { variant: 'workflow' | 'canvas'; children: ReactNode }) {
  const adapter = variant === 'workflow' ? buildWorkflowAdapter() : buildCanvasAdapter()
  return <NodeAdapterContext.Provider value={adapter}>{children}</NodeAdapterContext.Provider>
}

export function useNodeAdapter(): NodeAdapter {
  const ctx = useContext(NodeAdapterContext)
  // 始终调用兜底 hook，保持 hook 顺序稳定；有 Provider 时返回 ctx。
  const fallback = buildWorkflowAdapter()
  return ctx ?? fallback
}
