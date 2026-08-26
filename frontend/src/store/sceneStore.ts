/**
 * LumiWeave V2.5 场景引擎前端 Store（规格书 §7 / §9 / §33-§34 / §58）
 *
 * 职责：
 *  - 拉取后端场景注册表（types + object_library），驱动工具条 / Inspector 动态渲染
 *  - 场景实例 CRUD、场景内专业对象与连线的 CRUD
 *  - 对象编辑走「本地立即生效 + 防抖落库」，拖拽/缩放结束时落库
 *  - 场景动作（分析 / 生成 / 批量）统一入口 runAction
 *
 * 约定：ReactFlow 节点统一 type='sceneObject'，真实业务类型放 data.objectType。
 */
import { create } from 'zustand'
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react'
import {
  sceneTypes,
  sceneList,
  sceneCreate,
  sceneGet,
  sceneDelete,
  sceneObjectCreate,
  sceneObjectUpdate,
  sceneObjectDelete,
  sceneEdgeCreate,
  sceneEdgeDelete,
  sceneRunAction,
  type SceneTypeDef,
  type SceneInstance,
  type SceneObjectDTO,
  type SceneEdgeDTO,
  type SceneObjectMeta,
} from '../api'

// ── 动作中文名（§19 动作面板展示用）──────────────────────────────────────
export const ACTION_LABELS: Record<string, string> = {
  analyze_product: '识别商品 / 提炼卖点',
  generate_main_image: '生成主图',
  generate_scene_image: '生成场景图',
  generate_poster: '生成海报',
  generate_detail_page: '生成详情页',
  batch_generate: '批量生成',
  generate_story: '生成剧情',
  generate_characters: '生成人物',
  generate_scenes: '生成场景',
  generate_storyboard: '生成分镜',
  generate_shots: '生成镜头',
  generate_images: '生成图片',
  generate_video: '生成视频',
  analyze_video: '解析视频',
  detect_shots: '检测镜头',
  extract_frames: '提取关键帧',
  analyze_shot: '镜头语言分析',
  generate_prompt: '生成 Prompt',
  generate_reference: '生成参考图',
}

export interface RunLogEntry {
  ts: number
  action: string
  ok: boolean
  message: string
}

/** DTO → ReactFlow 节点 */
function toNode(o: SceneObjectDTO): Node {
  return {
    id: o.id,
    type: 'sceneObject',
    position: { x: Number(o.x) || 0, y: Number(o.y) || 0 },
    data: {
      objectType: o.object_type,
      payload: o.data || {},
      locked: !!o.locked,
      hidden: !!o.hidden,
    },
    style: { width: Number(o.width) || 300, height: Number(o.height) || 200 },
    draggable: !o.locked,
    hidden: !!o.hidden,
  }
}

/** DTO → ReactFlow 连线 */
function toEdge(e: SceneEdgeDTO): Edge {
  return {
    id: e.id,
    source: e.source_id,
    target: e.target_id,
    type: 'smoothstep',
    animated: true,
    style: { stroke: '#8b5cf6', strokeWidth: 2 },
  }
}

// ── 未注册对象类型的兜底元数据（按类型缓存，保证引用稳定）───────────────
const fallbackCache = new Map<string, SceneObjectMeta>()
function fallbackMeta(objectType: string): SceneObjectMeta {
  let m = fallbackCache.get(objectType)
  if (!m) {
    m = { label: objectType, color: '#64748b', fields: {} }
    fallbackCache.set(objectType, m)
  }
  return m
}

// ── 防抖落库 ────────────────────────────────────────────────────────────
const pending = new Map<string, ReturnType<typeof setTimeout>>()
function debouncePersist(key: string, fn: () => void, delay = 600) {
  const prev = pending.get(key)
  if (prev) clearTimeout(prev)
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key)
      fn()
    }, delay),
  )
}

interface SceneState {
  // 注册表
  types: SceneTypeDef[]
  objectLibrary: Record<string, SceneObjectMeta>
  // 实例
  scenes: SceneInstance[]
  currentSceneId: string
  // 画布
  objects: Node[]
  edges: Edge[]
  selectedIds: string[]
  // 状态
  loading: boolean
  busy: string // 正在执行的动作名，空串表示空闲
  runLog: RunLogEntry[]

  init: () => Promise<void>
  reloadScenes: () => Promise<void>
  createScene: (sceneType: string, name?: string) => Promise<string | null>
  openScene: (sceneId: string) => Promise<void>
  removeScene: (sceneId: string) => Promise<void>
  currentScene: () => SceneInstance | undefined
  currentTypeDef: () => SceneTypeDef | undefined
  metaOf: (objectType: string) => SceneObjectMeta

  addObject: (objectType: string, position: { x: number; y: number }) => Promise<void>
  patchObject: (id: string, patch: Record<string, unknown>) => void
  persistGeometry: (id: string) => void
  deleteObjects: (ids: string[]) => Promise<void>
  toggleLock: (id: string) => void

  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (c: Connection) => Promise<void>
  setSelected: (ids: string[]) => void

  runAction: (action: string, objectIds?: string[], params?: Record<string, unknown>) => Promise<void>
  pushLog: (e: RunLogEntry) => void
  clear: () => void
}

const LAST_SCENE_KEY = 'lumiweave_last_scene'

export const useSceneStore = create<SceneState>((set, get) => ({
  types: [],
  objectLibrary: {},
  scenes: [],
  currentSceneId: '',
  objects: [],
  edges: [],
  selectedIds: [],
  loading: false,
  busy: '',
  runLog: [],

  // ── 初始化：注册表 + 场景列表，并自动打开上次场景 ──────────────────
  init: async () => {
    set({ loading: true })
    try {
      const [tRes, lRes] = await Promise.all([sceneTypes(), sceneList()])
      if (tRes.ok) {
        set({
          types: (tRes.data?.types || []) as SceneTypeDef[],
          objectLibrary: (tRes.data?.object_library || {}) as Record<string, SceneObjectMeta>,
        })
      }
      const scenes = (lRes.ok ? lRes.data?.scenes || [] : []) as SceneInstance[]
      set({ scenes })
      // 优先恢复上次打开的场景，否则打开第一个
      const last = localStorage.getItem(LAST_SCENE_KEY) || ''
      const target = scenes.find((s) => s.id === last)?.id || scenes[0]?.id || ''
      if (target) await get().openScene(target)
    } finally {
      set({ loading: false })
    }
  },

  reloadScenes: async () => {
    const res = await sceneList()
    if (res.ok) set({ scenes: (res.data?.scenes || []) as SceneInstance[] })
  },

  createScene: async (sceneType, name) => {
    const res = await sceneCreate({ scene_type: sceneType, name })
    if (!res.ok) return null
    const scene = res.data?.scene as SceneInstance | undefined
    if (!scene) return null
    await get().reloadScenes()
    await get().openScene(scene.id)
    return scene.id
  },

  openScene: async (sceneId) => {
    set({ loading: true })
    try {
      const res = await sceneGet(sceneId)
      if (!res.ok) return
      const objects = ((res.data?.objects || []) as SceneObjectDTO[]).map(toNode)
      const edges = ((res.data?.edges || []) as SceneEdgeDTO[]).map(toEdge)
      set({ currentSceneId: sceneId, objects, edges, selectedIds: [] })
      localStorage.setItem(LAST_SCENE_KEY, sceneId)
    } finally {
      set({ loading: false })
    }
  },

  removeScene: async (sceneId) => {
    await sceneDelete(sceneId)
    await get().reloadScenes()
    if (get().currentSceneId === sceneId) {
      set({ currentSceneId: '', objects: [], edges: [], selectedIds: [] })
      localStorage.removeItem(LAST_SCENE_KEY)
      const next = get().scenes[0]?.id
      if (next) await get().openScene(next)
    }
  },

  currentScene: () => get().scenes.find((s) => s.id === get().currentSceneId),

  currentTypeDef: () => {
    const scene = get().currentScene()
    if (!scene) return undefined
    return get().types.find((t) => t.id === scene.scene_type)
  },

  // 注意：兜底对象必须缓存复用，否则每次调用返回新引用，
  // 在 zustand 选择器里会被判定为「值变了」而引发无限重渲染。
  metaOf: (objectType) => get().objectLibrary[objectType] || fallbackMeta(objectType),

  // ── 对象 ─────────────────────────────────────────────────────────────
  addObject: async (objectType, position) => {
    const sceneId = get().currentSceneId
    if (!sceneId) return
    const meta = get().metaOf(objectType)
    const res = await sceneObjectCreate(sceneId, {
      type: objectType,
      x: Math.round(position.x),
      y: Math.round(position.y),
      width: 300,
      height: 220,
      data: meta.default_data || {},
    })
    if (!res.ok) return
    const obj = res.data?.object as SceneObjectDTO | undefined
    if (!obj) return
    set((s) => ({ objects: [...s.objects, toNode(obj)], selectedIds: [obj.id] }))
  },

  /** 编辑对象字段：本地立即生效 + 防抖落库 */
  patchObject: (id, patch) => {
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id
          ? { ...o, data: { ...o.data, payload: { ...(o.data.payload as object), ...patch } } }
          : o,
      ),
    }))
    const sceneId = get().currentSceneId
    debouncePersist(`obj:${id}`, () => {
      const node = get().objects.find((o) => o.id === id)
      if (!node || !sceneId) return
      void sceneObjectUpdate(sceneId, id, { data: node.data.payload })
    })
  },

  /** 拖拽 / 缩放结束后把几何信息落库 */
  persistGeometry: (id) => {
    const sceneId = get().currentSceneId
    const node = get().objects.find((o) => o.id === id)
    if (!node || !sceneId) return
    const style = (node.style || {}) as { width?: number; height?: number }
    void sceneObjectUpdate(sceneId, id, {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      width: Math.round(Number(node.width ?? style.width ?? 300)),
      height: Math.round(Number(node.height ?? style.height ?? 220)),
    })
  },

  deleteObjects: async (ids) => {
    const sceneId = get().currentSceneId
    if (!sceneId || !ids.length) return
    set((s) => ({
      objects: s.objects.filter((o) => !ids.includes(o.id)),
      edges: s.edges.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)),
      selectedIds: s.selectedIds.filter((i) => !ids.includes(i)),
    }))
    await Promise.all(ids.map((id) => sceneObjectDelete(sceneId, id)))
  },

  toggleLock: (id) => {
    const sceneId = get().currentSceneId
    let locked = false
    set((s) => ({
      objects: s.objects.map((o) => {
        if (o.id !== id) return o
        locked = !(o.data.locked === true)
        return { ...o, draggable: !locked, data: { ...o.data, locked } }
      }),
    }))
    if (sceneId) void sceneObjectUpdate(sceneId, id, { locked })
  },

  // ── ReactFlow 事件 ───────────────────────────────────────────────────
  onNodesChange: (changes) => {
    set((s) => ({ objects: applyNodeChanges(changes, s.objects) }))
    // 拖拽 / 缩放结束 → 落库
    for (const c of changes) {
      if (c.type === 'position' && c.dragging === false) get().persistGeometry(c.id)
      if (c.type === 'dimensions' && c.resizing === false) get().persistGeometry(c.id)
    }
    const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id)
    if (removed.length) void get().deleteObjects(removed)
  },

  onEdgesChange: (changes) => {
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }))
    const sceneId = get().currentSceneId
    for (const c of changes) {
      if (c.type === 'remove' && sceneId) void sceneEdgeDelete(sceneId, c.id)
    }
  },

  onConnect: async (c) => {
    const sceneId = get().currentSceneId
    if (!sceneId || !c.source || !c.target) return
    const res = await sceneEdgeCreate(sceneId, { source: c.source, target: c.target })
    if (!res.ok) return
    const id = (res.data?.edge?.id as string) || `tmp_${c.source}_${c.target}`
    set((s) => ({
      edges: [
        ...s.edges,
        {
          id,
          source: c.source as string,
          target: c.target as string,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#8b5cf6', strokeWidth: 2 },
        },
      ],
    }))
  },

  setSelected: (ids) => set({ selectedIds: ids }),

  // ── 动作 ─────────────────────────────────────────────────────────────
  runAction: async (action, objectIds, params) => {
    const sceneId = get().currentSceneId
    if (!sceneId) return
    set({ busy: action })
    try {
      const res = await sceneRunAction(sceneId, {
        action,
        object_ids: objectIds && objectIds.length ? objectIds : get().selectedIds,
        parameters: params || {},
      })
      const ok = !!res.ok && res.data?.ok !== false
      get().pushLog({
        ts: Date.now(),
        action,
        ok,
        message: ok
          ? String(res.data?.message || '执行完成')
          : String(res.data?.error || '执行失败'),
      })
      // 动作会新增/改写对象，重新拉取当前场景
      if (ok) await get().openScene(sceneId)
    } catch (err) {
      get().pushLog({ ts: Date.now(), action, ok: false, message: String(err) })
    } finally {
      set({ busy: '' })
    }
  },

  pushLog: (e) => set((s) => ({ runLog: [e, ...s.runLog].slice(0, 50) })),

  clear: () => set({ objects: [], edges: [], selectedIds: [] }),
}))
