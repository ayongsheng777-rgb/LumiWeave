// 素材节点 —— 画布的「原料」（媒体优先形态，对标 PixVerse 的素材块）
// 一块裸媒体 + 上方浮动小标签：上传后按媒体真实宽高比撑开，
// 时长/分辨率做角标，操作按钮悬浮才出现。
// 生成节点的产物也可以「另存为素材」变成 reference 引用素材节点。
import { useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { ImagePlus, Film, Music, Loader2, RefreshCw } from 'lucide-react'
import { usePvStore } from '../store'
import { uploadImage } from '../../api'
import type { PvNodeData } from '../types'
import { PvNodeShell } from './PvNodeShell'
import { PvMediaToolbar } from '../PvMediaToolbar'
import { emitLog } from '../../components/LogPanel'
import { useUiStore } from '../../store/uiStore'

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

const COLOR: Record<string, string> = {
  image: '#0ea5e9',
  video: '#ec4899',
  audio: '#14b8a6',
}

/** 媒体没读出真实尺寸前的兜底比例 */
const FALLBACK_RATIO: Record<string, string> = {
  image: '4 / 3',
  video: '16 / 9',
  audio: '16 / 6',
}

export function AssetNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as PvNodeData
  const updateNodeData = usePvStore((s) => s.updateNodeData)
  const setNodeStatus = usePvStore((s) => s.setNodeStatus)
  const openLightbox = useUiStore((s) => s.openLightbox)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const Icon = ICON[d.content_type] || ImagePlus
  const color = COLOR[d.content_type] || '#0ea5e9'
  const hasMedia = Boolean(d.url)
  const isReference = d.action === 'reference'

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

  // 媒体加载出来后把真实尺寸/时长写回节点：卡片按真实宽高比撑开（对标 PixVerse 节点尺寸随媒体走）
  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (d.width === img.naturalWidth && d.height === img.naturalHeight) return
    updateNodeData(id, {
      width: img.naturalWidth,
      height: img.naturalHeight,
    } as Partial<PvNodeData>)
  }
  const onVideoMeta = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    if (d.width === v.videoWidth && d.height === v.videoHeight) return
    updateNodeData(id, {
      width: v.videoWidth,
      height: v.videoHeight,
      duration: Math.round(v.duration * 10) / 10,
    } as Partial<PvNodeData>)
  }

  const ratio =
    d.width && d.height ? `${d.width} / ${d.height}` : FALLBACK_RATIO[d.content_type] || '4 / 3'

  // 角标文案：视频给「时长 · 分辨率」，图片给分辨率
  const badgeText =
    d.content_type === 'video'
      ? [d.duration ? `${d.duration}s` : '', d.width ? `${d.width}×${d.height}` : '']
          .filter(Boolean)
          .join(' · ')
      : d.width
        ? `${d.width}×${d.height}`
        : ''

  return (
    <PvNodeShell
      id={id}
      data={d}
      selected={selected}
      color={color}
      variant="media"
      icon={<Icon size={12} />}
      labelBadge={
        <span
          className="rounded px-1.5 py-0.5 text-[9px]"
          style={
            isReference
              ? { background: 'rgba(20,184,166,.18)', color: '#2dd4bf' }
              : { background: `${color}22`, color }
          }
        >
          {isReference ? '↳ 引用素材' : '上传素材'}
        </span>
      }
      hoverActions={
        hasMedia ? (
          <button
            className="nodrag flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/80"
            title="替换文件"
            onClick={() => fileRef.current?.click()}
          >
            <RefreshCw size={12} />
          </button>
        ) : undefined
      }
      mediaBadge={
        badgeText ? (
          <span className="absolute bottom-2 right-2 z-10 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white backdrop-blur-sm">
            {badgeText}
          </span>
        ) : undefined
      }
      topBar={
        hasMedia ? (
          <PvMediaToolbar nodeId={id} onUpload={() => fileRef.current?.click()} />
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

      {hasMedia ? (
        <div className="flex h-full w-full items-center justify-center" style={{ aspectRatio: ratio }}>
          {d.content_type === 'video' ? (
            <video
              src={String(d.url)}
              className="h-full w-full object-cover"
              muted
              playsInline
              controls
              onLoadedMetadata={onVideoMeta}
            />
          ) : d.content_type === 'audio' ? (
            <div className="nodrag flex h-full w-full flex-col items-center justify-center gap-2 bg-soft px-3">
              <Music size={22} style={{ color }} />
              <audio src={String(d.url)} controls className="w-full" />
              {d.filename && (
                <span className="w-full truncate text-center text-[10px] text-ink-3">{d.filename}</span>
              )}
            </div>
          ) : (
            <img
              src={String(d.thumbnail_url || d.url)}
              alt={d.title}
              className="nodrag h-full w-full cursor-zoom-in object-cover"
              loading="lazy"
              onLoad={onImageLoad}
              onClick={() => openLightbox(String(d.url))}
            />
          )}
        </div>
      ) : (
        // 空态：上传落点（虚线框）
        <button
          className="nodrag flex h-full min-h-[120px] w-full flex-col items-center justify-center gap-2 border border-dashed border-edge text-ink-3 transition hover:border-brand-500 hover:text-ink disabled:opacity-50"
          style={{ aspectRatio: ratio }}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 size={20} className="animate-spin" /> : <Icon size={22} />}
          <span className="text-xs">{uploading ? '上传中…' : '点击选择本地文件'}</span>
          {!uploading && (
            <span className="text-[10px] text-ink-3">
              {d.content_type === 'video' ? 'MP4 / WebM / MOV' : d.content_type === 'audio' ? 'MP3 / WAV / M4A' : 'PNG / JPG / WebP'}
            </span>
          )}
        </button>
      )}
    </PvNodeShell>
  )
}
