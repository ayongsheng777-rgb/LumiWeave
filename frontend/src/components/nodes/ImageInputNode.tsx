// ImageInputNode — 图片上传节点（V2.3 图片一等公民）
// 本地选图 → 上传后端 /api/assets/upload → url 存入节点数据，透传给下游
import { useRef, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { useNodeAdapter } from '../../store/nodeAdapter'
import { uploadImage } from '../../api'
import { NodeShell } from './NodeShell'
import { ResultMedia } from './ResultMedia'
import { emitLog } from '../LogPanel'

export function ImageInputNode({ id, data, selected }: NodeProps) {
  const { update } = useNodeAdapter()
  const d = data as Record<string, unknown>
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const url = String(d.url ?? '')
  const name = String(d.filename ?? '')

  const pick = () => fileRef.current?.click()

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadImage(file)
      const payload = res.data as Record<string, unknown> | undefined
      if (res.ok && payload?.url) {
        update(id, {
          url: String(payload.url),
          filename: file.name,
          status: 'completed',
        })
        emitLog({ nodeId: id, nodeLabel: '图片上传', nodeType: 'image_input', status: 'completed', message: `已上传 ${file.name}` })
      } else {
        const err = String(payload?.error || '上传失败')
        update(id, { status: 'failed', error: err })
        emitLog({ nodeId: id, nodeLabel: '图片上传', nodeType: 'image_input', status: 'failed', message: err })
      }
    } catch (err) {
      update(id, { status: 'failed', error: String(err) })
      emitLog({ nodeId: id, nodeLabel: '图片上传', nodeType: 'image_input', status: 'failed', message: `上传失败 · ${String(err).slice(0, 80)}` })
    } finally {
      setUploading(false)
    }
  }

  return (
    <NodeShell id={id} selected={selected} title="图片上传" icon={<ImagePlus size={15} />} resultView={url ? <ResultMedia url={url} /> : undefined}>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onFile} />
      <button
        className="nodrag flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-edge bg-soft px-3 py-3 text-xs text-ink-2 transition hover:bg-hover hover:text-ink disabled:opacity-50"
        onClick={pick}
        disabled={uploading}
      >
        {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
        {uploading ? '上传中…' : url ? '重新选择图片' : '选择本地图片（≤200MB）'}
      </button>
      {name && <div className="truncate rounded bg-soft px-2 py-1 text-[10px] text-ink-3">{name}</div>}
      {String(d.error ?? '') && (
        <div className="rounded-md bg-status-failed/10 px-2 py-1.5 text-[11px] text-red-400">{String(d.error)}</div>
      )}
    </NodeShell>
  )
}
