// =====================================================================
// 画布节点动作（悬浮工具栏的真正执行体）
//   · 智能动作：源节点 → 新建生成节点 + 连线 + 预填提示词模板 + 弹 composer（不自动跑）
//   · 快速拆分：宫格图在画布端切成 N×M 小图，每格变成一个图片素材节点
//   · 截帧：视频 → 首帧/尾帧/指定秒 → 图片素材节点（后端 opencv 抽帧）
//   · 下载：媒体落盘到本地
// 做不到的（画质增强/音频分离/深度图/片段重拍等）按阿勇拍板直接剔除，不留入口。
// =====================================================================
import { usePvStore } from './store'
import { usePvDialogs } from './dialogStore'
import { PV_NODE_TEMPLATES } from './registry'
import { extractVideoFrame, uploadImage } from '../api'
import { emitLog } from '../components/LogPanel'
import type { PoolCandidate, PvAction, ScenePools } from './pools'
import { defaultCandidate, resolveCandidate } from './pools'
import type { PvNodeData, PvNodeTemplate } from './types'

function nodeData(nodeId: string): PvNodeData | null {
  const n = usePvStore.getState().nodes.find((x) => x.id === nodeId)
  return (n?.data as unknown as PvNodeData) ?? null
}

function templateOf(pred: (t: PvNodeTemplate) => boolean): PvNodeTemplate | undefined {
  return PV_NODE_TEMPLATES.find(pred)
}

/** 候选 → 节点数据补丁（comfyui 候选走本地渲染器，cloud 候选走模型库直连） */
export function candidatePatch(c: PoolCandidate | null): Partial<PvNodeData> {
  if (!c) return {}
  if (c.renderer === 'comfyui') {
    return { render_mode: 'comfyui', profile_id: undefined, model: c.model }
  }
  return { render_mode: 'cloud', profile_id: c.profile_id, model: c.model }
}

/**
 * 智能动作：以 sourceId 的产物为参考图，新建一个图生图节点并连线，
 * 提示词用动作模板预填（{prompt} 占位清空待用户补），然后弹 composer 让用户改完再生成。
 */
export function runSmartAction(sourceId: string, action: PvAction, pools: ScenePools): string | null {
  const store = usePvStore.getState()
  const sd = nodeData(sourceId)
  if (!sd || !sd.url) return null
  const srcNode = store.nodes.find((x) => x.id === sourceId)
  if (!srcNode) return null

  const tpl = templateOf(
    (t) =>
      t.kind === 'generate' &&
      t.content_type === 'image' &&
      (t.defaultData as Partial<PvNodeData> | undefined)?.params?.gen_type === 'image_to_image',
  )
  if (!tpl) return null

  const srcW = Number((srcNode.style as Record<string, unknown> | undefined)?.width) || 300
  const newId = store.addFromTemplate(tpl, {
    x: srcNode.position.x + srcW + 120,
    y: srcNode.position.y,
  })
  // 连线：源产物 → 新节点（普通参考输入）
  store.onConnect({ source: sourceId, sourceHandle: null, target: newId, targetHandle: null })

  // 模型：动作指定 > 场景默认；都没有就留给 composer 里选
  const candidate = resolveCandidate(pools, action.model) ?? defaultCandidate(pools, action.scene)
  const prompt = action.prompt_template.replace('{prompt}', '').replace(/\s+$/, ' ')
  store.updateNodeData(newId, {
    title: action.label,
    ...candidatePatch(candidate),
    params: {
      prompt,
      negative: '',
      gen_type: 'image_to_image',
      aspect_ratio: '1:1',
      quality: '1080p',
    },
  } as Partial<PvNodeData>)

  emitLog({
    nodeId: newId,
    nodeLabel: action.label,
    nodeType: 'pv_generate',
    status: 'running',
    message: `已创建「${action.label}」节点并连线，请在弹窗里确认提示词后生成`,
  })
  usePvDialogs.getState().openComposer(newId)
  return newId
}

/** 加载图片元素（同源 /uploads，不会污染 canvas） */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
}

/**
 * 快速拆分：把宫格图（如九宫格）按 cols×rows 切开，每格上传后变成一个图片素材节点，
 * 在源节点右侧按同样宫格阵型摆开。
 */
export async function splitImageNode(nodeId: string, cols: number, rows: number): Promise<void> {
  const store = usePvStore.getState()
  const sd = nodeData(nodeId)
  if (!sd?.url || sd.content_type !== 'image') return
  const srcNode = store.nodes.find((x) => x.id === nodeId)
  if (!srcNode) return
  const tpl = templateOf((t) => t.kind === 'asset' && t.content_type === 'image')
  if (!tpl) return

  store.setNodeStatus(nodeId, 'running')
  try {
    const img = await loadImage(String(sd.url))
    const cw = Math.floor(img.naturalWidth / cols)
    const ch = Math.floor(img.naturalHeight / rows)
    if (cw < 8 || ch < 8) throw new Error('图片太小，拆不出来')

    const srcW = Number((srcNode.style as Record<string, unknown> | undefined)?.width) || 300
    const baseX = srcNode.position.x + srcW + 100
    const baseY = srcNode.position.y
    const cellW = 200
    const gap = 24

    let done = 0
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const canvas = document.createElement('canvas')
        canvas.width = cw
        canvas.height = ch
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('画布环境不可用')
        ctx.drawImage(img, c * cw, r * ch, cw, ch, 0, 0, cw, ch)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error('切图失败')
        const name = `split_${r + 1}x${c + 1}_${sd.filename || 'grid.png'}`
        const res = await uploadImage(new File([blob], name, { type: 'image/png' }))
        const payload = res.data as Record<string, unknown> | undefined
        if (!res.ok || !payload?.url) throw new Error(String(payload?.error || '上传切片失败'))
        const newId = store.addFromTemplate(tpl, {
          x: baseX + c * (cellW + gap),
          y: baseY + r * (cellW * (ch / cw) + gap + 28),
        })
        store.updateNodeData(newId, {
          url: String(payload.url),
          file_path: String(payload.file_path || payload.url),
          thumbnail_url: String(payload.url),
          filename: name,
          width: cw,
          height: ch,
          status: 'completed',
        } as Partial<PvNodeData>)
        done += 1
      }
    }
    store.setNodeStatus(nodeId, 'completed')
    emitLog({
      nodeId,
      nodeLabel: sd.title,
      nodeType: 'pv_asset',
      status: 'completed',
      message: `快速拆分完成：${cols}×${rows} 共 ${done} 张`,
    })
  } catch (e) {
    const msg = (e as Error).message || '拆分失败'
    store.setNodeStatus(nodeId, 'failed', msg)
    emitLog({ nodeId, nodeLabel: sd.title, nodeType: 'pv_asset', status: 'failed', message: msg })
  }
}

/** 截帧：视频节点 → 首帧/尾帧/指定秒 → 新的图片素材节点（落在源节点右侧） */
export async function extractFrameToNode(
  nodeId: string,
  mode: 'first' | 'last' | 'current',
  timeSeconds?: number,
): Promise<void> {
  const store = usePvStore.getState()
  const sd = nodeData(nodeId)
  if (!sd?.url || sd.content_type !== 'video') return
  const srcNode = store.nodes.find((x) => x.id === nodeId)
  if (!srcNode) return
  const tpl = templateOf((t) => t.kind === 'asset' && t.content_type === 'image')
  if (!tpl) return

  store.setNodeStatus(nodeId, 'running')
  try {
    const res = await extractVideoFrame(String(sd.url), mode, timeSeconds)
    const payload = res.data as Record<string, unknown> | undefined
    const url = String(payload?.url || payload?.frame_url || '')
    if (!res.ok || !url) throw new Error(String(payload?.error || '截帧失败'))
    const srcW = Number((srcNode.style as Record<string, unknown> | undefined)?.width) || 300
    const newId = store.addFromTemplate(tpl, {
      x: srcNode.position.x + srcW + 100,
      y: srcNode.position.y,
    })
    const label = mode === 'first' ? '首帧' : mode === 'last' ? '尾帧' : `${timeSeconds ?? 0}s 帧`
    store.updateNodeData(newId, {
      title: `${sd.title || '视频'} · ${label}`,
      url,
      file_path: String(payload?.file_path || url),
      thumbnail_url: url,
      filename: url.split('/').pop() || 'frame.jpg',
      status: 'completed',
    } as Partial<PvNodeData>)
    store.setNodeStatus(nodeId, 'completed')
    emitLog({
      nodeId,
      nodeLabel: sd.title,
      nodeType: 'pv_asset',
      status: 'completed',
      message: `已截取${label}为图片素材`,
    })
  } catch (e) {
    const msg = (e as Error).message || '截帧失败'
    store.setNodeStatus(nodeId, 'failed', msg)
    emitLog({ nodeId, nodeLabel: sd.title, nodeType: 'pv_asset', status: 'failed', message: msg })
  }
}

/** 下载媒体到本地（fetch → blob → a[download]，同源与跨域都适用） */
export async function downloadMedia(url: string, filename?: string): Promise<void> {
  const name = filename || url.split('/').pop() || 'download'
  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const blob = await resp.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  } catch {
    // 兜底：直接开新标签（至少能右键另存）
    window.open(url, '_blank')
  }
}
