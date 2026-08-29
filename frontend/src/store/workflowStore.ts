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
import { runWorkflow, workflowList, workflowLoad, workflowSave } from '../api'
import { dagLayout } from '../canvas/layout'
import { NODE_DEFAULTS } from './nodeLibrary'

// 兼容旧引用路径（单一事实源在 ./nodeLibrary.ts）
export { NODE_DEFAULTS }

export type NodeStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

// =====================================================================
// 影视创作节点系统 V2 — 13种节点默认数据
// 🔴 单一事实源在 ./nodeLibrary.ts（与 canvasStore 共用，加节点只改那里）
// =====================================================================

export type FilmNodeType =
  | 'story' | 'character' | 'scene' | 'prop'
  | 'storyboard' | 'image' | 'video'
  | 'audio' | 'subtitle' | 'layout' | 'export'
  | 'prompt'

// 兼容旧代码（外部可能传旧 type）
const LEGACY_DEFAULTS: Record<string, Record<string, unknown>> = {
  input: { text: '' },
  llm: { prompt: '', temperature: 0.3 },
  output: { text: '' },
  render: { prompt: '', model: '' },
}

export function defaultDataFor(type: string): Record<string, unknown> {
  return { ...((NODE_DEFAULTS[type] || LEGACY_DEFAULTS[type]) ?? {}) }
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
      type: (n.type || 'text') as string,
      data: (n.data || {}) as Record<string, unknown>,
      // position 必须落库：丢了坐标 React Flow 渲染时读 position.x 会直接崩掉整个应用（白板）
      position: n.position ?? { x: 0, y: 0 },
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
  toggleLock: (id: string) => void
  applyAutoLayout: () => void
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
  // 撤销 / 重做（返回 / 前进）
  undoStack: GraphSnapshot[]
  redoStack: GraphSnapshot[]
  snapshot: () => void
  undo: () => void
  redo: () => void
}

/** 画布历史快照（撤销/重做用） */
export interface GraphSnapshot {
  nodes: Node[]
  edges: Edge[]
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
  undoStack: [],
  redoStack: [],

  // 撤销 / 重做：变更画布前先快照，最多保留 50 步
  snapshot: () =>
    set((s) => ({
      undoStack: [...s.undoStack, { nodes: s.nodes, edges: s.edges }].slice(-50),
      redoStack: [],
    })),
  undo: () =>
    set((s) => {
      if (s.undoStack.length === 0) return s
      const prev = s.undoStack[s.undoStack.length - 1]
      return {
        nodes: prev.nodes,
        edges: prev.edges,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, { nodes: s.nodes, edges: s.edges }],
      }
    }),
  redo: () =>
    set((s) => {
      if (s.redoStack.length === 0) return s
      const next = s.redoStack[s.redoStack.length - 1]
      return {
        nodes: next.nodes,
        edges: next.edges,
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, { nodes: s.nodes, edges: s.edges }],
      }
    }),

  onNodesChange: (changes) => set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),
  onEdgesChange: (changes) => set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),
  onConnect: (conn) =>
    set((s) => {
      get().snapshot()
      return { edges: addEdge(conn, s.edges) }
    }),

  addNode: (node) =>
    set((s) => {
      get().snapshot()
      return { nodes: [...s.nodes, node] }
    }),
  updateNodeData: (id, data) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
    })),
  removeNode: (id) =>
    set((s) => {
      get().snapshot()
      return {
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      }
    }),

  toggleLock: (id) =>
    set((s) => {
      get().snapshot()
      return {
        nodes: s.nodes.map((n) =>
          n.id === id ? { ...n, data: { ...(n.data as object), locked: !((n.data as Record<string, unknown>).locked === true) } } : n,
        ),
      }
    }),

  clearAll: () => {
    get().snapshot()
    set({ nodes: [], edges: [], nodeStatus: {}, nodeOutputs: {}, workflowId: '' })
  },

  applyAutoLayout: () => set((s) => ({ nodes: dagLayout(s.nodes, s.edges) })),

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
      // 出结果后自动排列一次，避免节点内容变化导致重叠
      get().applyAutoLayout()
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
      let nodes: Node[] = g.nodes || []
      // 兜底：旧版本保存时没存 position，缺坐标的节点交给 DAG 布局补齐，
      // 否则 React Flow 渲染时读 position.x 直接抛 TypeError，整个应用白板
      if (nodes.some((n) => !n.position || typeof n.position.x !== 'number' || typeof n.position.y !== 'number')) {
        nodes = dagLayout(nodes, g.edges || [])
      }
      set({
        nodes,
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
    // 刷新后恢复上次打开的工作流（真正的数据在 PG，localStorage 只记「上次打开哪个」）。
    // 兜底：没记过「上次」时，自动加载项目里最新一条工作流（否则画布永远空白）。
    try {
      const last = localStorage.getItem('lumiweave_last_wf')
      if (last) {
        await get().loadWorkflow(last)
        return
      }
      const res = await workflowList(get().projectId)
      const list = (res.data?.workflows as { id: string }[]) || []
      if (list.length > 0) await get().loadWorkflow(list[0].id)
    } catch {
      /* ignore */
    }
  },
}))
