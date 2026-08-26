// V2.3 视频接龙：视频节点 → 视频节点连线时，自动取上游尾帧注入下游首帧
import type { Connection } from '@xyflow/react'
import { extractVideoFrame } from '../api'
import { emitLog } from './LogPanel'

interface ChainNodeInfo {
  id: string
  type?: string
  data?: Record<string, unknown>
}

/**
 * 在两套画布的 onConnect 里调用：命中「video → video」且上游已有成片时，
 * 抽取上游尾帧并写入下游 image_url + video_mode=image2video。
 */
export function maybeChainVideoFrame(
  conn: Connection,
  getSource: () => ChainNodeInfo | undefined,
  getTarget: () => ChainNodeInfo | undefined,
  updateTarget: (id: string, data: Record<string, unknown>) => void,
): void {
  const src = getSource()
  const dst = getTarget()
  if (!src || !dst || conn.source !== src.id || conn.target !== dst.id) return
  if (src.type !== 'video' || dst.type !== 'video') return

  const videoUrl = String(src.data?.video_url ?? '')
  if (!videoUrl) return // 上游还没出片，等用户生成后再连即可

  extractVideoFrame(videoUrl, 'last').then((res) => {
    const payload = res.data as Record<string, unknown> | undefined
    if (res.ok && payload?.ok && payload.image_url) {
      updateTarget(dst.id, {
        video_mode: 'image2video',
        image_url: String(payload.image_url),
      })
      emitLog({
        nodeId: dst.id,
        nodeLabel: '视频接龙',
        nodeType: 'video',
        status: 'completed',
        message: '已取上游尾帧作为本节点首帧',
      })
    } else {
      emitLog({
        nodeId: dst.id,
        nodeLabel: '视频接龙',
        nodeType: 'video',
        status: 'failed',
        message: String(payload?.error || '尾帧提取失败'),
      })
    }
  }).catch(() => { /* 网络异常不打断连线本身 */ })
}
