import { create } from 'zustand'
import { applyNodeChanges, type Node, type NodeChange } from '@xyflow/react'

export const OBJECT_LIBRARY: { type: string; label: string; defaultData: Record<string, unknown>; size: { width: number; height: number } }[] = [
  { type: 'text', label: '文本', defaultData: { text: '双击编辑文本' }, size: { width: 220, height: 120 } },
  { type: 'note', label: '便签', defaultData: { text: '' }, size: { width: 200, height: 100 } },
  { type: 'prompt', label: '提示词', defaultData: { text: '' }, size: { width: 240, height: 130 } },
  { type: 'image', label: '图片', defaultData: { url: '', prompt: '' }, size: { width: 300, height: 300 } },
  { type: 'ai_result', label: 'AI 结果', defaultData: { text: '', kind: 'text' }, size: { width: 240, height: 140 } },
]

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
    data: { ...def.defaultData },
    style: { width: def.size.width, height: def.size.height },
  }
}

interface CanvasState {
  projectId: string
  objects: Node[]
  selectedIds: string[]
  undoStack: Node[][]
  redoStack: Node[][]
  setProjectId: (id: string) => void
  onNodesChange: (changes: NodeChange[]) => void
  load: (nodes: Node[]) => void
  addObject: (type: string, position: { x: number; y: number }) => Node
  updateObject: (id: string, data: Record<string, unknown>) => void
  deleteObjects: (ids: string[]) => void
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

  load: (nodes) => set({ objects: nodes, undoStack: [], redoStack: [], selectedIds: [] }),

  addObject: (type, position) => {
    const node = makeObject(type, position)
    set((s) => ({
      objects: [...s.objects, node],
      undoStack: [...s.undoStack, s.objects],
      redoStack: [],
      selectedIds: [node.id],
    }))
    return node
  },

  updateObject: (id, data) =>
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, data: { ...o.data, ...data } } : o)),
    })),

  deleteObjects: (ids) =>
    set((s) => ({
      objects: s.objects.filter((o) => !ids.includes(o.id)),
      selectedIds: s.selectedIds.filter((i) => !ids.includes(i)),
      undoStack: [...s.undoStack, s.objects],
      redoStack: [],
    })),

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
    set((s) => ({ undoStack: [...s.undoStack, s.objects], redoStack: [] })),

  undo: () =>
    set((s) => {
      if (s.undoStack.length === 0) return s
      const prev = s.undoStack[s.undoStack.length - 1]
      return {
        objects: prev,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, s.objects],
      }
    }),

  redo: () =>
    set((s) => {
      if (s.redoStack.length === 0) return s
      const next = s.redoStack[s.redoStack.length - 1]
      return {
        objects: next,
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, s.objects],
      }
    }),

  clear: () => set({ objects: [], selectedIds: [], undoStack: [], redoStack: [] }),
}))
