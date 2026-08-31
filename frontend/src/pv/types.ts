// =====================================================================
// PixVerse 风格通用画布 · 数据模型
// 对标 app.pixverse.ai/canvas：节点只有「素材 / 生成 / 文本」三类，
// 具体能力由「生成节点选了什么模型」决定 —— 模型库里有什么能力，画布就有什么能力。
// 这样新增一种 AI 能力 = 后端配个模型，前端零改动。
// =====================================================================

/** 媒体形态 */
export type ContentType = 'image' | 'video' | 'audio' | 'text'

/**
 * 节点大类（PixVerse 的 source_type）
 * - asset    ：素材节点，一段确定的图片/视频/音频，只能作为别人的输入
 * - generate ：生成节点，选模型 + 参数 + 引用上游素材，跑一次出一个产物
 * - text     ：文本便签，纯注释用
 */
export type NodeKind = 'asset' | 'generate' | 'text'

/** 素材节点的来源（PixVerse 的 action_type） */
export type AssetAction = 'upload' | 'reference'

/**
 * 连线语义（PixVerse 的 connectionType）
 * - manual     ：普通参考输入
 * - firstFrame ：视频生成的首帧（专用连接点，后端单独传 image_url）
 * - lastFrame  ：视频生成的尾帧（专用连接点，后端单独传 last_frame_url）
 */
export type EdgeConnType = 'manual' | 'firstFrame' | 'lastFrame'

/** 画布视口（跟随 workflows.graph 一起落库，刷新后回到原位） */
export interface PvViewport {
  x: number
  y: number
  zoom: number
}

/**
 * 生成方式（决定节点长什么样、要哪些参数、后端怎么调）
 * 这是「万能」的关键：一个生成节点换个 gen_type 就是另一种能力
 */
export type GenType =
  | 'text_to_image'        // 文生图
  | 'image_to_image'       // 图生图（改画面/换风格/换装）
  | 'text_to_video'        // 文生视频
  | 'image_to_video'       // 图生视频（首帧）
  | 'reference_to_video'   // 参考视频 + 参考图 → 新视频
  | 'text_to_audio'        // 文生音频/配音

export type NodeStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

/** 生成参数 */
export interface PvGenParams {
  prompt: string
  negative?: string
  gen_type: GenType
  /** 16:9 / 9:16 / 1:1 / 4:3 / 3:4 */
  aspect_ratio?: string
  /** 视频时长（秒） */
  duration?: number
  /** 720p / 1080p */
  quality?: string
  seed?: number
  /** 一次生成几份产物（参考站 create_count；云端真实多份，ComfyUI 本地按 1 份） */
  create_count?: number
  /** AI 完善专用模型（V2.9q）：与生成模型解耦，独立持久化 */
  craft_profile_id?: string
}

/** 提示词里的 @image1 引用了哪个节点的素材 */
export interface PvMention {
  token: string      // 'image1'
  nodeId: string
  contentType: ContentType
}

/** 生成节点从上游连线收集到的输入素材（运行时计算，不落库） */
export interface PvInputs {
  images: string[]
  videos: string[]
  audios: string[]
  /** 首帧连线（firstFrame）指定的图片 */
  firstFrame?: string
  /** 尾帧连线（lastFrame）指定的图片 */
  lastFrame?: string
}

export interface PvNodeData extends Record<string, unknown> {
  kind: NodeKind
  content_type: ContentType
  /** asset 节点用 upload/reference；generate/text 节点不用 */
  action?: AssetAction
  title: string

  // ── asset 节点 ──────────────────────────────────────────
  /** 素材访问地址（后端 /uploads/xxx.png） */
  url?: string
  /** 后端落盘相对路径，传给生成接口用 */
  file_path?: string
  thumbnail_url?: string
  filename?: string
  duration?: number
  width?: number
  height?: number

  // ── generate 节点 ───────────────────────────────────────
  /** 模型标识（后端模型库里的 model 字段） */
  model?: string
  /** 模型档位 id（直连 profile 时用；'comfyui' = 本地 ComfyUI 渲染器） */
  profile_id?: string
  /** 生成路由：cloud=云端模型库直连（默认）；comfyui=本地 ComfyUI */
  render_mode?: 'cloud' | 'comfyui'
  params?: PvGenParams
  /** prompt 里 @imageN 与上游节点的映射 */
  mentions?: PvMention[]

  // ── text 节点 ───────────────────────────────────────────
  text?: string

  // ── 运行态 ──────────────────────────────────────────────
  status: NodeStatus
  error?: string
}

/** 节点库里可拖出来的模板 */
export interface PvNodeTemplate {
  /** 拖到画布上后 ReactFlow 的 type（决定用哪个组件渲染） */
  rfType: string
  kind: NodeKind
  content_type: ContentType
  action?: AssetAction
  label: string
  /** 分组名，左侧节点库按此分组 */
  group: string
  /** 图标名（lucide） */
  icon: string
  description: string
  /** 主题色（节点强调色、连线色） */
  color: string
  /** 拖出来时的初始数据；status 统一由 store 置为 idle，这里不用给 */
  defaultData: Omit<Partial<PvNodeData>, 'status'>
  size: { width: number; height: number }
}

/** 宽高比选项 */
export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const

/** 视频时长选项（秒） */
export const DURATION_OPTIONS = [5, 10, 15] as const

/** 清晰度选项 */
export const QUALITY_OPTIONS = ['720p', '1080p'] as const

/** 一次生成数量选项（参考站 create_count） */
export const CREATE_COUNT_OPTIONS = [1, 2, 4] as const

/** 自动编号用的中文名（参考站 nodeTitleCounters：图片 1 / 视频 2 …） */
export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
}
