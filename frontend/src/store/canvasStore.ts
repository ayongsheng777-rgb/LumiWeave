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

// =====================================================================
// 影视创作节点系统 V2 — 画布工具条节点库（13节点）
// 与 workflowStore.ts 的 NODE_DEFAULTS 完全对齐
// =====================================================================
export const OBJECT_LIBRARY: { type: string; label: string; defaultData: Record<string, unknown>; size: { width: number; height: number } }[] = [
  // ── 创作入口 ──────────────────────────────────────────────
  { type: 'image_input', label: '图片上传',  defaultData: { url: '', filename: '', status: 'idle' }, size: { width: 240, height: 300 } },
  { type: 'story',       label: '故事输入',   defaultData: { text: '', genre: '科幻', style: '电影感', ratio: '16:9', duration: 30, video_mode: 'auto_full', characters: [], scenes: [], props: [], storyboard: [], shots: [], character_urls: {}, scene_urls: {}, prop_urls: {}, status: 'idle' }, size: { width: 280, height: 430 } },
  // ── 资产生成 ──────────────────────────────────────────────
  { type: 'character',   label: '角色',       defaultData: { name: '', description: '', prompt: '', reference: [], style: '电影感', pose: '', expression: '', seed: '', character_id: '' }, size: { width: 280, height: 620 } },
  { type: 'scene',       label: '场景',       defaultData: { name: '', location: '', time: '白天', weather: '晴', camera: 'wide shot', description: '', prompt: '', style: '电影感', reference: [], scene_id: '' }, size: { width: 280, height: 520 } },
  { type: 'prop',        label: '道具',       defaultData: { name: '', description: '', prompt: '', reference: [], bind_type: '', bind_id: '', prop_id: '' }, size: { width: 280, height: 480 } },
  // ── 分镜 ─────────────────────────────────────────────────
  { type: 'storyboard',  label: '分镜',       defaultData: { shots: [], total_duration: 0, ratio: '16:9', style: '电影感' }, size: { width: 340, height: 640 } },
  // ── 媒体生成 ──────────────────────────────────────────────
  { type: 'image',       label: '图片',       defaultData: { prompt: '', negative: '', reference: [], character_ids: [], scene_id: '', ratio: '16:9', style: '电影感', model: '', url: '' }, size: { width: 280, height: 520 } },
  { type: 'video',       label: '视频',       defaultData: { prompt: '', images: [], character_ids: [], camera: 'static', duration: 10, fps: 24, ratio: '16:9', style: '电影感', renderer_id: '', video_url: '' }, size: { width: 300, height: 640 } },
  // ── 后期 ─────────────────────────────────────────────────
  { type: 'audio',       label: '声音',       defaultData: { type: 'narration', script: '', voice: '默认', music_url: '', sfx_urls: [], audio_url: '' }, size: { width: 260, height: 240 } },
  { type: 'subtitle',    label: '字幕',       defaultData: { video_url: '', audio_url: '', format: 'srt', content: '', burnt_in: false, subtitle_url: '' }, size: { width: 260, height: 240 } },
  { type: 'layout',      label: '排版',       defaultData: { template: 'film_poster', elements: [], ratio: '16:9' }, size: { width: 280, height: 260 } },
  { type: 'export',      label: '导出',       defaultData: { format: 'mp4', video_url: '', subtitle_url: '', include_storyboard: true, include_subtitles: true, export_path: '' }, size: { width: 260, height: 220 } },
  // ── 通用辅助 ──────────────────────────────────────────────
  { type: 'prompt',      label: '提示词模板', defaultData: { template: '', query: '' }, size: { width: 260, height: 200 } },
  { type: 'text',        label: '文本',       defaultData: { text: '', kind: 'text', url: '' }, size: { width: 260, height: 220 } },
  { type: 'note',        label: '便签',       defaultData: { text: '', kind: 'text', url: '' }, size: { width: 240, height: 180 } },
  { type: 'ai_result',   label: 'AI 结果',    defaultData: { text: '', kind: 'text', url: '' }, size: { width: 260, height: 220 } },
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
