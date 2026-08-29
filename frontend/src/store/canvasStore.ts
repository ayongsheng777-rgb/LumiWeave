import { create } from 'zustand'
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react'
import { dagLayout } from '../canvas/layout'
import { OBJECT_LIBRARY } from './nodeLibrary'

// =====================================================================
// 影视创作节点系统 V2 — 画布工具条节点库（13节点 + 画布独有对象）
// 🔴 单一事实源在 ./nodeLibrary.ts（与 workflowStore 共用，加节点只改那里）
// =====================================================================
export { OBJECT_LIBRARY }

let seq = 0
function newId(prefix = 'obj'): string {
  return `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`
}

export function makeObject(type: string, position: { x: number; y: number }): Node {
  const def = OBJECT_LIBRARY.find((o) => o.type === type) || OBJECT_LIBRARY[0]
  return {
    id: newId(),
    type: def.type,
    position,
    data: { ...def.defaultData, status: 'idle' },
    style: { width: def.size.width, height: def.size.height },
  }
}

interface Snapshot {
  objects: Node[]
  edges: Edge[]
}

interface CanvasState {
  projectId: string
  objects: Node[]
  edges: Edge[]
  selectedIds: string[]
  undoStack: Snapshot[]
  redoStack: Snapshot[]
  setProjectId: (id: string) => void
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  load: (nodes: Node[], edges?: Edge[]) => void
  addObject: (type: string, position: { x: number; y: number }) => Node
  updateObject: (id: string, data: Record<string, unknown>) => void
  updateNodeStatus: (id: string, status: string, result?: unknown, error?: string) => void
  deleteObjects: (ids: string[]) => void
  toggleLock: (id: string) => void
  applyAutoLayout: () => void
  setSelected: (ids: string[]) => void
  bringForward: (id: string) => void
  sendBackward: (id: string) => void
  snapshot: () => void
  undo: () => void
  redo: () => void
  clear: () => void
}

export const useCanvasStore = create<CanvasState>((set) => ({
  projectId: 'default',
  objects: [],
  edges: [],
  selectedIds: [],
  undoStack: [],
  redoStack: [],

  setProjectId: (id) => set({ projectId: id }),

  onNodesChange: (changes) =>
    set((s) => {
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id)
      return {
        objects: applyNodeChanges(changes, s.objects),
        selectedIds: removed.length ? s.selectedIds.filter((i) => !removed.includes(i)) : s.selectedIds,
      }
    }),

  onEdgesChange: (changes) =>
    set((s) => ({
      edges: applyEdgeChanges(changes, s.edges),
    })),

  onConnect: (connection) =>
    set((s) => ({
      edges: addEdge({ ...connection, type: 'workflow', animated: false }, s.edges),
    })),

  load: (nodes, edges = []) =>
    set({ objects: nodes, edges, undoStack: [], redoStack: [], selectedIds: [] }),

  addObject: (type, position) => {
    const node = makeObject(type, position)
    set((s) => ({
      objects: [...s.objects, node],
      undoStack: [...s.undoStack, { objects: s.objects, edges: s.edges }],
      redoStack: [],
      selectedIds: [node.id],
    }))
    return node
  },

  updateObject: (id, data) =>
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, data: { ...o.data, ...data } } : o)),
    })),

  updateNodeStatus: (id, status, result, error) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id
          ? { ...o, data: { ...o.data, status, result: result ?? o.data?.result, error } }
          : o,
      ),
    })),

  deleteObjects: (ids) =>
    set((s) => ({
      objects: s.objects.filter((o) => !ids.includes(o.id)),
      edges: s.edges.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)),
      selectedIds: s.selectedIds.filter((i) => !ids.includes(i)),
      undoStack: [...s.undoStack, { objects: s.objects, edges: s.edges }],
      redoStack: [],
    })),

  toggleLock: (id) =>
    set((s) => ({
      objects: s.objects.map((o) => {
        if (o.id !== id) return o
        const locked = !(o.data?.locked === true)
        return { ...o, draggable: !locked, data: { ...o.data, locked } }
      }),
    })),

  applyAutoLayout: () =>
    set((s) => ({ objects: dagLayout(s.objects, s.edges) })),

  setSelected: (ids) => set({ selectedIds: ids }),

  bringForward: (id) =>
    set((s) => {
      const objs = [...s.objects]
      const idx = objs.findIndex((o) => o.id === id)
      if (idx < 0 || idx === objs.length - 1) return s
      const [o] = objs.splice(idx, 1)
      objs.splice(idx + 1, 0, o)
      return { objects: objs }
    }),

  sendBackward: (id) =>
    set((s) => {
      const objs = [...s.objects]
      const idx = objs.findIndex((o) => o.id === id)
      if (idx <= 0) return s
      const [o] = objs.splice(idx, 1)
      objs.splice(idx - 1, 0, o)
      return { objects: objs }
    }),

  snapshot: () =>
    set((s) => ({ undoStack: [...s.undoStack, { objects: s.objects, edges: s.edges }], redoStack: [] })),

  undo: () =>
    set((s) => {
      const prev = s.undoStack[s.undoStack.length - 1]
      if (!prev) return s
      return {
        objects: prev.objects,
        edges: prev.edges,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, { objects: s.objects, edges: s.edges }],
      }
    }),

  redo: () =>
    set((s) => {
      const next = s.redoStack[s.redoStack.length - 1]
      if (!next) return s
      return {
        objects: next.objects,
        edges: next.edges,
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, { objects: s.objects, edges: s.edges }],
      }
    }),

  clear: () => set({ objects: [], edges: [], selectedIds: [], undoStack: [], redoStack: [] }),
}))
