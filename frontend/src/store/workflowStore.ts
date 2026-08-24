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
import { runWorkflow } from '../api'

export type NodeStatus = 'idle' | 'running' | 'completed' | 'failed'

// 每种节点类型的默认 data，供工具条与画布落点复用
export const NODE_DEFAULTS: Record<string, Record<string, unknown>> = {
  input: { text: '' },
  llm: { prompt: '', temperature: 0.3 },
  prompt_template: { template: '', query: '' },
  skill: { skill_id: '', args: {} },
  output: { text: '' },
  // render 为算力/出图节点：后端暂无执行器，运行时会被友好拦截
  render: { prompt: '', model: '' },
}

export function defaultDataFor(type: string): Record<string, unknown> {
  return { ...(NODE_DEFAULTS[type] || {}) }
}

interface WorkflowState {
  nodes: Node[]
  edges: Edge[]
  nodeStatus: Record<string, NodeStatus>
  nodeOutputs: Record<string, unknown>
  running: boolean
  runError: string | null
  selectedAgent: string
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
  run: () => Promise<void>
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

  clearAll: () => set({ nodes: [], edges: [], nodeStatus: {}, nodeOutputs: {} }),

  setNodeStatus: (id, st) => set((s) => ({ nodeStatus: { ...s.nodeStatus, [id]: st } })),
  setNodeOutput: (id, output) => set((s) => ({ nodeOutputs: { ...s.nodeOutputs, [id]: output } })),
  resetStatus: () => set({ nodeStatus: {}, nodeOutputs: {} }),
  setRunning: (v) => set({ running: v }),
  setRunError: (e) => set({ runError: e }),
  setSelectedAgent: (a) => set({ selectedAgent: a }),

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
    const graph = {
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
    try {
      await runWorkflow(graph, (id, status, result) => {
        setNodeStatus(id, status as NodeStatus)
        if (status === 'completed' && result !== undefined) {
          get().setNodeOutput(id, result)
        }
      })
    } catch (e) {
      setRunError((e as Error).message)
    } finally {
      setRunning(false)
    }
  },
}))
