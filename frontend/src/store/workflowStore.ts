import { create } from 'zustand'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import { runWorkflow, workflowLoad, workflowSave } from '../api'

export type NodeStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

// 每种节点类型的默认 data，供工具条与画布落点复用
export const NODE_DEFAULTS: Record<string, Record<string, unknown>> = {
  input: { text: '' },
  llm: { prompt: '', temperature: 0.3 },
  prompt_template: { template: '', query: '' },
  skill: { skill_id: '', args: {} },
  output: { text: '' },
  render: { prompt: '', model: '' },
}

export function defaultDataFor(type: string): Record<string, unknown> {
  return { ...(NODE_DEFAULTS[type] || {}) }
}

// 后端返回的节点结果是 NodeResult 结构 {ok, output, error, ...}，这里提取纯 output
function extractOutput(result: unknown): unknown {
  if (result && typeof result === 'object' && 'output' in (result as Record<string, unknown>)) {
    return (result as Record<string, unknown>).output
  }
  return result
}

function toGraph(nodes: Node[], edges: Edge[]) {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.type || 'input') as string,
      data: (n.data || {}) as Record<string, unknown>,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  }
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface WorkflowState {
  nodes: Node[]
  edges: Edge[]
  nodeStatus: Record<string, NodeStatus>
  nodeOutputs: Record<string, unknown>
  running: boolean
  runError: string | null
  selectedAgent: string
  projectId: string
  workflowId: string
  saveStatus: SaveStatus
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (conn: Connection) => void
  addNode: (node: Node) => void
  updateNodeData: (id: string, data: Record<string, unknown>) => void
  removeNode: (id: string) => void
  clearAll: () => void
  setNodeStatus: (id: string, s: NodeStatus) => void
  setNodeOutput: (id: string, output: unknown) => void
  resetStatus: () => void
  setRunning: (v: boolean) => void
  setRunError: (e: string | null) => void
  setSelectedAgent: (a: string) => void
  setProjectId: (id: string) => void
  run: () => Promise<void>
  save: () => Promise<void>
  loadWorkflow: (workflowId: string) => Promise<void>
  loadLastWorkflow: () => Promise<void>
}

let nodeSeq = 0
const nextId = (type: string) => `${type}_${Date.now()}_${nodeSeq++}`

export function makeNode(
  type: string,
  data: Record<string, unknown>,
  position?: { x: number; y: number },
): Node {
  return {
    id: nextId(type),
    type,
    data,
    position: position || { x: 120 + nodeSeq * 36, y: 120 + nodeSeq * 36 },
  }
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  nodeStatus: {},
  nodeOutputs: {},
  running: false,
  runError: null,
  selectedAgent: 'auto',
  projectId: 'default',
  workflowId: '',
  saveStatus: 'idle',

  onNodesChange: (changes) => set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),
  onEdgesChange: (changes) => set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),
  onConnect: (conn) => set((s) => ({ edges: addEdge(conn, s.edges) })),

  addNode: (node) => set((s) => ({ nodes: [...s.nodes, node] })),
  updateNodeData: (id, data) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
    })),
  removeNode: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
    })),

  clearAll: () => set({ nodes: [], edges: [], nodeStatus: {}, nodeOutputs: {}, workflowId: '' }),

  setNodeStatus: (id, st) => set((s) => ({ nodeStatus: { ...s.nodeStatus, [id]: st } })),
  setNodeOutput: (id, output) => set((s) => ({ nodeOutputs: { ...s.nodeOutputs, [id]: output } })),
  resetStatus: () => set({ nodeStatus: {}, nodeOutputs: {} }),
  setRunning: (v) => set({ running: v }),
  setRunError: (e) => set({ runError: e }),
  setSelectedAgent: (a) => set({ selectedAgent: a }),
  setProjectId: (id) => set({ projectId: id }),

  run: async () => {
    const { nodes, edges, running, resetStatus, setRunning, setNodeStatus, setRunError } = get()
    if (running) return
    if (nodes.length === 0) {
      setRunError('画布是空的，先拖几个节点进来再运行')
      return
    }

    setRunning(true)
    setRunError(null)
    resetStatus()
    const graph = toGraph(nodes, edges)
    try {
      await runWorkflow(graph, (id, status, result) => {
        setNodeStatus(id, status as NodeStatus)
        if (status === 'completed' && result !== undefined) {
          get().setNodeOutput(id, extractOutput(result))
        }
        if ((status === 'failed' || status === 'cancelled') && result && typeof result === 'object') {
          const r = result as Record<string, unknown>
          const err = r.error as Record<string, unknown> | undefined
          if (err?.message) setRunError(String(err.message))
        }
      })
    } catch (e) {
      setRunError((e as Error).message)
    } finally {
      setRunning(false)
    }
  },

  save: async () => {
    const { nodes, edges, projectId, workflowId } = get()
    if (nodes.length === 0) {
      set({ runError: '画布是空的，没什么可保存的' })
      return
    }
    set({ saveStatus: 'saving' })
    try {
      const res = await workflowSave({
        project_id: projectId,
        workflow_id: workflowId || undefined,
        name: '',
        graph: toGraph(nodes, edges),
      })
      if (res.ok) {
        set({ workflowId: res.data.workflow_id as string, saveStatus: 'saved' })
        try {
          localStorage.setItem('lumiweave_last_wf', res.data.workflow_id as string)
        } catch {
          /* ignore */
        }
      } else {
        set({ saveStatus: 'error' })
      }
    } catch {
      set({ saveStatus: 'error' })
    }
    setTimeout(() => set({ saveStatus: 'idle' }), 2000)
  },

  loadWorkflow: async (workflowId) => {
    try {
      const res = await workflowLoad(workflowId)
      if (!res.ok) {
        set({ runError: '加载工作流失败' })
        return
      }
      const g = res.data.graph as { nodes: Node[]; edges: Edge[] }
      set({
        nodes: g.nodes || [],
        edges: g.edges || [],
        workflowId,
        projectId: (res.data.project_id as string) || get().projectId,
        nodeStatus: {},
        nodeOutputs: {},
        runError: null,
      })
      try {
        localStorage.setItem('lumiweave_last_wf', workflowId)
      } catch {
        /* ignore */
      }
    } catch {
      set({ runError: '加载工作流失败' })
    }
  },

  loadLastWorkflow: async () => {
    // 刷新后恢复上次打开的工作流（真正的数据在 PG，localStorage 只记「上次打开哪个」）
    try {
      const last = localStorage.getItem('lumiweave_last_wf')
      if (last) await get().loadWorkflow(last)
    } catch {
      /* ignore */
    }
  },
}))
