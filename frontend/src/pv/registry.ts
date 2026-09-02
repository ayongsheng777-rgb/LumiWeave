// =====================================================================
// PixVerse 风格通用画布 · 节点模板库（万能底座的能力清单）
//
// 设计原则：节点不绑定任何业务语义（没有「角色」「场景」「道具」），
// 只描述「输入什么 → 输出什么」。能生成什么，完全取决于后端模型库里配了什么模型。
// 想加一种新能力：后端模型库加一条，前端这里加一个模板即可。
// =====================================================================
import type { ContentType, GenType, PvNodeData, PvNodeTemplate } from './types'

/** 每种生成方式需要什么输入、产出什么 */
export interface GenTypeMeta {
  label: string
  /** 需要的输入素材形态（连线时自动校验） */
  needs: { type: ContentType; min: number }[]
  /** 产出的形态 */
  output: ContentType
  /** 提示词框的占位文案 */
  hint: string
}

export const GEN_TYPE_META: Record<GenType, GenTypeMeta> = {
  text_to_image: {
    label: '文生图',
    needs: [],
    output: 'image',
    hint: '描述你想画的画面',
  },
  image_to_image: {
    label: '图生图',
    needs: [{ type: 'image', min: 1 }],
    output: 'image',
    hint: '用 @ 引用连进来的参考图（按节点标题指代），例如：把 角色图 的风格换成 场景图',
  },
  text_to_video: {
    label: '文生视频',
    needs: [],
    output: 'video',
    hint: '描述镜头内容、运镜和氛围',
  },
  image_to_video: {
    label: '图生视频',
    needs: [{ type: 'image', min: 1 }],
    output: 'video',
    hint: '首帧/尾帧各连一张图，其余参考图连「参考图」口；用 @ 按节点标题指代',
  },
  reference_to_video: {
    label: '参考生视频',
    needs: [{ type: 'video', min: 1 }],
    output: 'video',
    hint: '连一段原视频做参考，用 @ 按节点标题指代，描述要改成什么样',
  },
  text_to_audio: {
    label: '配音 / 音频',
    needs: [],
    output: 'audio',
    hint: '输入要朗读的文案，或描述想要的音效',
  },
}

/** 判断某个 gen_type 是否必须要有连线输入 */
export function genTypeNeedsInput(genType: GenType): boolean {
  return GEN_TYPE_META[genType].needs.length > 0
}

// ── 节点模板 ─────────────────────────────────────────────────────────
const assetBase = {
  kind: 'asset' as const,
}

export const PV_NODE_TEMPLATES: PvNodeTemplate[] = [
  // ── 素材：画布的"原料"，只能作为别人的输入 ──────────────────────
  {
    rfType: 'pv_asset',
    ...assetBase,
    content_type: 'image',
    action: 'upload',
    label: '图片素材',
    group: '素材',
    icon: 'ImagePlus',
    description: '上传一张图片，作为生成节点的参考 / 首帧 / 换装底图',
    color: '#0ea5e9',
    defaultData: { url: '', file_path: '', thumbnail_url: '' },
    size: { width: 260, height: 240 },
  },
  {
    rfType: 'pv_asset',
    ...assetBase,
    content_type: 'video',
    action: 'upload',
    label: '视频素材',
    group: '素材',
    icon: 'Film',
    description: '上传一段视频，作为参考生视频的原型',
    color: '#ec4899',
    defaultData: { url: '', file_path: '', thumbnail_url: '' },
    size: { width: 300, height: 250 },
  },
  {
    rfType: 'pv_asset',
    ...assetBase,
    content_type: 'audio',
    action: 'upload',
    label: '音频素材',
    group: '素材',
    icon: 'Music',
    description: '上传一段音频 / 配音 / 背景音乐',
    color: '#14b8a6',
    defaultData: { url: '', file_path: '' },
    size: { width: 260, height: 160 },
  },

  // ── 生成：画布的"能力"，选模型 + 写提示词 + 连输入 ─────────────────
  {
    rfType: 'pv_generate',
    kind: 'generate',
    content_type: 'image',
    label: '文生图',
    group: '生成',
    icon: 'Sparkles',
    description: '只靠文字描述生成图片',
    color: '#0ea5e9',
    defaultData: {
      params: { prompt: '', negative: '', gen_type: 'text_to_image', aspect_ratio: '16:9', quality: '1080p' },
    },
    size: { width: 300, height: 320 },
  },
  {
    rfType: 'pv_generate',
    kind: 'generate',
    content_type: 'image',
    label: '图生图',
    group: '生成',
    icon: 'Wand2',
    description: '连图进来改画面：换风格、换衣服、改比例、扩图',
    color: '#8b5cf6',
    defaultData: {
      params: { prompt: '', negative: '', gen_type: 'image_to_image', aspect_ratio: '16:9', quality: '1080p' },
    },
    size: { width: 300, height: 340 },
  },
  {
    rfType: 'pv_generate',
    kind: 'generate',
    content_type: 'video',
    label: '文生视频',
    group: '生成',
    icon: 'Clapperboard',
    description: '只靠文字描述生成一段视频',
    color: '#ec4899',
    defaultData: {
      params: {
        prompt: '', negative: '', gen_type: 'text_to_video',
        aspect_ratio: '16:9', quality: '1080p', duration: 5,
      },
    },
    size: { width: 320, height: 360 },
  },
  {
    rfType: 'pv_generate',
    kind: 'generate',
    content_type: 'video',
    label: '图生视频',
    group: '生成',
    icon: 'PlayCircle',
    description: '连一张图当首帧，让它动起来',
    color: '#f43f5e',
    defaultData: {
      params: {
        prompt: '', negative: '', gen_type: 'image_to_video',
        aspect_ratio: '16:9', quality: '1080p', duration: 5,
      },
    },
    size: { width: 320, height: 360 },
  },
  {
    rfType: 'pv_generate',
    kind: 'generate',
    content_type: 'video',
    label: '参考生视频',
    group: '生成',
    icon: 'Copy',
    description: '连一段原视频 + 若干参考图，照着结构换元素重拍',
    color: '#f97316',
    defaultData: {
      params: {
        prompt: '', negative: '', gen_type: 'reference_to_video',
        aspect_ratio: '16:9', quality: '1080p', duration: 10,
      },
    },
    size: { width: 320, height: 380 },
  },
  {
    rfType: 'pv_generate',
    kind: 'generate',
    content_type: 'audio',
    label: '配音 / 音频',
    group: '生成',
    icon: 'AudioLines',
    description: '文案转配音，或生成音效 / 背景音乐',
    color: '#14b8a6',
    defaultData: {
      params: { prompt: '', gen_type: 'text_to_audio' },
    },
    size: { width: 280, height: 260 },
  },

  // ── 辅助 ─────────────────────────────────────────────────────────
  {
    rfType: 'pv_text',
    kind: 'text',
    content_type: 'text',
    label: '文本便签',
    group: '辅助',
    icon: 'StickyNote',
    description: '在画布上记点想法，不参与生成',
    color: '#64748b',
    defaultData: { text: '' },
    size: { width: 240, height: 160 },
  },
]

/** 按分组取模板（左侧节点库渲染用） */
export function templatesByGroup(): { group: string; items: PvNodeTemplate[] }[] {
  const map = new Map<string, PvNodeTemplate[]>()
  for (const t of PV_NODE_TEMPLATES) {
    if (!map.has(t.group)) map.set(t.group, [])
    map.get(t.group)!.push(t)
  }
  return Array.from(map, ([group, items]) => ({ group, items }))
}

/** 模板 key = kind + content_type + gen_type，用于从库里反查模板 */
export function templateKeyOf(data: Partial<PvNodeData>): string {
  const genType = data.params?.gen_type ?? ''
  return `${data.kind}:${data.content_type}:${genType}:${data.action ?? ''}`
}

export function findTemplate(data: Partial<PvNodeData>): PvNodeTemplate | undefined {
  const key = templateKeyOf(data)
  return PV_NODE_TEMPLATES.find((t) => templateKeyOf(t.defaultData) === key)
}

/** 节点配色（节点头、连线都用它） */
export function nodeColor(data: Partial<PvNodeData> | undefined): string {
  if (!data) return '#64748b'
  return findTemplate(data)?.color ?? '#64748b'
}
