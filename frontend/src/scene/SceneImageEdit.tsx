// SceneImageEdit —— 图像基础编辑弹窗（V2.7）
// canvas 实现：旋转90° / 亮度 / 对比度 / 黑白 / 中心裁剪（原图/1:1/4:3/16:9）
// 保存：导出 blob → uploadImage 上传 → 返回新 url
import { useEffect, useRef, useState } from 'react'
import { X, RotateCcw, RotateCw, Download, Loader2 } from 'lucide-react'
import { uploadImage } from '../api'
import { useSceneStore } from '../store/sceneStore'

type AnyObj = Record<string, unknown>

export default function SceneImageEdit({
  src,
  onClose,
  onSaved,
}: {
  src: string
  onClose: () => void
  onSaved: (url: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rot, setRot] = useState(0) // 0/90/180/270
  const [bright, setBright] = useState(0) // -100..100
  const [contrast, setContrast] = useState(0) // -100..100
  const [gray, setGray] = useState(false)
  const [crop, setCrop] = useState<'free' | '1:1' | '4:3' | '16:9'>('free')
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [busy, setBusy] = useState(false)
  const currentSceneId = useSceneStore((s) => s.currentSceneId)

  useEffect(() => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => setImg(im)
    im.src = src
  }, [src])

  // 每次参数变化重绘
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !img) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    const w = img.naturalWidth || 800
    const h = img.naturalHeight || 800
    const rotated = rot % 180 !== 0
    let cw = rotated ? h : w
    let ch = rotated ? w : h
    // 裁剪：从中心按比例裁
    if (crop !== 'free') {
      const [rw, rh] = crop.split(':').map(Number)
      const target = rw / rh
      const cur = cw / ch
      if (cur > target) {
        cw = ch * target
      } else {
        ch = cw / target
      }
    }
    cv.width = Math.round(cw)
    cv.height = Math.round(ch)
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.save()
    ctx.translate(cv.width / 2, cv.height / 2)
    ctx.rotate((rot * Math.PI) / 180)
    // 滤镜：亮度+对比度（CSS filter 兼容）
    ctx.filter = `brightness(${1 + bright / 100}) contrast(${1 + contrast / 100})${gray ? ' grayscale(1)' : ''}`
    ctx.drawImage(img, -w / 2, -h / 2, w, h)
    ctx.restore()
  }, [img, rot, bright, contrast, gray, crop])

  const save = async () => {
    const cv = canvasRef.current
    if (!cv) return
    setBusy(true)
    try {
      const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'))
      if (!blob) return
      const file = new File([blob], 'edit.png', { type: 'image/png' })
      const res = await uploadImage(file, currentSceneId || undefined)
      const url = String((res.data as AnyObj)?.url ?? '')
      if (res.ok && url) onSaved(url)
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    const cv = canvasRef.current
    if (!cv) return
    const a = document.createElement('a')
    a.href = cv.toDataURL('image/png')
    a.download = 'lumiweave-edit.png'
    a.click()
  }

  const slider = (label: string, v: number, set: (n: number) => void) => (
    <label className="flex items-center gap-2 text-[11px] text-ink-2">
      <span className="w-12 shrink-0">{label}</span>
      <input
        type="range" min={-100} max={100} value={v}
        className="nodrag nowheel flex-1 accent-brand-500"
        onChange={(e) => set(Number(e.target.value))}
      />
      <span className="w-8 text-right text-ink-3">{v > 0 ? `+${v}` : v}</span>
    </label>
  )

  return (
    <div className="nodrag fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-edge bg-panel-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
          <span className="text-sm font-medium text-ink">🎨 图像编辑</span>
          <span className="text-[11px] text-ink-3">旋转 / 亮度 / 对比度 / 黑白 / 裁剪</span>
          <button className="nodrag ml-auto rounded p-1 text-ink-3 hover:text-ink" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:flex-row">
          {/* 画布预览 */}
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg bg-black/40 p-2">
            <canvas ref={canvasRef} className="max-h-[52vh] max-w-full rounded shadow-lg" />
          </div>

          {/* 控制面板 */}
          <div className="flex w-full shrink-0 flex-col gap-3 md:w-56">
            <div className="flex items-center gap-1.5">
              <button
                className="nodrag flex h-9 flex-1 items-center justify-center gap-1 rounded-md border border-edge bg-soft text-ink-2 hover:text-ink"
                onClick={() => setRot((r) => (r + 270) % 360)}
                title="左转90°"
              >
                <RotateCcw size={14} /> 左转
              </button>
              <button
                className="nodrag flex h-9 flex-1 items-center justify-center gap-1 rounded-md border border-edge bg-soft text-ink-2 hover:text-ink"
                onClick={() => setRot((r) => (r + 90) % 360)}
                title="右转90°"
              >
                <RotateCw size={14} /> 右转
              </button>
            </div>

            {slider('亮度', bright, setBright)}
            {slider('对比度', contrast, setContrast)}

            <label className="flex items-center gap-2 text-[11px] text-ink-2">
              <input type="checkbox" className="nodrag accent-brand-500" checked={gray} onChange={(e) => setGray(e.target.checked)} />
              黑白滤镜
            </label>

            <div className="flex items-center gap-1.5">
              <span className="w-12 shrink-0 text-[11px] text-ink-2">裁剪</span>
              {(['free', '1:1', '4:3', '16:9'] as const).map((c) => (
                <button
                  key={c}
                  className={`nodrag rounded px-2 py-1 text-[11px] transition ${crop === c ? 'bg-brand-600 text-white' : 'bg-soft text-ink-2 hover:text-ink'}`}
                  onClick={() => setCrop(c)}
                >
                  {c === 'free' ? '原图' : c}
                </button>
              ))}
            </div>

            <div className="mt-auto flex gap-1.5 pt-1">
              <button
                className="nodrag flex h-9 flex-1 items-center justify-center gap-1 rounded-md border border-edge bg-soft text-ink-2 hover:text-ink"
                onClick={download}
              >
                <Download size={14} /> 下载
              </button>
              <button
                className="nodrag flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-50"
                onClick={() => void save()}
                disabled={busy}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                {busy ? '保存中…' : '保存'}
              </button>
            </div>
            <div className="text-[10px] leading-snug text-ink-3">
              保存后自动上传到项目素材库并替换节点图片。跨域图片可能无法读取像素（建议用本地上传的图）。
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
