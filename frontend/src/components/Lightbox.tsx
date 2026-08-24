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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8 animate-fade-in"
      onClick={close}
    >
      <button className="absolute right-4 top-4 text-ink-2 transition hover:text-white" onClick={close}>
        <X size={24} />
      </button>
      <img
        src={src}
        alt="预览"
        className="max-h-full max-w-full rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
