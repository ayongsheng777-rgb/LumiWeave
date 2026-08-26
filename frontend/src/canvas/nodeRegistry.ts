// =====================================================================
// 影视创作节点系统 V2 — 节点注册表
// 供 NodePalette 分类展示 + 连线类型校验 + engine 执行路由
// 与后端 app/workflow/node_registry.py 保持 type 完全对齐
// =====================================================================
export interface NodeDefinition {
  type: string
  label: string
  category: string
  color: string
  description: string
  inputs: string[]        // 可接受的 source 类型
  outputs: string[]       // 输出的类型
  executable?: boolean     // 是否有执行器（engine.py 中有逻辑）
}

export const NODE_REGISTRY: NodeDefinition[] = [
  // ── 创作入口 ──────────────────────────────────────────────
  {
    type: 'story',
    label: '故事输入',
    category: '创作入口',
    color: '#8b5cf6',
    description: '输入故事/小说/广告需求，AI 解析生成角色/场景/道具/分镜',
    inputs: [],
    outputs: ['character', 'scene', 'prop', 'storyboard'],
    executable: true,
  },
  // ── 资产生成 ──────────────────────────────────────────────
  {
    type: 'character',
    label: '角色设计',
    category: '资产生成',
    color: '#f43f5e',
    description: '角色生成，支持换装/表情/姿态，一致性种子保持角色连续性',
    inputs: ['story', 'prompt'],
    outputs: ['image'],
    executable: true,
  },
  {
    type: 'scene',
    label: '场景设计',
    category: '资产生成',
    color: '#10b981',
    description: '场景生成，支持城市/森林/空间站等，可调天气/时间/镜头',
    inputs: ['story', 'prompt'],
    outputs: ['image'],
    executable: true,
  },
  {
    type: 'prop',
    label: '关键道具',
    category: '资产生成',
    color: '#f59e0b',
    description: '道具生成，可绑定角色或场景，支持变化版本',
    inputs: ['story', 'character', 'scene', 'prompt'],
    outputs: ['image'],
    executable: true,
  },
  // ── 分镜 ─────────────────────────────────────────────────
  {
    type: 'storyboard',
    label: '电影分镜',
    category: '分镜',
    color: '#f97316',
    description: 'Shot-by-Shot 分镜表，支持 camera/duration/description',
    inputs: ['story', 'character', 'scene'],
    outputs: ['image', 'video'],
    executable: true,
  },
  // ── 媒体生成 ──────────────────────────────────────────────
  {
    type: 'image',
    label: '图片生成',
    category: '媒体生成',
    color: '#0ea5e9',
    description: '文生图/图生图，支持角色一致性/场景/道具/参考图',
    inputs: ['character', 'scene', 'prop', 'storyboard', 'prompt'],
    outputs: ['image'],
    executable: true,
  },
  {
    type: 'video',
    label: '视频生成',
    category: '媒体生成',
    color: '#ec4899',
    description: '文生视频/图生视频，支持运镜/时长/帧率，ComfyUI/Kling/Runway 多引擎',
    inputs: ['image', 'storyboard', 'prompt'],
    outputs: ['video'],
    executable: true,
  },
  // ── 后期 ─────────────────────────────────────────────────
  {
    type: 'audio',
    label: '声音',
    category: '后期制作',
    color: '#14b8a6',
    description: '旁白/角色配音/BGM/音效，支持多种音色',
    inputs: ['storyboard', 'subtitle'],
    outputs: ['audio'],
    executable: true,
  },
  {
    type: 'subtitle',
    label: '字幕',
    category: '后期制作',
    color: '#6366f1',
    description: '语音识别生成字幕，支持 SRT/ASS 格式，可烧录进视频',
    inputs: ['video', 'audio'],
    outputs: ['subtitle'],
    executable: true,
  },
  {
    type: 'layout',
    label: '排版设计',
    category: '后期制作',
    color: '#06b6d4',
    description: '电影海报/社交封面/专辑封面等排版模板',
    inputs: ['image', 'video'],
    outputs: ['image'],
    executable: true,
  },
  {
    type: 'export',
    label: '导出成片',
    category: '后期制作',
    color: '#22c55e',
    description: '导出 MP4/MOV/PNG/PDF 分镜脚本，支持字幕/分镜包',
    inputs: ['video', 'subtitle'],
    outputs: [],
    executable: true,
  },
  // ── 通用辅助 ──────────────────────────────────────────────
  {
    type: 'prompt',
    label: '提示词',
    category: '通用',
    color: '#64748b',
    description: '提示词模板，支持变量替换',
    inputs: ['text'],
    outputs: ['prompt'],
    executable: false,
  },
  {
    type: 'skill',
    label: '技能',
    category: '通用',
    color: '#eab308',
    description: '调用技能（抠图/增强/翻译等）',
    inputs: ['image', 'text'],
    outputs: ['image', 'text'],
    executable: true,
  },
  // ── 兼容旧 type ──────────────────────────────────────────
  {
    type: 'output',
    label: '输出',
    category: '通用',
    color: '#64748b',
    description: '汇总展示节点结果',
    inputs: ['image', 'video', 'audio', 'text', 'json'],
    outputs: [],
    executable: false,
  },
  // 旧名称兼容
  {
    type: 'input',
    label: '输入',
    category: '通用',
    color: '#8b5cf6',
    description: '（兼容）输入节点',
    inputs: [],
    outputs: ['text'],
    executable: false,
  },
]

export function getNodeDef(type: string): NodeDefinition | undefined {
  return NODE_REGISTRY.find((n) => n.type === type)
}

export function nodeCategories(): string[] {
  return Array.from(new Set(NODE_REGISTRY.map((n) => n.category)))
}

// ── V2.5 标准节点注册（规格书 §2）────────────────────────────────────────
export const V2_NODE_REGISTRY: NodeDefinition[] = [
  {
    type: 'prompt',
    label: '提示词',
    category: 'V2.5 标准',
    color: '#8b5cf6',
    description: '文本输入 + AI Prompt 增强 + 场景描述（规格书 §2 PromptNode）',
    inputs: [],
    outputs: ['reference', 'camera', 'lighting', 'motion'],
    executable: false,
  },
  {
    type: 'reference',
    label: '参考图',
    category: 'V2.5 标准',
    color: '#3b82f6',
    description: '商品图 / 人物图 / 风格参考图，支持 IP-Adapter 强度控制',
    inputs: ['prompt'],
    outputs: ['camera', 'lighting', 'render'],
    executable: false,
  },
  {
    type: 'camera',
    label: '镜头',
    category: 'V2.5 标准',
    color: '#10b981',
    description: '焦距 / 景别 / 角度（规格书 §2 CameraNode）',
    inputs: ['prompt', 'reference'],
    outputs: ['lighting', 'motion', 'render'],
    executable: false,
  },
  {
    type: 'lighting',
    label: '灯光',
    category: 'V2.5 标准',
    color: '#f59e0b',
    description: '光向 / 色温 / 强度（规格书 §2 LightingNode）',
    inputs: ['prompt', 'camera'],
    outputs: ['motion', 'render'],
    executable: false,
  },
  {
    type: 'motion',
    label: '运动',
    category: 'V2.5 标准',
    color: '#06b6d4',
    description: '运动类型 / 速度 / 时长（规格书 §2 MotionNode）',
    inputs: ['prompt', 'camera', 'lighting'],
    outputs: ['render'],
    executable: false,
  },
  {
    type: 'render',
    label: '渲染',
    category: 'V2.5 标准',
    color: '#ef4444',
    description: '渲染出口，提交 RenderPlan → 生成 Asset（规格书 §2 RenderNode）',
    inputs: ['prompt', 'reference', 'camera', 'lighting', 'motion'],
    outputs: [],
    executable: true,
  },
]

// 合并到主注册表
NODE_REGISTRY.push(...V2_NODE_REGISTRY)
