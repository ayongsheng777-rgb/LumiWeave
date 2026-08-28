// sceneColors —— 节点配色工具（V2.8 UI 重构）
// 标题色按数据流分类：🟡视觉流(图片/视频)橙黄 / 🔵逻辑流(文本/剧情/导演台等)蓝紫 / 🟢音频流(音频)绿
// 连线色按节点实例：同类型同色系 + id 哈希明度/饱和度偏移（一节点一色，区分关系网）

export type FlowKind = 'visual' | 'logic' | 'audio'

export const FLOW_TITLE_COLORS: Record<FlowKind, string> = {
  visual: '#f59e0b',
  logic: '#6366f1',
  audio: '#10b981',
}

export function classifyFlow(objectType: string): FlowKind {
  if (objectType === 'image' || objectType === 'video' || objectType === 'shot_dialog' || objectType === 'shot' || objectType === 'storyboard' || objectType === 'scene') return 'visual'
  if (objectType === 'audio') return 'audio'
  return 'logic'
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16) / 255
  const g = parseInt(m.slice(2, 4), 16) / 255
  const b = parseInt(m.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break
      case g: h = ((b - r) / d + 2) * 60; break
      default: h = ((r - g) / d + 4) * 60; break
    }
  }
  return { h, s: s * 100, l: l * 100 }
}

/** 节点实例色：类型基准色 + id 哈希偏移（色相 ±8°、饱和度/明度微调），同类型同色系、实例可区分 */
export function nodeInstanceColor(objectType: string, id: string, baseColor?: string): string {
  const base = baseColor || FLOW_TITLE_COLORS[classifyFlow(objectType)]
  const { h, s, l } = hexToHsl(base)
  const n = hashStr(id)
  const dh = (n % 17) - 8 // -8..+8 色相微调
  const ds = ((n >> 3) % 13) - 6 // -6..+6 饱和度
  const dl = ((n >> 6) % 9) - 4 // -4..+4 明度
  const H = (h + dh + 360) % 360
  const S = Math.min(78, Math.max(38, s + ds))
  const L = Math.min(62, Math.max(34, l + dl))
  return `hsl(${H.toFixed(0)}, ${S.toFixed(0)}%, ${L.toFixed(0)}%)`
}
