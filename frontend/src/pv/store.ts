// =====================================================================
// PixVerse 风格通用画布 · 统一状态中枢
//
// 这一份 store 同时吃下原来「工作流」和「无限画布」两套能力：
//   · 无限画布：节点自由摆放、缩放平移、文本便签
//   · 工作流域：连线表达依赖、按拓扑顺序执行、保存/加载/撤销重做
// 两者在 PixVerse 形态下本就是同一块画布，没必要再分两个 store 两份数据。
// =====================================================================
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
import { renderMedia, workflowLoad, workflowSave, workflowDelete } from '../api'
import { dagLayout } from '../canvas/layout'
import type { ContentType, NodeStatus, PvInputs, PvNodeData, PvNodeTemplate } from './types'
import { GEN_TYPE_META } from './registry'

export type { NodeStatus }

const STORE_KEY = 'lumiweave_last_wf'

/** 画布历史快照（撤销/重做用） */
interface GraphSnapshot {
  nodes: Node[]
  edges: Edge[]
}

let nodeSeq = 0
const nextId = (prefix: string) => `pv_${prefix}_${Date.now()}_${nodeSeq++}`

interface PvState {
  nodes: Node[]
  edges: Edge[]
  running: boolean
  runError: string | null
  projectId: string
  workflowId: string
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  undoStack: GraphSnapshot[]
  redoStack: GraphSnapshot[]
  /** 正在执行的节点 id 集合（用于连线动画） */
  runningIds: string[]

  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (conn: Connection) => void
  addFromTemplate: (tpl: PvNodeTemplate, position: { x: number; y: number }) => string
  updateNodeData: (id: string, data: Partial<PvNodeData>) => void
  setNodeStatus: (id: string, s: NodeStatus, error?: string) => void
  removeNode: (id: string) => void
  clearAll: () => void
  applyAutoLayout: () => void

  /** 收集某个节点从上游连线得到的输入素材 */
  collectInputs: (nodeId: string) => PvInputs
  /** 跑单个生成节点 */
  runNode: (nodeId: string) => Promise<void>
  /** 按依赖顺序跑完整个画布 */
  runAll: () => Promise<void>

  save: () => Promise<void>
  loadWorkflow: (workflowId: string) => Promise<void>
  loadLastWorkflow: () => Promise<void>
  snapshot: () => void
  undo: () => void
  redo: () => void
  setRunError: (e: string | null) => void
}

/** 取节点上的素材地址（生成接口要 file_path，展示要 url） */
function mediaPath(data: PvNodeData | undefined): string {
  if (!data) return ''
  return String(data.file_path || data.url || '')
}

/** 一排最多摆几个，再多就换行 */
const SPOT_COLS = 3

/**
 * 找一个不压住别人的落点。
 * 连续点好几次「添加」时落点都在画布中央，新节点会叠成一坨看不见，
 * 这里按「一排 3 个、放不下换行」的网格往后找空位。
 *
 * 间距必须按节点实际宽度算：写死一个小步长的话，宽节点的首尾会贴死，
 * 右边接点的输出圆点和左边接点的输入圆点会叠在同一个位置，线根本拉不出来。
 */
function findFreeSpot(
  nodes: Node[],
  position: { x: number; y: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  const stepX = size.width + 90
  const stepY = Math.max(size.height, 180) + 90
  const occupied = (p: { x: number; y: number }) =>
    nodes.some(
      (n) => Math.abs(n.position.x - p.x) < stepX - 40 && Math.abs(n.position.y - p.y) < stepY - 40,
    )
  if (!occupied(position)) return position
  for (let i = 1; i <= 60; i += 1) {
    const col = i % SPOT_COLS
    const row = Math.floor(i / SPOT_COLS)
    const candidate = { x: position.x + col * stepX, y: position.y + row * stepY }
    if (!occupied(candidate)) return candidate
  }
  return { x: position.x + stepX, y: position.y + stepY }
}

export const usePvStore = create<PvState>((set, get) => ({
  nodes: [],
  edges: [],
  running: false,
  runError: null,
  projectId: 'default',
  workflowId: '',
  saveStatus: 'idle',
  undoStack: [],
  redoStack: [],
  runningIds: [],

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
      // 同色连线：连线样式在画布层按源节点类型着色，这里只保留结构
      return { edges: addEdge({ ...conn, type: 'smoothstep' }, s.edges) }
    }),

  addFromTemplate: (tpl, position) => {
    const id = nextId(tpl.content_type)
    const data: PvNodeData = {
      kind: tpl.kind,
      content_type: tpl.content_type,
      action: tpl.action,
      title: tpl.label,
      status: 'idle',
      ...tpl.defaultData,
    } as PvNodeData
    const node: Node = {
      id,
      type: tpl.rfType,
      position: findFreeSpot(get().nodes, position, tpl.size),
      data: data as unknown as Record<string, unknown>,
      style: { width: tpl.size.width },
    }
    set((s) => {
      get().snapshot()
      return { nodes: [...s.nodes, node] }
    })
    return id
  },

  updateNodeData: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
    })),

  setNodeStatus: (id, st, error) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, status: st, ...(error ? { error } : { error: '' }) } }
          : n,
      ),
      runningIds:
        st === 'running'
          ? Array.from(new Set([...s.runningIds, id]))
          : s.runningIds.filter((x) => x !== id),
    })),

  removeNode: (id) =>
    set((s) => {
      get().snapshot()
      return {
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      }
    }),

  clearAll: async () => {
    get().snapshot()
    const { workflowId } = get()
    set({ nodes: [], edges: [], runningIds: [], workflowId: '', runError: null })
    try {
      localStorage.removeItem(STORE_KEY)
    } catch {
      /* localStorage 不可用时忽略 */
    }
    if (workflowId) {
      try {
        await workflowDelete(workflowId)
      } catch {
        /* ignore */
      }
    }
  },

  applyAutoLayout: () =>
    set((s) => {
      if (s.nodes.length === 0) return s
      // 进历史，否则点「整理」后撤销，撤掉的是上一次别的改动
      get().snapshot()
      return { nodes: dagLayout(s.nodes, s.edges) }
    }),

  // ── 输入收集：一条连线 = 一份输入素材 ─────────────────────────────
  collectInputs: (nodeId) => {
    const { nodes, edges } = get()
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const inputs: PvInputs = { images: [], videos: [], audios: [] }
    for (const e of edges) {
      if (e.target !== nodeId) continue
      const src = byId.get(e.source)
      const data = src?.data as PvNodeData | undefined
      if (!data) continue
      // 素材节点：直给自己的文件；生成节点：给它的产物
      const p = mediaPath(data)
      if (!p) continue
      const ct: ContentType = data.content_type
      if (ct === 'image') inputs.images.push(p)
      else if (ct === 'video') inputs.videos.push(p)
      else if (ct === 'audio') inputs.audios.push(p)
    }
    return inputs
  },

  // ── 执行：单节点 ──────────────────────────────────────────────────
  runNode: async (nodeId) => {
    const { nodes, collectInputs, setNodeStatus, updateNodeData, setRunError } = get()
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return
    const data = node.data as unknown as PvNodeData
    if (data.kind !== 'generate') {
      setRunError('只有生成节点可以运行')
      return
    }
    const params = data.params
    if (!params?.gen_type) {
      setRunError('这个节点还没选生成方式')
      return
    }
    if (!data.model && !data.profile_id) {
      setRunError(`「${data.title}」还没选模型，先点节点上的模型选择`)
      return
    }

    const meta = GEN_TYPE_META[params.gen_type]
    const inputs = collectInputs(nodeId)

    // 输入校验：缺素材就别白跑一趟，也别浪费积分
    for (const need of meta.needs) {
      const got =
        need.type === 'image' ? inputs.images.length
        : need.type === 'video' ? inputs.videos.length
        : inputs.audios.length
      if (got < need.min) {
        const label = need.type === 'image' ? '图片' : need.type === 'video' ? '视频' : '音频'
        setRunError(`「${data.title}」需要至少 ${need.min} 个${label}输入，请从素材节点连线过来`)
        setNodeStatus(nodeId, 'failed', `缺少${label}输入`)
        return
      }
    }

    setNodeStatus(nodeId, 'running')
    setRunError(null)
    try {
      const isVideo = meta.output === 'video'
      const isAudio = meta.output === 'audio'
      const res = await renderMedia({
        kind: isAudio ? 'audio' : isVideo ? 'video' : 'image',
        render_mode: 'cloud',
        model: data.model || undefined,
        profile_id: data.profile_id || undefined,
        params: {
          prompt: params.prompt || '',
          negative: params.negative || '',
          ratio: params.aspect_ratio || '16:9',
          quality: params.quality || '1080p',
          duration: isVideo ? params.duration ?? 5 : undefined,
          seed: params.seed,
          // 参考素材：图生图/图生视频取图片，参考生视频取视频+图片
          reference_images: inputs.images.length ? inputs.images : undefined,
          reference_videos: inputs.videos.length ? inputs.videos : undefined,
        },
      })
      if (!res.ok) {
        const msg = String((res.data as Record<string, unknown>)?.error || '生成失败')
        setNodeStatus(nodeId, 'failed', msg)
        setRunError(msg)
        return
      }
      const payload = (res.data || {}) as Record<string, unknown>
      const url =
        String(payload.url || '') ||
        (Array.isArray(payload.images) && payload.images.length
          ? String((payload.images[0] as Record<string, unknown>)?.url || '')
          : '') ||
        (Array.isArray(payload.videos) && payload.videos.length
          ? String((payload.videos[0] as Record<string, unknown>)?.url || '')
          : '')
      if (!url) {
        setNodeStatus(nodeId, 'failed', '接口没返回产物地址')
        return
      }
      updateNodeData(nodeId, {
        url,
        file_path: String(payload.file_path || url),
        thumbnail_url: isVideo && !isAudio ? String(payload.thumbnail_url || url) : url,
        status: 'completed',
        error: '',
      } as Partial<PvNodeData>)
      setNodeStatus(nodeId, 'completed')
    } catch (e) {
      const msg = (e as Error).message || '生成失败'
      setNodeStatus(nodeId, 'failed', msg)
      setRunError(msg)
    }
  },

  // ── 执行：按依赖顺序跑全部 ────────────────────────────────────────
  runAll: async () => {
    const { nodes, edges, runNode, setRunError, running } = get()
    if (running) return
    const genNodes = nodes.filter((n) => (n.data as unknown as PvNodeData)?.kind === 'generate')
    if (genNodes.length === 0) {
      setRunError('画布上还没有生成节点')
      return
    }
    // 拓扑排序：保证上游先出结果，下游才能拿到输入
    const indeg = new Map<string, number>()
    const adj = new Map<string, string[]>()
    for (const n of nodes) {
      indeg.set(n.id, 0)
      adj.set(n.id, [])
    }
    for (const e of edges) {
      if (!indeg.has(e.source) || !indeg.has(e.target)) continue
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
      adj.get(e.source)!.push(e.target)
    }
    const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
    const order: string[] = []
    while (queue.length) {
      const cur = queue.shift()!
      order.push(cur)
      for (const nxt of adj.get(cur) ?? []) {
        const d = (indeg.get(nxt) ?? 1) - 1
        indeg.set(nxt, d)
        if (d === 0) queue.push(nxt)
      }
    }
    // 有环时 order 会缺节点，把漏掉的直接追加，避免节点被静默跳过
    for (const n of nodes) if (!order.includes(n.id)) order.push(n.id)

    set({ running: true, runError: null })
    try {
      for (const id of order) {
        const n = nodes.find((x) => x.id === id)
        const d = n?.data as unknown as PvNodeData | undefined
        if (d?.kind !== 'generate') continue
        if (d.status === 'completed') continue // 已出结果的跳过，省积分
        await runNode(id)
        // 上游失败就停，下游拿不到输入继续跑只会连环报错
        const after = usePvStore.getState().nodes.find((x) => x.id === id)
        if (((after?.data as unknown as PvNodeData)?.status) === 'failed') break
      }
    } finally {
      set({ running: false })
    }
  },

  // ── 持久化：复用 workflows.graph 单 JSONB ─────────────────────────
  save: async () => {
    const { nodes, edges, projectId, workflowId } = get()
    if (nodes.length === 0) {
      set({ runError: '画布是空的，没什么可保存的', saveStatus: 'idle' })
      return
    }
    set({ saveStatus: 'saving' })
    try {
      const res = await workflowSave({
        project_id: projectId,
        workflow_id: workflowId || undefined,
        name: '',
        graph: {
          nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type || 'pv_text',
            data: n.data || {},
            position: n.position ?? { x: 0, y: 0 },
          })),
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? null,
            targetHandle: e.targetHandle ?? null,
          })),
        },
      })
      if (res.ok) {
        const wid = res.data.workflow_id as string
        set({ workflowId: wid, saveStatus: 'saved' })
        try {
          localStorage.setItem(STORE_KEY, wid)
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
        set({ runError: '加载画布失败' })
        return
      }
      const g = res.data.graph as { nodes?: Node[]; edges?: Edge[] }
      let nodes: Node[] = g.nodes || []
      const edges: Edge[] = g.edges || []
      // 兜底：旧数据没存坐标，React Flow 读 position.x 会直接崩，交给布局补齐
      if (
        nodes.some(
          (n) => !n.position || typeof n.position.x !== 'number' || typeof n.position.y !== 'number',
        )
      ) {
        nodes = dagLayout(nodes, edges)
      }
      set({ nodes, edges, workflowId, runError: null, runningIds: [] })
      try {
        localStorage.setItem(STORE_KEY, workflowId)
      } catch {
        /* ignore */
      }
    } catch {
      set({ runError: '加载画布失败' })
    }
  },

  loadLastWorkflow: async () => {
    try {
      const last = localStorage.getItem(STORE_KEY)
      if (last) await get().loadWorkflow(last)
    } catch {
      /* ignore */
    }
  },

  setRunError: (e) => set({ runError: e }),
}))
