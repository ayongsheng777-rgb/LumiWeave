/**
 * 场景画布一键排列（2026-08-30，三场景通用）。
 *
 * 血缘分层 + 同类成列：
 * - 层级 = 血缘连线（含 payload.source_object_id 推导）的最长深度，从左到右排；
 *   商品/剧情等源头在最左，派生物料（图/视频/音频）逐级向右。
 * - 同一层内按对象类型分组，同类型节点纵向排成整齐一列（如场景图×3、卖点图×5），
 *   组与组之间留额外间隔。
 * - 尺寸取节点实测/声明宽高，保证不重叠。
 */
import type { Node, Edge } from '@xyflow/react'

type AnyObj = Record<string, unknown>

const GAP_X = 100 // 层与层之间的横向间隔
const GAP_Y = 48 // 同组内节点纵向间隔
const GAP_GROUP = 96 // 同层内不同类型组之间的额外间隔
const MARGIN = 80

function sizeOf(n: Node): { w: number; h: number } {
  const m = (n as Node & { measured?: { width?: number; height?: number } }).measured
  if (m?.width && m?.height) return { w: m.width, h: m.height }
  const st = (n.style || {}) as { width?: number | string; height?: number | string }
  return { w: Number(st.width) || 300, h: Number(st.height) || 220 }
}

function typeOf(n: Node): string {
  return String((n.data as AnyObj)?.objectType || 'text')
}

/** 血缘父节点：优先显式连线，其次 payload.source_object_id 推导 */
function lineageParents(nodes: Node[], edges: Edge[]): Map<string, string[]> {
  const ids = new Set(nodes.map((n) => n.id))
  const parents = new Map<string, string[]>()
  nodes.forEach((n) => parents.set(n.id, []))
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) parents.get(e.target)!.push(e.source)
  }
  for (const n of nodes) {
    const src = String(((n.data as AnyObj)?.payload as AnyObj)?.source_object_id || '')
    if (src && ids.has(src) && src !== n.id && !parents.get(n.id)!.includes(src)) {
      parents.get(n.id)!.push(src)
    }
  }
  return parents
}

/** 计算每个节点的层级（最长路径深度；有环时按迭代上限兜底） */
function depthsOf(nodes: Node[], parents: Map<string, string[]>): Map<string, number> {
  const depth = new Map<string, number>()
  nodes.forEach((n) => depth.set(n.id, 0))
  for (let i = 0; i < nodes.length; i++) {
    let changed = false
    for (const n of nodes) {
      for (const p of parents.get(n.id) || []) {
        const nd = (depth.get(p) || 0) + 1
        if (nd > depth.get(n.id)!) {
          depth.set(n.id, nd)
          changed = true
        }
      }
    }
    if (!changed) break
  }
  return depth
}

/** 主入口：返回 { 节点id: 新坐标 }（不改动原数组） */
export function sceneAutoLayout(nodes: Node[], edges: Edge[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  if (!nodes.length) return out

  const parents = lineageParents(nodes, edges)
  const depth = depthsOf(nodes, parents)

  // 按层分组（保持画布原顺序作为组内稳定序）
  const layers = new Map<number, Node[]>()
  for (const n of nodes) {
    const d = depth.get(n.id) || 0
    if (!layers.has(d)) layers.set(d, [])
    layers.get(d)!.push(n)
  }
  const sortedDepths = [...layers.keys()].sort((a, b) => a - b)

  // 每层 x 起点：累计上一层最大宽度
  const layerX = new Map<number, number>()
  let x = MARGIN
  for (const d of sortedDepths) {
    layerX.set(d, x)
    const maxW = Math.max(...layers.get(d)!.map((n) => sizeOf(n).w))
    x += maxW + GAP_X
  }

  // 层内：按类型分组，同组纵向排列，组间加 GAP_GROUP
  for (const d of sortedDepths) {
    const list = layers.get(d)!
    const groups = new Map<string, Node[]>()
    for (const n of list) {
      const t = typeOf(n)
      if (!groups.has(t)) groups.set(t, [])
      groups.get(t)!.push(n)
    }
    let y = MARGIN
    for (const [, members] of groups) {
      for (const n of members) {
        out.set(n.id, { x: layerX.get(d)!, y })
        y += sizeOf(n).h + GAP_Y
      }
      y += GAP_GROUP - GAP_Y // 组间额外间隔（组内最后一个已含 GAP_Y，补差额）
    }
  }
  return out
}

/** 找出缺失的血缘连线：节点带 source_object_id 但画布上没有 源→它 的边 */
export function missingLineageEdges(nodes: Node[], edges: Edge[]): Array<{ source: string; target: string }> {
  const ids = new Set(nodes.map((n) => n.id))
  const has = new Set(edges.map((e) => `${e.source}→${e.target}`))
  const missing: Array<{ source: string; target: string }> = []
  for (const n of nodes) {
    const src = String(((n.data as AnyObj)?.payload as AnyObj)?.source_object_id || '')
    if (src && ids.has(src) && src !== n.id && !has.has(`${src}→${n.id}`)) {
      missing.push({ source: src, target: n.id })
    }
  }
  return missing
}
