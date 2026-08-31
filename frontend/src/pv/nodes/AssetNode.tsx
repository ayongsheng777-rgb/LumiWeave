// 素材节点 —— 画布的「原料」
// 本地选文件上传 → 后端 /api/assets/upload → 地址存进节点，供下游生成节点引用
import { useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { ImagePlus, Film, Music, Loader2 } from 'lucide-react'
import { usePvStore } from '../store'
import { uploadImage } from '../../api'
import type { PvNodeData } from '../types'
import { PvNodeShell, PvPreview } from './PvNodeShell'
import { emitLog } from '../../components/LogPanel'

const ACCEPT: Record<string, string> = {
  image: 'image/png,image/jpeg,image/webp,image/gif',
  video: 'video/mp4,video/webm,video/quicktime',
  audio: 'audio/mpeg,audio/wav,audio/mp3,audio/mp4,audio/x-m4a',
}

const ICON: Record<string, typeof ImagePlus> = {
  image: ImagePlus,
  video: Film,
  audio: Music,
}

export function AssetNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as PvNodeData
  const updateNodeData = usePvStore((s) => s.updateNodeData)
  const setNodeStatus = usePvStore((s) => s.setNodeStatus)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const Icon = ICON[d.content_type] || ImagePlus
  const hasMedia = Boolean(d.url)

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setNodeStatus(id, 'running')
    try {
      const res = await uploadImage(file)
      const payload = res.data as Record<string, unknown> | undefined
      if (res.ok && payload?.url) {
        updateNodeData(id, {
          url: String(payload.url),
          file_path: String(payload.file_path || payload.url),
          thumbnail_url: String(payload.url),
          filename: file.name,
          status: 'completed',
          error: '',
        } as Partial<PvNodeData>)
        setNodeStatus(id, 'completed')
        emitLog({
          nodeId: id,
          nodeLabel: d.title,
          nodeType: 'pv_asset',
          status: 'completed',
          message: `已上传 ${file.name}`,
        })
      } else {
        const err = String(payload?.error || '上传失败')
        setNodeStatus(id, 'failed', err)
        emitLog({ nodeId: id, nodeLabel: d.title, nodeType: 'pv_asset', status: 'failed', message: err })
      }
    } catch (err) {
      const msg = String(err)
      setNodeStatus(id, 'failed', msg)
      emitLog({ nodeId: id, nodeLabel: d.title, nodeType: 'pv_asset', status: 'failed', message: msg })
    } finally {
      setUploading(false)
    }
  }

  const color =
    d.content_type === 'video' ? '#ec4899' : d.content_type === 'audio' ? '#14b8a6' : '#0ea5e9'

  return (
    <PvNodeShell
      id={id}
      data={d}
      selected={selected}
      color={color}
      icon={<Icon size={14} />}
      preview={hasMedia ? <PvPreview data={d} /> : undefined}
      footer={
        d.filename ? (
          <div className="truncate text-[10px] text-ink-3">{d.filename}</div>
        ) : undefined
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT[d.content_type] || ACCEPT.image}
        className="hidden"
        onChange={onFile}
      />
      <button
        className="nodrag flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-edge bg-soft px-3 py-3 text-xs text-ink-2 transition hover:bg-hover hover:text-ink disabled:opacity-50"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
        {uploading ? '上传中…' : hasMedia ? '重新选择文件' : '选择本地文件'}
      </button>
      {d.filename && (
        <div className="truncate rounded bg-soft px-2 py-1 text-[10px] text-ink-3">{d.filename}</div>
      )}
    </PvNodeShell>
  )
}
