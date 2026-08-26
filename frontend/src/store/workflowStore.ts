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

export type NodeStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

// =====================================================================
// 影视创作节点系统 V2 — 13种节点默认数据
// 与后端 app/workflow/node_registry.py 的节点 type 完全对齐
// =====================================================================

export type FilmNodeType =
  | 'story' | 'character' | 'scene' | 'prop'
  | 'storyboard' | 'image' | 'video'
  | 'audio' | 'subtitle' | 'layout' | 'export'
  | 'prompt' | 'asset'

export const NODE_DEFAULTS: Record<string, Record<string, unknown>> = {
  // ── 创作入口 ──────────────────────────────────────────────
  image_input: {
    url: '',           // 上传后由后端返回 /uploads/xxx
    filename: '',
    status: 'idle',
  },
  story: {
    text: '',          // 故事原文
    genre: '科幻',      // 类型：科幻/奇幻/爱情/战争/悬疑/喜剧/动作/动画
    style: '电影感',    // 风格：电影感/动漫/写实/水彩/3D
    ratio: '16:9',      // 比例：16:9 / 9:16 / 1:1 / 4:3
    duration: 30,       // 目标时长（秒）
    video_mode: 'auto_full',  // 全流程生成模式：auto_full / auto_firstframe / text2video
    // 执行后填充
    characters: [],    // {id, name, description, prompt}[]
    scenes: [],         // {id, location, time, weather, description}[]
    props: [],          // {id, name, description, prompt}[]
    storyboard: [],     // {shot, camera, duration, description, prompt, character_ids, scene_ids}[]
    shots: [],          // 同 storyboard（兼容）
    character_urls: {}, // {id: url}  生成完成后填入
    scene_urls: {},     // {id: url}
    prop_urls: {},      // {id: url}
    status: 'idle',
  },

  // ── 角色 ─────────────────────────────────────────────────
  character: {
    name: '',
    description: '',
    prompt: '',
    reference: [],     // 参考图 URL[]
    style: '电影感',
    pose: '',
    expression: '',
    // 角色一致性种子（StoryNode 解析后写入，同一角色复用）
    seed: '',
    character_id: '',
    status: 'idle',
  },

  // ── 场景 ─────────────────────────────────────────────────
  scene: {
    name: '',
    location: '',       // 城市/森林/空间站/房间/战场/幻想世界/自定义
    time: '白天',
    weather: '晴',
    camera: 'wide shot',
    description: '',
    prompt: '',
    style: '电影感',
    reference: [],
    scene_id: '',
    status: 'idle',
  },

  // ── 道具 ─────────────────────────────────────────────────
  prop: {
    name: '',
    description: '',
    prompt: '',
    reference: [],
    // 绑定
    bind_type: '',      // 'character' | 'scene' | ''
    bind_id: '',
    prop_id: '',
    status: 'idle',
  },

  // ── 分镜 ─────────────────────────────────────────────────
  storyboard: {
    shots: [],          // [{shot, camera, duration, description, character_id, scene_id, prompt}]
    total_duration: 0,
    ratio: '16:9',
    style: '电影感',
    status: 'idle',
  },

  // ── 图片 ─────────────────────────────────────────────────
  image: {
    prompt: '',
    negative: '',
    reference: [],      // 参考图
    character_ids: [],   // 引用的角色 character_id[]
    scene_id: '',
    ratio: '16:9',
    style: '电影感',
    model: '',           // 'comfyui' | 'flux' | 'midjourney' | ...
    url: '',
    status: 'idle',
  },

  // ── 视频 ─────────────────────────────────────────────────
  video: {
    prompt: '',
    images: [],          // 图片序列 URL[]
    character_ids: [],
    camera: 'static',    // static / dolly / pan-left / pan-right / handheld / orbit / zoom-in
    duration: 10,        // 秒
    fps: 24,
    ratio: '16:9',
    style: '电影感',
    renderer_id: '',     // 渲染器 ID
    video_url: '',
    status: 'idle',
  },

  // ── 声音 ─────────────────────────────────────────────────
  audio: {
    type: 'narration',  // narration / voice_over / bgm / sfx
    script: '',
    voice: '默认',
    music_url: '',
    sfx_urls: [],
    audio_url: '',
    status: 'idle',
  },

  // ── 字幕 ─────────────────────────────────────────────────
  subtitle: {
    video_url: '',
    audio_url: '',
    format: 'srt',       // srt / ass / ssa
    content: '',        // 字幕内容（执行后填充）
    burnt_in: false,
    subtitle_url: '',
    status: 'idle',
  },

  // ── 排版 ─────────────────────────────────────────────────
  layout: {
    template: 'film_poster',  // film_poster / social_short / album_cover / poster_wide
    elements: [],             // [{type, content, position}]
    ratio: '16:9',
    status: 'idle',
  },

  // ── 导出 ─────────────────────────────────────────────────
  export: {
    format: 'mp4',       // mp4 / mov / png / pdf / storyboard_json
    video_url: '',
    subtitle_url: '',
    include_storyboard: true,
    include_subtitles: true,
    export_path: '',
    status: 'idle',
  },

  // ── 保留通用节点 ─────────────────────────────────────────
  prompt: {
    template: '',
    query: '',
    status: 'idle',
  },
  asset: {
    prompt: '',
    assetType: '资产',
    url: '',
    status: 'idle',
  },
}

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
      type: (n.type || 'input') as string,
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

  toggleLock: (id) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...(n.data as object), locked: !((n.data as Record<string, unknown>).locked === true) } } : n,
      ),
    })),

  clearAll: () => set({ nodes: [], edges: [], nodeStatus: {}, nodeOutputs: {}, workflowId: '' }),

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
