/** ShotChainPanel — 左侧弹出信息框
 * 某个分镜生成完成后弹出：显示当前分镜的最后一帧（图/视频首帧），
 * 并提供「下一分镜」链接，点链接自动定位并生成下一个分镜，依次排到最后一个。
 */
import { useState, useEffect } from 'react'
import { X, ArrowRight, CheckCircle2 } from 'lucide-react'
import { ResultMedia } from './nodes/ResultMedia'

export interface ShotChainInfo {
  nodeId: string
  nodeLabel: string
  shotIndex: number      // 刚完成的分镜下标（0-based）
  shotNumber: number     // 显示用编号（1-based）
  totalShots: number
  lastFrameUrl: string   // 最后一帧（视频封面/图片）
  isVideo: boolean
  nextShotNumber?: number  // 下一个分镜编号（无则说明是最后一个）
}

type ChainListener = (info: ShotChainInfo) => void
const chainListeners = new Set<ChainListener>()

/** StoryboardNode 调用：分镜生成完成后通知左侧信息框 */
export function notifyShotChain(info: ShotChainInfo) {
  chainListeners.forEach((l) => l(info))
}

/** 跳转请求：点击「下一分镜」后通知 StoryboardNode 定位并生成 */
type JumpListener = (nodeId: string, shotIndex: number) => void
const jumpListeners = new Set<JumpListener>()
export function requestShotJump(nodeId: string, shotIndex: number) {
  jumpListeners.forEach((l) => l(nodeId, shotIndex))
}
export function subscribeShotJump(l: JumpListener): () => void {
  jumpListeners.add(l)
  return () => {
    jumpListeners.delete(l)
  }
}

export function ShotChainPanel() {
  const [info, setInfo] = useState<ShotChainInfo | null>(null)

  useEffect(() => {
    const unsub = (i: ShotChainInfo) => setInfo(i)
    chainListeners.add(unsub)
    return () => {
      chainListeners.delete(unsub)
    }
  }, [])

  if (!info) return null

  const hasNext = info.nextShotNumber != null

  return (
    <div className="fixed left-3 top-1/2 z-40 w-64 -translate-y-1/2 overflow-hidden rounded-xl border border-edge bg-panel-2 shadow-2xl">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-xs font-medium text-ink">分镜进度</span>
        <button className="nodrag rounded p-1 text-ink-3 hover:text-ink" onClick={() => setInfo(null)}>
          <X size={13} />
        </button>
      </div>

      <div className="p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-green-400">
          <CheckCircle2 size={12} />
          <span>分镜 {info.shotNumber} 生成完成</span>
          <span className="text-ink-3">（{info.shotNumber}/{info.totalShots}）</span>
        </div>

        {/* 最后一帧 */}
        {info.lastFrameUrl && (
          <div className="mb-2 overflow-hidden rounded-md border border-edge">
            <ResultMedia url={info.lastFrameUrl} type={info.isVideo ? 'video' : 'image'} maxH={180} />
          </div>
        )}

        {/* 下一分镜链接 */}
        {hasNext ? (
          <button
            className="nodrag flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs text-white transition hover:bg-brand-600"
            onClick={() => {
              requestShotJump(info.nodeId, info.shotIndex + 1)
              setInfo(null)
            }}
          >
            去生成分镜 {info.nextShotNumber}
            <ArrowRight size={12} />
          </button>
        ) : (
          <div className="rounded-lg bg-soft px-3 py-2 text-center text-[11px] text-ink-3">
            全部 {info.totalShots} 个分镜已生成完毕
          </div>
        )}
      </div>
    </div>
  )
}
