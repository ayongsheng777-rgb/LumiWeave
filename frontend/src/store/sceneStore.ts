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
import { sceneAutoLayout, missingLineageEdges } from '../scene/autoLayout'
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
  sceneSaveVersion,
  sceneListVersions,
  sceneRestoreVersion,
  sceneListAssets,
  scenePlans,
  sceneSetPlan,
  sceneMarketingTemplates,
  sceneApplyTemplate,
  sceneTaskProgress,
  type SceneTypeDef,
  type SceneInstance,
  type SceneObjectDTO,
  type SceneEdgeDTO,
  type SceneObjectMeta,
  type SceneVersion,
  type SceneAsset,
  type Plan,
  type MarketingTemplate,
} from '../api'

// ── 动作中文名（§19 动作面板展示用）──────────────────────────────────────
export const ACTION_LABELS: Record<string, string> = {
  analyze_product: '识别商品 / 提炼卖点',
  generate_strategy: '生成营销策略',
  generate_visual_board: '生成视觉规划板',
  generate_main_image: '生成主图',
  generate_scene_image: '生成场景图',
  refine_product_image: '精修白底图',
  generate_selling_point_image: '生成卖点图',
  generate_ad_video: '参考生成广告视频',
  generate_poster: '生成海报',
  generate_detail_page: '生成详情页',
  batch_generate: '批量生成',
  generate_story: '生成剧情',
  generate_story_from_text: '从文本生成故事',
  director_start: '导演一键排片',
  generate_characters: '生成人物',
  generate_scenes: '生成场景',
  generate_storyboard: '生成分镜',
  storyboard_import: '从剧本引入分镜',
  generate_shots: '生成镜头',
  generate_images: '生成图片',
  generate_video: '生成视频',
  analyze_video: '解析视频',
  detect_shots: '检测镜头',
  extract_frames: '提取关键帧',
  analyze_shot: '镜头语言分析',
  generate_prompt: '生成 Prompt',
  generate_reference: '生成参考图',
  generate_voiceover: '生成配音稿',
  generate_music: '生成音乐提示词',
  generate_subtitle: '生成字幕',
  compose_final: '合成成片',
  generate_node_image: '节点生成图片',
  generate_node_video: '节点生成视频',
  storyboard_import_ai: 'AI 导入分镜',
  auto_layout: '一键排列',
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
    animated: false,
    style: { stroke: 'var(--brand)', strokeWidth: 2 },
  }
}

// ── 撤销/重做历史栈（§32）────────────────────────────────────────────────
interface Snapshot {
  objects: Node[]
  edges: Edge[]
}
function snapshotOf(s: { objects: Node[]; edges: Edge[] }): Snapshot {
  return {
    objects: s.objects.map((n) => ({
      ...n,
      data: { ...n.data },
      style: { ...(n.style || {}) },
      position: { ...n.position },
    })),
    edges: s.edges.map((e) => ({ ...e, style: { ...(e.style || {}) } })),
  }
}
let lastEditCommit = 0


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
  // 对象级状态（§52 / P1-05）
  objectStatus: Record<string, string>
  // 批量结果（§54 / P1-06）
  batchResult: { total: number; ok: number; failed: number } | null
  // 编辑弹窗（V2.8 UI 重构：节点内容优先，编辑收敛到弹窗）
  modalNodeId: string | null

  // 撤销/重做（§32）
  past: Snapshot[]
  future: Snapshot[]
  canUndo: boolean
  canRedo: boolean
  // 素材库（§37/§38）
  assets: SceneAsset[]
  // 场景版本（§35）
  versions: SceneVersion[]
  // 商业化套餐（§73 / P2-03）
  plans: Plan[]
  currentPlan: Plan | null
  // 营销模板（§26 / P2-01）
  marketingTemplates: MarketingTemplate[]

  init: () => Promise<void>
  reloadScenes: () => Promise<void>
  createScene: (sceneType: string, name?: string) => Promise<string | null>
  openScene: (sceneId: string) => Promise<void>
  removeScene: (sceneId: string) => Promise<void>
  currentScene: () => SceneInstance | undefined
  currentTypeDef: () => SceneTypeDef | undefined
  metaOf: (objectType: string) => SceneObjectMeta
  /** 新节点默认位置：从左上往右横向排列（每行 6 个自动换行） */
  nextObjectPos: () => { x: number; y: number }

  /** 创建对象；成功返回新对象 id，失败返回 null（调用方据此回填 url 等数据） */
  addObject: (objectType: string, position: { x: number; y: number }) => Promise<string | null>
  patchObject: (id: string, patch: Record<string, unknown>) => void
  resizeObject: (id: string, w: number, h: number) => void
  persistGeometry: (id: string) => void
  deleteObjects: (ids: string[]) => Promise<void>
  toggleLock: (id: string) => void
  /** 一键排列：补齐血缘连线 + 分层同类成列布局（三场景通用） */
  autoLayout: () => Promise<void>

  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (c: Connection) => Promise<void>
  setSelected: (ids: string[]) => void

  runAction: (action: string, objectIds?: string[], params?: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>
  pushLog: (e: RunLogEntry) => void
  openNodeModal: (id: string) => void
  closeNodeModal: () => void
  clear: () => void
  setObjectStatus: (id: string, status: string) => void
  setBatchResult: (r: { total: number; ok: number; failed: number } | null) => void

  // 撤销/重做（§32）
  undo: () => void
  redo: () => void
  // 对象复制（§66）
  duplicateObjects: (ids: string[]) => Promise<void>
  // 素材库（§37/§38）
  loadAssets: () => Promise<void>
  addAssetToCanvas: (asset: SceneAsset) => Promise<void>
  // 场景版本（§35）
  saveVersion: (label: string) => Promise<void>
  loadVersions: () => Promise<void>
  restoreVersion: (id: string) => Promise<void>
  // 商业化套餐（§73 / P2-03）
  loadPlans: () => Promise<void>
  setPlan: (planId: string) => Promise<void>
  // 营销模板（§26 / P2-01）
  loadMarketingTemplates: (category?: string) => Promise<void>
  applyMarketingTemplate: (templateId: string) => Promise<void>
}

// 把当前画布压入历史栈（在「会改动画布」的操作之前调用）
function recordHistory(get: () => SceneState, set: (p: Partial<SceneState>) => void) {
  const s = get()
  const snap = snapshotOf(s)
  set({
    past: [...s.past, snap].slice(-50),
    future: [],
    canUndo: true,
    canRedo: false,
  })
}

// 撤销/重做时把快照同步回后端（创建缺失对象 / 删除多余对象 / 更新既有对象）
async function syncCanvas(get: () => SceneState, _set: (p: Partial<SceneState>) => void, snap: Snapshot) {
  const sceneId = get().currentSceneId
  if (!sceneId) return
  const snapIds = new Set(snap.objects.map((o) => o.id))
  const cur = get().objects
  const curIds = new Set(cur.map((o) => o.id))
  for (const id of curIds) {
    if (!snapIds.has(id)) {
      try {
        await sceneObjectDelete(sceneId, id)
      } catch {
        /* noop */
      }
    }
  }
  for (const o of snap.objects) {
    const d = (o.data as { payload?: Record<string, unknown> }).payload || {}
    const st = (o.style || {}) as { width?: number; height?: number }
    if (curIds.has(o.id)) {
      try {
        await sceneObjectUpdate(sceneId, o.id, {
          x: Math.round(o.position.x),
          y: Math.round(o.position.y),
          width: Math.round(Number(o.width ?? st.width ?? 300)),
          height: Math.round(Number(o.height ?? st.height ?? 220)),
          data: d,
          locked: !!(o.data as { locked?: boolean }).locked,
          hidden: !!(o.data as { hidden?: boolean }).hidden,
        })
      } catch {
        /* noop */
      }
    } else {
      try {
        await sceneObjectCreate(sceneId, {
          id: o.id,
          type: (o.data as { objectType?: string }).objectType || 'text',
          x: Math.round(o.position.x),
          y: Math.round(o.position.y),
          width: Math.round(Number(o.width ?? 300)),
          height: Math.round(Number(o.height ?? 220)),
          data: d,
        })
      } catch {
        /* noop */
      }
    }
  }
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
  objectStatus: {},
  batchResult: null,
  modalNodeId: null,
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,
  assets: [],
  versions: [],
  plans: [],
  currentPlan: null,
  marketingTemplates: [],

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
      set({ currentSceneId: sceneId, objects, edges, selectedIds: [], past: [], future: [], canUndo: false, canRedo: false })
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
  // 默认摆放：从左上角向右排，每行 6 个（节点宽 300 + 间距 40），换行后 y 递增
  nextObjectPos: () => {
    const n = get().objects.length
    const perRow = 6
    return { x: 100 + (n % perRow) * 340, y: 120 + Math.floor(n / perRow) * 240 }
  },

  addObject: async (objectType, position) => {
    const sceneId = get().currentSceneId
    if (!sceneId) return null
    recordHistory(get, set)
    const meta = get().metaOf(objectType)
    const res = await sceneObjectCreate(sceneId, {
      type: objectType,
      x: Math.round(position.x),
      y: Math.round(position.y),
      width: 300,
      height: 220,
      data: meta.default_data || {},
    })
    if (!res.ok) return null
    const obj = res.data?.object as SceneObjectDTO | undefined
    if (!obj) return null
    set((s) => ({ objects: [...s.objects, toNode(obj)], selectedIds: [obj.id] }))
    return obj.id
  },

  /** 编辑对象字段：本地立即生效 + 防抖落库 */
  patchObject: (id, patch) => {
    // 连续输入合并为一次撤销步骤
    const now = Date.now()
    if (now - lastEditCommit > 700) {
      lastEditCommit = now
      recordHistory(get, set)
    }
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

  /** 文本自适应（界面重构）：按内容自动撑高节点卡片（仅高度），防抖落库 */
  resizeObject: (id, w, h) => {
    const sceneId = get().currentSceneId
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, width: Math.round(w), height: Math.round(h) } : o,
      ),
    }))
    if (sceneId) {
      debouncePersist(`resize:${id}`, () => {
        void sceneObjectUpdate(sceneId, id, { width: Math.round(w), height: Math.round(h) })
      })
    }
  },

  deleteObjects: async (ids) => {
    const sceneId = get().currentSceneId
    if (!sceneId || !ids.length) return
    recordHistory(get, set)
    set((s) => ({
      objects: s.objects.filter((o) => !ids.includes(o.id)),
      edges: s.edges.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)),
      selectedIds: s.selectedIds.filter((i) => !ids.includes(i)),
    }))
    await Promise.all(ids.map((id) => sceneObjectDelete(sceneId, id)))
  },

  toggleLock: (id) => {
    const sceneId = get().currentSceneId
    recordHistory(get, set)
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

  // ── 一键排列（2026-08-30）：先补血缘连线，再分层同类成列布局，最后批量落库 ──
  autoLayout: async () => {
    const sceneId = get().currentSceneId
    if (!sceneId || !get().objects.length) return
    recordHistory(get, set)
    // 1) 补齐缺失的血缘连线（源节点须在画布上；单个失败不阻塞整体）
    const missing = missingLineageEdges(get().objects, get().edges)
    const newEdges: Edge[] = []
    for (const m of missing) {
      try {
        const res = await sceneEdgeCreate(sceneId, { source: m.source, target: m.target })
        const id = (res.data?.edge?.id as string) || `tmp_${m.source}_${m.target}`
        newEdges.push({
          id, source: m.source, target: m.target, type: 'smoothstep', animated: false,
          style: { stroke: 'var(--brand)', strokeWidth: 2 },
        })
      } catch {
        /* noop */
      }
    }
    if (newEdges.length) set((s) => ({ edges: [...s.edges, ...newEdges] }))
    // 2) 计算新坐标并应用
    const pos = sceneAutoLayout(get().objects, get().edges)
    set((s) => ({
      objects: s.objects.map((n) => {
        const p = pos.get(n.id)
        return p ? { ...n, position: p } : n
      }),
    }))
    // 3) 批量落库（位置持久化，刷新不丢）
    await Promise.all(
      get().objects.map((n) =>
        sceneObjectUpdate(sceneId, n.id, {
          x: Math.round(n.position.x),
          y: Math.round(n.position.y),
        }).catch(() => undefined),
      ),
    )
    get().pushLog({
      ts: Date.now(),
      action: 'auto_layout',
      ok: true,
      message: `已排列 ${pos.size} 个节点${newEdges.length ? `，补血缘连线 ${newEdges.length} 条` : ''}`,
    })
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
    recordHistory(get, set)
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
          animated: false,
          style: { stroke: 'var(--brand)', strokeWidth: 2 },
        },
      ],
    }))

    // 分镜对话框：分镜(storyboard) / 镜头(shot) 连线进来时，自动复制提示词（只复制提示词）
    const objs = get().objects
    const src = objs.find((o) => o.id === c.source)
    const tgt = objs.find((o) => o.id === c.target)
    const typeOf = (n?: Node) => String((n?.data as { objectType?: string } | undefined)?.objectType || '')
    const promptOf = (n?: Node) => {
      const p = ((n?.data as { payload?: Record<string, unknown> } | undefined)?.payload || {}) as Record<string, unknown>
      const t = typeOf(n)
      if (t === 'storyboard') return String(p.description ?? '')
      if (t === 'shot') return String(p.prompt ?? '')
      return ''
    }
    let dialog: Node | undefined
    let origin: Node | undefined
    if (typeOf(tgt) === 'shot_dialog' && (typeOf(src) === 'storyboard' || typeOf(src) === 'shot')) {
      dialog = tgt
      origin = src
    } else if (typeOf(src) === 'shot_dialog' && (typeOf(tgt) === 'storyboard' || typeOf(tgt) === 'shot')) {
      dialog = src
      origin = tgt
    }
    if (dialog && origin) {
      const text = promptOf(origin)
      if (text) get().patchObject(dialog.id, { prompt: text })
    }
  },

  setSelected: (ids) => set({ selectedIds: ids }),

  // ── 动作 ─────────────────────────────────────────────────────────────
  runAction: async (action, objectIds, params) => {
    const sceneId = get().currentSceneId
    if (!sceneId) return
    recordHistory(get, set)
    const targetIds = objectIds && objectIds.length ? objectIds : get().selectedIds
    set({ busy: action })
    // 目标对象置 running（§52 / P1-05）
    set((st) => {
      const next = { ...st.objectStatus }
      for (const id of targetIds) next[id] = 'running'
      return { objectStatus: next }
    })
    try {
      const res = await sceneRunAction(sceneId, {
        action,
        object_ids: targetIds,
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
      // 状态回写
      set((st) => {
        const next = { ...st.objectStatus }
        for (const id of targetIds) next[id] = ok ? 'completed' : 'failed'
        return { objectStatus: next }
      })
      // 批量结果（§54 / P1-06 同步版；P2-06 真异步轮询）
      const results = res.data?.results as Array<{ skus?: unknown[] }> | undefined
      if (Array.isArray(results)) {
        const okCount = results.filter((r) => Array.isArray(r?.skus) && r.skus.length).length
        set({ batchResult: { total: results.length, ok: okCount, failed: results.length - okCount } })
      } else if (res.data?.async && res.data?.task_id) {
        const taskId = String(res.data.task_id)
        for (let i = 0; i < 200; i++) {
          await new Promise((r) => setTimeout(r, 1500))
          const pr = await sceneTaskProgress(sceneId, taskId)
          const t = pr.data?.task as { status?: string; done?: number; total?: number } | undefined
          if (t) set({ batchResult: { total: t.total || 1, ok: t.done || 0, failed: 0 } })
          if (t?.status === 'completed' || t?.status === 'failed') break
        }
      } else {
        set({ batchResult: null })
      }
      // 动作会新增/改写对象，重新拉取当前场景
      if (ok) await get().openScene(sceneId)
      return res
    } catch (err) {
      get().pushLog({ ts: Date.now(), action, ok: false, message: String(err) })
      set((st) => {
        const next = { ...st.objectStatus }
        for (const id of targetIds) next[id] = 'failed'
        return { objectStatus: next }
      })
      return undefined
    } finally {
      set({ busy: '' })
    }
  },

  pushLog: (e) => set((s) => ({ runLog: [e, ...s.runLog].slice(0, 50) })),

  openNodeModal: (id) => set({ modalNodeId: id }),
  closeNodeModal: () => set({ modalNodeId: null }),

  setObjectStatus: (id, status) =>
    set((s) => ({ objectStatus: { ...s.objectStatus, [id]: status } })),

  setBatchResult: (r) => set({ batchResult: r }),

  clear: () => set({ objects: [], edges: [], selectedIds: [] }),

  // ── 撤销 / 重做（§32）──────────────────────────────────────────────
  undo: () => {
    const s = get()
    if (!s.past.length) return
    const prev = s.past[s.past.length - 1]
    const cur = snapshotOf(s)
    set({
      objects: prev.objects,
      edges: prev.edges,
      past: s.past.slice(0, -1),
      future: [cur, ...s.future].slice(0, 50),
      canUndo: s.past.length > 1,
      canRedo: true,
    })
    void syncCanvas(get, set, prev)
  },

  redo: () => {
    const s = get()
    if (!s.future.length) return
    const next = s.future[0]
    const cur = snapshotOf(s)
    set({
      objects: next.objects,
      edges: next.edges,
      past: [...s.past, cur].slice(-50),
      future: s.future.slice(1),
      canUndo: true,
      canRedo: s.future.length > 1,
    })
    void syncCanvas(get, set, next)
  },

  // ── 对象复制（§66）─────────────────────────────────────────────────
  duplicateObjects: async (ids) => {
    const sceneId = get().currentSceneId
    if (!sceneId || !ids.length) return
    recordHistory(get, set)
    const created: Node[] = []
    for (const id of ids) {
      const node = get().objects.find((o) => o.id === id)
      if (!node) continue
      const d = (node.data as { payload?: Record<string, unknown> }).payload || {}
      const st = (node.style || {}) as { width?: number; height?: number }
      const res = await sceneObjectCreate(sceneId, {
        type: (node.data as { objectType?: string }).objectType || 'text',
        x: Math.round(node.position.x) + 40,
        y: Math.round(node.position.y) + 40,
        width: Math.round(Number(node.width ?? st.width ?? 300)),
        height: Math.round(Number(node.height ?? st.height ?? 220)),
        data: d,
      })
      if (res.ok && res.data?.object) created.push(toNode(res.data.object))
    }
    if (created.length) set((st) => ({ objects: [...st.objects, ...created], selectedIds: created.map((c) => c.id) }))
  },

  // ── 素材库（§37/§38）───────────────────────────────────────────────
  loadAssets: async () => {
    const sceneId = get().currentSceneId
    if (!sceneId) return
    const res = await sceneListAssets(sceneId)
    if (res.ok) set({ assets: (res.data?.assets || []) as SceneAsset[] })
  },

  addAssetToCanvas: async (asset) => {
    const sceneId = get().currentSceneId
    if (!sceneId || !asset.url) return
    recordHistory(get, set)
    const objType = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image'
    const res = await sceneObjectCreate(sceneId, {
      type: objType,
      x: 60 + Math.floor(Math.random() * 200),
      y: 60 + Math.floor(Math.random() * 200),
      width: 280,
      height: 280,
      data: { url: asset.url, prompt: '', asset_id: asset.id, name: asset.name || '素材' },
    })
    if (res.ok && res.data?.object) {
      const n = toNode(res.data.object)
      set((st) => ({ objects: [...st.objects, n], selectedIds: [n.id] }))
    }
  },

  // ── 场景版本（§35）─────────────────────────────────────────────────
  saveVersion: async (label) => {
    const sceneId = get().currentSceneId
    if (!sceneId) return
    const res = await sceneSaveVersion(sceneId, label || '')
    if (res.ok) await get().loadVersions()
  },

  loadVersions: async () => {
    const sceneId = get().currentSceneId
    if (!sceneId) return
    const res = await sceneListVersions(sceneId)
    if (res.ok) set({ versions: (res.data?.versions || []) as SceneVersion[] })
  },

  restoreVersion: async (id) => {
    const sceneId = get().currentSceneId
    if (!sceneId) return
    const res = await sceneRestoreVersion(sceneId, id)
    if (res.ok) {
      await get().openScene(sceneId)
      await get().loadVersions()
    }
  },

  // ── 商业化套餐（§73 / P2-03）─────────────────────────────────────────
  loadPlans: async () => {
    const res = await scenePlans()
    if (res.ok) {
      set({
        plans: (res.data?.plans || []) as Plan[],
        currentPlan: (res.data?.current || null) as Plan | null,
      })
    }
  },

  setPlan: async (planId) => {
    const res = await sceneSetPlan(planId)
    if (res.ok) {
      set({ currentPlan: (res.data?.current || null) as Plan | null })
      await get().loadPlans()
    }
  },

  // ── 营销模板（§26 / P2-01）───────────────────────────────────────────
  loadMarketingTemplates: async (category) => {
    const sceneId = get().currentSceneId
    if (!sceneId) return
    const res = await sceneMarketingTemplates(sceneId, category || '')
    if (res.ok) set({ marketingTemplates: (res.data?.templates || []) as MarketingTemplate[] })
  },

  applyMarketingTemplate: async (templateId) => {
    const sceneId = get().currentSceneId
    if (!sceneId) return
    const res = await sceneApplyTemplate(sceneId, templateId)
    if (res.ok) {
      await get().openScene(sceneId)
      await get().loadAssets()
    }
  },
}))
