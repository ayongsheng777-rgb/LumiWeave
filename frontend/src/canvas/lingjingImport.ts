// =====================================================================
// 灵境画布导入器 — 把京东云灵境 /joycreator/canvas/{id} 的 config JSON
// 转换为 LumiWeave 无限画布（canvasStore）的 React Flow 节点/连线
// 数据来源：docs/reference/lingjing/flow_*.json（原版复刻参考档案）
// =====================================================================
import type { Edge, Node } from '@xyflow/react'

/** 灵境节点类型 → LumiWeave 画布节点类型 */
const TYPE_MAP: Record<string, string> = {
  'image-source': 'lj_image_source',
  'image-config': 'lj_image_config',
  'video-config': 'lj_video_config',
  'text-config': 'lj_text_config',
  'script-config': 'lj_script_config',
  'storyboard-config': 'lj_storyboard_config',
  'video-clip': 'lj_video_clip',
}

/** 各类型默认卡片尺寸（对齐灵境观感，略收窄适配本画布） */
const SIZE_MAP: Record<string, { width: number; height: number }> = {
  lj_image_source: { width: 240, height: 300 },
  lj_image_config: { width: 280, height: 360 },
  lj_video_config: { width: 300, height: 380 },
  lj_text_config: { width: 320, height: 300 },
  lj_script_config: { width: 340, height: 320 },
  lj_storyboard_config: { width: 360, height: 320 },
  lj_video_clip: { width: 280, height: 260 },
}

type AnyObj = Record<string, unknown>

function asObj(v: unknown): AnyObj {
  return v && typeof v === 'object' ? (v as AnyObj) : {}
}

function pickMedia(data: AnyObj): { url: string; cover: string; kind: string } {
  const media = asObj(data.media)
  const resources = asObj(media.resources)
  const refs = Array.isArray(media.variantRefs) ? (media.variantRefs as string[]) : Object.keys(resources)
  const sel = typeof media.selectedIndex === 'number' ? media.selectedIndex : 0
  const ref = refs[sel] ?? refs[0]
  const res = asObj(ref ? resources[ref] : undefined)
  if (res.url || res.coverUrl) {
    const kind = String(res.kind ?? 'image')
    return { url: String(res.url ?? ''), cover: String(res.coverUrl ?? res.url ?? ''), kind }
  }
  // 生成类节点回退：取第一个输入图的封面
  const inputs = Array.isArray(data.inputs) ? (data.inputs as AnyObj[]) : []
  const first = asObj(inputs[0])
  if (first.coverUrl || first.url) {
    return { url: String(first.url ?? ''), cover: String(first.coverUrl ?? first.url ?? ''), kind: 'image' }
  }
  return { url: '', cover: '', kind: 'image' }
}

function taskStatus(data: AnyObj): string {
  const task = asObj(asObj(data.media).task)
  const s = String(task.status ?? data.status ?? 'idle')
  return ['completed', 'running', 'failed', 'queued'].includes(s) ? s : 'idle'
}

function taskParams(data: AnyObj): AnyObj {
  return asObj(asObj(asObj(data.media).task).params)
}

export interface LingjingImportResult {
  nodes: Node[]
  edges: Edge[]
  sceneName: string
  skipped: number
}

/**
 * 把灵境画布 JSON（接口原始返回）转为 LumiWeave 画布图。
 * group 节点不入画布：其名称作为场景名返回。
 */
export function convertLingjingFlow(raw: unknown): LingjingImportResult {
  const root = asObj(asObj(raw).result)
  const result = asObj(root.result ?? root)
  const cfg = asObj(result.config)
  const rawNodes = Array.isArray(cfg.nodes) ? (cfg.nodes as AnyObj[]) : []
  const rawEdges = Array.isArray(cfg.edges) ? (cfg.edges as AnyObj[]) : []

  let sceneName = String(result.name ?? '').trim() || '灵境画布'
  let groupCount = 0
  const nodes: Node[] = []

  for (const n of rawNodes) {
    const ljType = String(n.type ?? '')
    if (ljType === 'group') {
      const label = String(asObj(n.data).label ?? '').trim()
      if (label) sceneName = label
      groupCount++
      continue
    }
    const mapped = TYPE_MAP[ljType]
    if (!mapped) continue
    const data = asObj(n.data)
    const pos = asObj(n.position)
    const size = SIZE_MAP[mapped]
    const tp = taskParams(data)
    nodes.push({
      id: String(n.id),
      type: mapped,
      position: { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0) },
      data: {
        ...data,
        // 规范化：Prompt/参数提到顶层，属性编辑与执行共用一个来源
        prompt: String(tp.prompt ?? data.prompt ?? ''),
        ...(tp.generate_audio !== undefined ? { generate_audio: tp.generate_audio === true } : {}),
        ...(tp.duration != null && data.duration == null ? { duration: Number(tp.duration) } : {}),
        status: taskStatus(data),
        _media: pickMedia(data),
        _params: tp,
      },
      style: { width: size.width, height: size.height },
    })
  }

  const ids = new Set(nodes.map((n) => n.id))
  const edges: Edge[] = rawEdges
    .filter((e) => ids.has(String(e.source)) && ids.has(String(e.target)))
    .map((e, i) => ({
      id: String(e.id ?? `lj_edge_${i}`),
      source: String(e.source),
      target: String(e.target),
      type: 'workflow',
      animated: true,
    }))

  return { nodes, edges, sceneName, skipped: rawNodes.length - nodes.length - groupCount }
}

/** 内置三个参考画布（对应 docs/reference/lingjing 档案） */
export const LINGJING_CANVASES = [
  { file: 'flow_10076362.json', name: '电商商品营销物料', id: '10076362' },
  { file: 'flow_10076363.json', name: '电商短剧带货', id: '10076363' },
  { file: 'flow_10076364.json', name: '影视拉片 · AI短片', id: '10076364' },
]

export async function fetchLingjingFlow(file: string): Promise<unknown> {
  const res = await fetch(`/lingjing/${file}`)
  if (!res.ok) throw new Error(`加载失败 HTTP ${res.status}`)
  return res.json()
}
