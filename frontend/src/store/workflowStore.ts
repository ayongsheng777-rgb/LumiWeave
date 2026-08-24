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

export type NodeStatus = 'idle' | 'running' | 'completed' | 'failed'

interface WorkflowState {
  nodes: Node[]
  edges: Edge[]
  nodeStatus: Record<string, NodeStatus>
  running: boolean
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (conn: Connection) => void
  addNode: (node: Node) => void
  updateNodeData: (id: string, data: Record<string, unknown>) => void
  removeNode: (id: string) => void
  clearAll: () => void
  setNodeStatus: (id: string, s: NodeStatus) => void
  resetStatus: () => void
  setRunning: (v: boolean) => void
}

let nodeSeq = 0
const nextId = (type: string) => `${type}_${Date.now()}_${nodeSeq++}`

export function makeNode(type: string, data: Record<string, unknown>, position?: { x: number; y: number }): Node {
  return {
    id: nextId(type),
    type,
    data,
    position: position || { x: 80 + nodeSeq * 40, y: 120 + nodeSeq * 40 },
  }
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  nodes: [],
  edges: [],
  nodeStatus: {},
  running: false,

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

  clearAll: () => set({ nodes: [], edges: [], nodeStatus: {} }),

  setNodeStatus: (id, st) => set((s) => ({ nodeStatus: { ...s.nodeStatus, [id]: st } })),
  resetStatus: () => set({ nodeStatus: {} }),
  setRunning: (v) => set({ running: v }),
}))
