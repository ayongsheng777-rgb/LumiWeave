// 生成节点的「连入输入」实时计算（连线即输入，对标 PixVerse）
// GenerateNode 与 PvComposer 共用，保证 @imageN 编号口径一致：
// mention 编号只数普通连线（首尾帧专线在后端不进 reference_images 列表）。
import { useMemo } from 'react'
import { usePvStore } from './store'
import type { EdgeConnType, PvNodeData } from './types'

export interface InputChip {
  key: string
  token: string
  title: string
  thumb?: string
  ctype: string
  conn: EdgeConnType
}

export function useNodeInputs(nodeId: string): {
  chips: InputChip[]
  images: number
  videos: number
  audios: number
} {
  const nodes = usePvStore((s) => s.nodes)
  const edges = usePvStore((s) => s.edges)

  return useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const chips: InputChip[] = []
    const acc = { images: 0, videos: 0, audios: 0 }
    for (const e of edges) {
      if (e.target !== nodeId) continue
      const src = byId.get(e.source)
      const sd = src?.data as unknown as PvNodeData | undefined
      if (!sd) continue
      const p = String(sd.file_path || sd.url || '')
      if (!p) continue
      const connRaw = (e.data as Record<string, unknown> | undefined)?.connectionType
      const conn: EdgeConnType =
        connRaw === 'firstFrame' || e.targetHandle === 'ff'
          ? 'firstFrame'
          : connRaw === 'lastFrame' || e.targetHandle === 'lf'
            ? 'lastFrame'
            : 'manual'
      // mention 编号只数普通连线：首尾帧专线在后端不进 reference_images 列表，
      // 若把它们也数进去，UI 显示的 @imageN 会跟后端装配顺序错开
      if (conn === 'manual') {
        if (sd.content_type === 'image') acc.images += 1
        else if (sd.content_type === 'video') acc.videos += 1
        else if (sd.content_type === 'audio') acc.audios += 1
      }
      // token 即提示词里的引用文字，全面中文化：图片1/视频1/音频1（首尾帧专线保留语义名）
      const token =
        conn === 'firstFrame'
          ? '首帧'
          : conn === 'lastFrame'
            ? '尾帧'
            : sd.content_type === 'image'
              ? `图片${acc.images}`
              : sd.content_type === 'video'
                ? `视频${acc.videos}`
                : `音频${acc.audios}`
      chips.push({
        key: e.id,
        token,
        title: sd.title || '',
        thumb: String(sd.thumbnail_url || sd.url || '') || undefined,
        ctype: sd.content_type,
        conn,
      })
    }
    return { chips, ...acc }
  }, [nodes, edges, nodeId])
}
