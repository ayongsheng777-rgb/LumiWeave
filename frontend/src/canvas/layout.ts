import type { Node, Edge } from '@xyflow/react'

// 简单 DAG 分层布局：depth = max(parent depth) + 1，x=depth*360，y=层内序号*220
export function dagLayout(nodes: Node[], edges: Edge[]): Node[] {
  const depth: Record<string, number> = {}
  const parents: Record<string, string[]> = {}
  nodes.forEach((n) => {
    depth[n.id] = 0
    parents[n.id] = []
  })
  edges.forEach((e) => {
    if (parents[e.target]) parents[e.target].push(e.source)
  })

  // 迭代求深度（最多 nodes.length 轮）
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

  return nodes.map((n) => {
    const d = depth[n.id]
    const idx = (layers[d] || []).indexOf(n)
    return { ...n, position: { x: 80 + d * 340, y: 80 + idx * 200 } }
  })
}
