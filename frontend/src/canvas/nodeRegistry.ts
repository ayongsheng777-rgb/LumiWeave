// 工作流节点注册表：供 NodePalette 分类展示 + 连线类型校验
export interface NodeDefinition {
  type: string
  label: string
  category: string
  color: string
  description: string
  inputs: string[]
  outputs: string[]
  executable?: boolean
}

export const NODE_REGISTRY: NodeDefinition[] = [
  // 基础
  { type: 'text', label: '文本', category: '基础', color: '#8b5cf6', description: '纯文本块', inputs: [], outputs: ['text'] },
  { type: 'note', label: '便签', category: '基础', color: '#f59e0b', description: '随手记', inputs: [], outputs: ['text'] },
  { type: 'prompt', label: '提示词', category: '基础', color: '#10b981', description: '提示词块', inputs: ['text'], outputs: ['prompt'] },
  { type: 'output', label: '输出', category: '基础', color: '#64748b', description: '汇总输出结果', inputs: ['image', 'video', 'audio', 'text', 'json'], outputs: [] },
  // AI
  { type: 'input', label: '故事输入', category: 'AI', color: '#8b5cf6', description: '输入故事/广告需求', inputs: [], outputs: ['text'] },
  { type: 'analyze', label: 'AI 剧本解析', category: 'AI', color: '#10b981', description: '解析出角色/场景/道具/分镜', inputs: ['text'], outputs: ['json'], executable: true },
  { type: 'agent', label: '智能体', category: 'AI', color: '#8b5cf6', description: '调用某个智能体', inputs: ['text'], outputs: ['text'], executable: true },
  { type: 'skill', label: '技能', category: 'AI', color: '#f59e0b', description: '调用技能（抠图/字幕等）', inputs: ['asset'], outputs: ['asset'], executable: true },
  { type: 'ai_result', label: 'AI 结果', category: 'AI', color: '#ef4444', description: '展示 AI 输出', inputs: ['text', 'image', 'video', 'json'], outputs: [] },
  // 生成
  { type: 'asset', label: '资产', category: '生成', color: '#3b82f6', description: '角色/场景/道具图', inputs: ['text', 'prompt'], outputs: ['asset'], executable: true },
  { type: 'image', label: '图片生成', category: '生成', color: '#3b82f6', description: '文生图', inputs: ['prompt', 'image', 'text'], outputs: ['image'], executable: true },
  { type: 'video', label: '视频生成', category: '生成', color: '#ec4899', description: '文生/图生视频', inputs: ['prompt', 'image'], outputs: ['video'], executable: true },
]

export function getNodeDef(type: string): NodeDefinition | undefined {
  return NODE_REGISTRY.find((n) => n.type === type)
}

export function nodeCategories(): string[] {
  return Array.from(new Set(NODE_REGISTRY.map((n) => n.category)))
}
