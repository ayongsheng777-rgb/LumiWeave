// =====================================================================
// 灵境引擎 — 让画布节点"活"起来的执行层（原版架构复刻 P0）
//   1. 连线自动收集为节点输入 inputs（上游节点的当前选中资源）
//   2. Prompt 支持 {{Ref N}} 引用第 N 张输入图
//   3. 执行产生 task 记录，结果作为 resource 版本挂回节点（不覆盖旧版本）
// 数据全部存在画布节点 data 里，随现有 canvasSaveGraph 持久化。
// =====================================================================
import type { Edge, Node } from '@xyflow/react'
import { aiChat, renderMedia, extractVideoFrame } from '../api'
import { useCanvasStore } from '../store/canvasStore'
import { emitLog } from '../components/LogPanel'
import { cameraMotionByName } from './cameraMotions'

type AnyObj = Record<string, unknown>

/** 节点资源的一个版本（灵境 media.resources 的等价物） */
export interface LjResource {
  id: string
  url: string
  cover?: string
  kind: 'image' | 'video' | 'text'
  createdAt: number
}

/** 一次执行的记录（灵境 media.task 的等价物） */
export interface LjTaskRecord {
  id: string
  status: 'completed' | 'failed'
  kind: string
  startedAt: number
  durationMs?: number
  error?: string
}

export interface LjInput {
  nodeId: string
  label: string
  url: string
  cover: string
}

const LJ_PREFIX = 'lj_'

export function isLjNode(node: Node): boolean {
  return String(node.type ?? '').startsWith(LJ_PREFIX)
}

function asObj(v: unknown): AnyObj {
  return v && typeof v === 'object' ? (v as AnyObj) : {}
}

/** 取节点当前选中的资源 url（无资源时回退导入快照的 _media） */
export function selectedResource(data: AnyObj): LjResource | null {
  const resources = Array.isArray(data.resources) ? (data.resources as LjResource[]) : []
  if (!resources.length) return null
  const idx = typeof data.selectedIndex === 'number' ? data.selectedIndex : resources.length - 1
  return resources[Math.min(Math.max(idx, 0), resources.length - 1)] ?? null
}

/**
 * 收集上游输入：所有指向本节点的连线，按连线顺序取
 * 上游节点的「当前选中资源」。这就是灵境 inputs[] 的自动收集机制。
 */
export function collectInputs(nodeId: string): LjInput[] {
  const { objects, edges } = useCanvasStore.getState()
  const byId = new Map(objects.map((n) => [n.id, n]))
  const out: LjInput[] = []
  for (const e of edges as Edge[]) {
    if (e.target !== nodeId) continue
    const src = byId.get(e.source)
    if (!src) continue
    const d = asObj(src.data)
    const res = selectedResource(d)
    const snap = asObj(d._media)
    const url = res?.url || String(snap.url ?? '')
    const cover = res?.cover || String(snap.cover ?? '') || url
    if (!url) continue
    out.push({
      nodeId: src.id,
      label: String(d.label ?? src.type),
      url,
      cover,
    })
  }
  return out
}

/** 把 Prompt 里的 {{Ref N}} 替换为第 N 张输入图的 url；无该输入时移除占位符 */
export function applyRefs(prompt: string, inputs: LjInput[]): string {
  return prompt.replace(/\{\{\s*Ref\s*(\d+)\s*\}\}/gi, (_m, n: string) => {
    const inp = inputs[Number(n) - 1]
    return inp ? inp.url : ''
  })
}

function newRes(url: string, kind: LjResource['kind'], cover?: string): LjResource {
  return { id: `res_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, url, cover: cover ?? url, kind, createdAt: Date.now() }
}

/** 专业镜头/灯光属性字段（灵境 ShotObject 等价物，标签→中文） */
const SHOT_FIELDS: [string, string][] = [
  ['shot_size', '景别'],
  ['lens', '镜头'],
  ['camera_position', '机位'],
  ['camera_motion', '运镜'],
  ['composition', '构图'],
  ['lighting', '灯光'],
  ['color', '色调'],
]

/** 把节点上填写的镜头/灯光等结构化字段，拼成一段中文后缀，追加进生成提示词 */
export function shotFieldSuffix(d: AnyObj): string {
  const parts: string[] = []
  for (const [k, label] of SHOT_FIELDS) {
    const v = d[k]
    if (v == null || String(v).trim() === '') continue
    // 运镜（camera_motion）：命中方案库时，同时注入中文名 + 英文运镜关键词
    if (k === 'camera_motion') {
      const preset = cameraMotionByName(String(v).trim())
      if (preset) {
        parts.push(`运镜：${preset.name}（${preset.en}）`)
        continue
      }
    }
    parts.push(`${label}：${String(v).trim()}`)
  }
  // 自定义运镜（自由输入，追加在方案之后）
  const custom = String(d.camera_motion_custom ?? '').trim()
  if (custom) parts.push(`运镜补充：${custom}`)
  return parts.length ? '\n【镜头参数】' + parts.join('，') + '。' : ''
}

function pushTask(data: AnyObj, task: LjTaskRecord) {
  const tasks = Array.isArray(data.tasks) ? ([...data.tasks] as LjTaskRecord[]) : []
  tasks.push(task)
  while (tasks.length > 10) tasks.shift()
  return { tasks }
}

/** 从渲染接口响应里提取媒体地址（与 AssetNode/FilmVideoNode 同口径） */
function extractMediaUrl(rdata: AnyObj | undefined, kind: 'image' | 'video'): string {
  if (!rdata) return ''
  const listKey = kind === 'video' ? 'videos' : 'images'
  const list = (rdata[listKey] as { url?: string }[] | undefined) || []
  return list[0]?.url || (rdata.url as string) || (rdata.video_url as string) || ''
}

/**
 * 执行一个灵境节点：
 *   媒体生成节点 → renderMedia（图片/视频）
 *   文本/剧本/分镜节点 → aiChat
 * 结果写入 data.resources + data.tasks，状态机 idle→running→completed/failed。
 * AI 不直接改库——只写画布数据，持久化走现有保存链路。
 */
export async function runLjNode(id: string): Promise<void> {
  const store = useCanvasStore.getState()
  const node = store.objects.find((n) => n.id === id)
  if (!node) return
  const d = asObj(node.data)
  const label = String(d.label ?? node.type)

  const inputs = collectInputs(id)
  const rawPrompt = String(d.prompt ?? '')
  const prompt = applyRefs(rawPrompt, inputs).trim()

  store.updateObject(id, { status: 'running', error: null })
  emitLog({ nodeId: id, nodeLabel: label, nodeType: String(node.type), status: 'running', message: `开始生成 · 输入 ${inputs.length} 项` })
  const t0 = Date.now()

  try {
    const isMedia = node.type === 'lj_image_config' || node.type === 'lj_video_config'
    const kind: 'image' | 'video' = node.type === 'lj_video_config' ? 'video' : 'image'

    let resource: LjResource | null = null
    let textResult = ''

    if (isMedia) {
      const fullPrompt = (prompt + shotFieldSuffix(d)).trim()
      if (!fullPrompt && !inputs.length) throw new Error('提示词与参考图均为空')
      const params: Record<string, unknown> = { prompt: fullPrompt }
      const refs = inputs.map((i) => i.url).filter(Boolean)
      if (refs.length) params.reference = refs
      if (d.duration != null && Number(d.duration) > 0) params.duration = Number(d.duration)
      if (d.width != null && d.height != null) {
        params.width = Number(d.width)
        params.height = Number(d.height)
      }
      if (d.aspect_ratio) params.aspect_ratio = String(d.aspect_ratio)
      if (d.generate_audio === true) params.generate_audio = true
      if (d.subtitle === true) params.subtitle = true
      if (d.subtitle_text) params.subtitle_text = String(d.subtitle_text)
      const res = await renderMedia({
        kind,
        render_mode: String(d.render_mode ?? 'cloud'),
        provider_id: String(d.provider_id ?? ''),
        model: String(d.model ?? ''),
        renderer_id: String(d.renderer_id ?? ''),
        params,
      })
      const rdata = asObj(res.data)
      if (!res.ok || rdata.ok === false) throw new Error(String(rdata.error || `HTTP ${res.status}`))
      const url = extractMediaUrl(rdata, kind)
      if (!url) throw new Error('响应中没有媒体地址')
      resource = newRes(url, kind)
    } else {
      if (!prompt) throw new Error('请先填写提示词')
      const sys =
        node.type === 'lj_script_config'
          ? '你是专业编剧。按用户要求创作剧本：三幕结构、出场元素、分场景大纲、情绪曲线，输出结构清晰的内容。'
          : node.type === 'lj_storyboard_config'
            ? '你是分镜师。把用户给出的剧情拆成镜头表，每镜包含镜号/时长/画面描述/景别/运镜，逐行列出。'
            : '你是内容生成助手，按要求生成内容，直接输出结果，不要多余解释。'
      const userText = [
        prompt,
        ...(node.type === 'lj_script_config' && d.duration ? [`总时长约 ${String(d.duration)} 秒`] : []),
        ...(inputs.length ? ['\n参考素材：', ...inputs.map((i, n) => `- 图${n + 1}（${i.label}）: ${i.url}`)] : []),
      ].join('\n')
      const res = await aiChat({ system: sys, user: userText, scenario: 'general' })
      if (!res.ok || !res.data.result) throw new Error(String(res.data.error || 'AI 未返回内容'))
      textResult = String(res.data.result)
    }

    // 写回：新资源追加 + 选中新版本 + 任务留痕
    const cur = asObj(useCanvasStore.getState().objects.find((n) => n.id === id)?.data)
    const patch: Record<string, unknown> = {
      status: 'completed',
      ...pushTask(cur, {
        id: `task_${Date.now().toString(36)}`,
        status: 'completed',
        kind: isMedia ? kind : 'text',
        startedAt: t0,
        durationMs: Date.now() - t0,
      }),
    }
    if (resource) {
      const prev = Array.isArray(cur.resources) ? (cur.resources as LjResource[]) : []
      patch.resources = [...prev, resource]
      patch.selectedIndex = prev.length // 自动选中新版本
    } else {
      patch.text = textResult
    }
    useCanvasStore.getState().updateObject(id, patch)
    emitLog({
      nodeId: id, nodeLabel: label, nodeType: String(node.type), status: 'completed',
      message: `生成完成 · ${resource ? '新版本已挂载' : `${textResult.length} 字`}`,
      duration: Date.now() - t0,
    })
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 120)
    const cur = asObj(useCanvasStore.getState().objects.find((n) => n.id === id)?.data)
    useCanvasStore.getState().updateObject(id, {
      status: 'failed',
      error: msg,
      ...pushTask(cur, {
        id: `task_${Date.now().toString(36)}`,
        status: 'failed',
        kind: 'unknown',
        startedAt: t0,
        durationMs: Date.now() - t0,
        error: msg,
      }),
    })
    emitLog({ nodeId: id, nodeLabel: label, nodeType: String(node.type), status: 'failed', message: `失败 · ${msg}` })
  }
}

/**
 * 视频节点抽帧：首帧 / 尾帧 / 当前帧（timeSeconds）。
 * 抽出的帧作为 image 资源追加进节点版本条，可选中、可被下游连线引用（首尾帧接龙）。
 */
export async function captureFrame(id: string, mode: 'first' | 'last' | 'current', timeSeconds?: number): Promise<void> {
  const store = useCanvasStore.getState()
  const node = store.objects.find((n) => n.id === id)
  if (!node) return
  const d = asObj(node.data)
  const label = String(d.label ?? '视频抽帧')
  const videoUrl = selectedResource(d)?.url || String(asObj(d._media).url ?? '')
  if (!videoUrl) {
    emitLog({ nodeId: id, nodeLabel: label, nodeType: String(node.type), status: 'failed', message: '没有可用视频' })
    return
  }

  store.updateObject(id, { status: 'running', error: null })
  const t0 = Date.now()
  try {
    const res = await extractVideoFrame(videoUrl, mode, timeSeconds)
    const payload = asObj(res.data)
    if (!res.ok || payload.ok === false) throw new Error(String(payload.error || '抽帧失败'))
    const img = String(payload.image_url ?? '')
    if (!img) throw new Error('未返回截帧图片')

    const cur = asObj(store.objects.find((n) => n.id === id)?.data)
    const prev = Array.isArray(cur.resources) ? (cur.resources as LjResource[]) : []
    const frame = { id: `frame_${Date.now().toString(36)}`, url: img, cover: img, kind: 'image' as const, createdAt: Date.now() }
    store.updateObject(id, {
      status: 'completed',
      resources: [...prev, frame],
      selectedIndex: prev.length,
    })
    const modeLabel = mode === 'first' ? '首帧' : mode === 'last' ? '尾帧' : `${timeSeconds?.toFixed(1)}s 帧`
    emitLog({ nodeId: id, nodeLabel: label, nodeType: String(node.type), status: 'completed', message: `${modeLabel}已截取为图片`, duration: Date.now() - t0 })
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 120)
    store.updateObject(id, { status: 'failed', error: msg })
    emitLog({ nodeId: id, nodeLabel: label, nodeType: String(node.type), status: 'failed', message: `抽帧失败 · ${msg}` })
  }
}
