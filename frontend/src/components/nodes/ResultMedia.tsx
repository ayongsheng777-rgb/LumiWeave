import { useState } from 'react'

// ResultMedia — 结果展示：按输出画面的实际宽高比自适应高度，不裁剪、不变形。
// 图片读 naturalWidth/Height，视频读 videoWidth/Height，撑满容器宽度、高度贴合比例，超长时以 maxH 兜底（contain 居中留白）。
export function ResultMedia({
  url,
  type = 'image',
  maxH = 420,
  className = '',
}: {
  url: string
  type?: 'image' | 'video'
  maxH?: number
  className?: string
}) {
  const [ratio, setRatio] = useState<number | null>(null)

  if (type === 'video') {
    return (
      <video
        src={url}
        controls
        muted
        loop
        playsInline
        className={`w-full rounded-md bg-black/40 object-contain ${className}`}
        style={{ aspectRatio: ratio ? ratio.toFixed(4) : '16 / 9', maxHeight: maxH }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight)
        }}
      />
    )
  }

  return (
    <img
      src={url}
      alt="生成结果"
      className={`w-full rounded-md bg-soft object-contain ${className}`}
      style={{ aspectRatio: ratio ? ratio.toFixed(4) : undefined, maxHeight: maxH }}
      onLoad={(e) => {
        const i = e.currentTarget
        if (i.naturalWidth && i.naturalHeight) setRatio(i.naturalWidth / i.naturalHeight)
      }}
    />
  )
}
