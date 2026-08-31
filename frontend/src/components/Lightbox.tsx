import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useUiStore } from '../store/uiStore'

export default function Lightbox() {
  const src = useUiStore((s) => s.lightbox)
  const close = useUiStore((s) => s.closeLightbox)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  if (!src) return null

  // 视频地址走播放器，其余按图片预览（画布节点「全屏」对视频也要可用）
  const isVideo = /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(src)

  return (
    // §69 拍板：图片预览只能点 X / Esc 关闭，点黑罩不关（防误触）
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8 animate-fade-in"
      style={{ pointerEvents: 'none' }}
    >
      <button
        className="absolute right-4 top-4 text-ink-2 transition hover:text-white"
        style={{ pointerEvents: 'auto' }}
        onClick={close}
      >
        <X size={24} />
      </button>
      {isVideo ? (
        <video
          src={src}
          className="max-h-full max-w-full rounded-lg shadow-2xl"
          controls
          autoPlay
          style={{ pointerEvents: 'auto' }}
        />
      ) : (
        <img
          src={src}
          alt="预览"
          className="max-h-full max-w-full rounded-lg shadow-2xl"
          style={{ pointerEvents: 'auto' }}
        />
      )}
    </div>
  )
}
