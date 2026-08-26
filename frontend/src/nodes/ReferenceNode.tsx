/**
 * LumiWeave V2.5 ReferenceNode
 * 规格书 §2: Reference Node（参考图节点）
 */
import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import NodeShell from '../canvas/NodeShell'
import { Upload, X } from 'lucide-react'

export function ReferenceNode({ id, data }: NodeProps) {
  const { updateObject, deleteObjects } = useCanvasStore()
  const d = data as { images?: string[]; strength?: number; status?: string }
  const images: string[] = d.images || []
  const [uploading, setUploading] = useState(false)

  const update = (patch: Record<string, unknown>) => {
    updateObject(id, { ...d, ...patch })
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/v1/assets/upload', { method: 'POST', body: formData })
      const json = await res.json()
      if (json.url) {
        update({ images: [...images, json.url] })
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <NodeShell
      title="参考图"
      color="#8b5cf6"
      status={d.status}
      onDelete={() => deleteObjects([id])}
    >
      <div className="space-y-2">
        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-1">
            {images.map((url: string, i: number) => (
              <div key={i} className="relative group">
                <img src={url} alt="" className="w-full aspect-square object-cover rounded border border-[var(--lw-ink-1)]" />
                <button
                  className="absolute top-0 right-0 p-0.5 bg-red-500 text-white rounded-bl text-[8px] opacity-0 group-hover:opacity-100"
                  onClick={() => update({ images: images.filter((_: string, j: number) => j !== i) })}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        <label className="flex items-center gap-1 text-[10px] text-[var(--lw-ink-3)] cursor-pointer hover:text-[var(--lw-ink-5)]">
          <Upload size={11} />
          <span>{uploading ? '上传中…' : '添加参考图'}</span>
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </label>

        <div>
          <label className="text-[9px] text-[var(--lw-ink-3)]">参考强度</label>
          <input
            type="range"
            min={0.1} max={1} step={0.05}
            value={d.strength ?? 0.85}
            onChange={(e) => update({ strength: parseFloat(e.target.value) })}
            className="nodrag w-full h-1"
          />
          <div className="flex justify-between text-[8px] text-[var(--lw-ink-3)]">
            <span>弱 (0.1)</span><span>{(d.strength ?? 0.85).toFixed(2)}</span><span>强 (1.0)</span>
          </div>
        </div>
      </div>
    </NodeShell>
  )
}
