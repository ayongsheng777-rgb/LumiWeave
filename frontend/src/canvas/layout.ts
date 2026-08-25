import type { Node, Edge } from '@xyflow/react'

// 按节点类型估算的默认尺寸（未实测时兜底），单位 px
const EST_SIZE: Record<string, { w: number; h: number }> = {
  story: { w: 280, h: 430 },
  character: { w: 280, h: 620 },
  scene: { w: 280, h: 520 },
  prop: { w: 280, h: 480 },
  storyboard: { w: 330, h: 640 },
  image: { w: 280, h: 520 },
  video: { w: 300, h: 640 },
  audio: { w: 260, h: 220 },
  subtitle: { w: 260, h: 220 },
  layout: { w: 280, h: 260 },
  export: { w: 260, h: 220 },
  prompt: { w: 260, h: 200 },
  asset: { w: 260, h: 200 },
}

function nodeSize(n: Node): { w: number; h: number } {
  const m = (n as Node & { measured?: { width?: number; height?: number } }).measured
  if (m && m.width && m.height) return { w: m.width, h: m.height }
  if (typeof n.width === 'number' && typeof n.height === 'number') return { w: n.width, h: n.height }
  return EST_SIZE[String(n.type || '')] || { w: 260, h: 200 }
}

// 尺寸感知的 DAG 分层布局：depth = max(parent depth) + 1。
// 同一层节点纵向排列（累计各自高度 + vGap），不同层横向排列（累计上一层最大宽度 + hGap），
// 保证节点之间不重叠、留足间隔。
export function dagLayout(
  nodes: Node[],
  edges: Edge[],
  opts?: { hGap?: number; vGap?: number; margin?: number },
): Node[] {
  const hGap = opts?.hGap ?? 80
  const vGap = opts?.vGap ?? 60
  const margin = opts?.margin ?? 60

  const depth: Record<string, number> = {}
  const parents: Record<string, string[]> = {}
  nodes.forEach((n) => {
    depth[n.id] = 0
    parents[n.id] = []
  })
  edges.forEach((e) => {
    if (parents[e.target]) parents[e.target].push(e.source)
  })

  for (let i = 0; i < nodes.length; i++) {
    let changed = false
    nodes.forEach((n) => {
      for (const p of parents[n.id]) {
        const nd = depth[p] + 1
        if (nd > depth[n.id]) {
          depth[n.id] = nd
          changed = true
        }
      }
    })
    if (!changed) break
  }

  // 按层分组
  const layers: Record<number, Node[]> = {}
  nodes.forEach((n) => {
    const d = depth[n.id]
    ;(layers[d] = layers[d] || []).push(n)
  })

  const sortedLayers = Object.keys(layers)
    .map(Number)
    .sort((a, b) => a - b)

  // 计算每层 x 起点（累计上一层最大宽度 + hGap）
  let x = margin
  const layerX: Record<number, number> = {}
  const layerMaxW: Record<number, number> = {}
  for (const d of sortedLayers) {
    layerX[d] = x
    const maxW = Math.max(...(layers[d] || []).map((n) => nodeSize(n).w))
    layerMaxW[d] = maxW
    x += maxW + hGap
  }

  // 层内纵向排列（累计各自高度 + vGap）
  return nodes.map((n) => {
    const d = depth[n.id]
    const list = layers[d] || []
    const idx = list.indexOf(n)
    let y = margin
    for (let i = 0; i < idx; i++) {
      y += nodeSize(list[i]).h + vGap
    }
    return { ...n, position: { x: layerX[d], y } }
  })
}
