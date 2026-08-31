// =====================================================================
// PixVerse 风格节点卡片外壳
// 对标 app.pixverse.ai 的节点外观：紧凑圆角卡片，媒体预览占主体，
// 顶部一条标题栏（类型色点 + 标题 + 状态），悬浮才浮出操作按钮。
// 明暗两套主题都走 CSS 变量，跟随全局主题自动切换。
// =====================================================================
import { useState, type ReactNode } from 'react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { Loader2, Trash2, Settings2, ChevronUp, AlertCircle } from 'lucide-react'
import { usePvStore } from '../store'
import { useUiStore } from '../../store/uiStore'
import type { NodeStatus, PvNodeData } from '../types'

export interface PvNodeShellProps {
  id: string
  data: PvNodeData
  selected?: boolean
  /** 类型色（节点强调色） */
  color: string
  icon?: ReactNode
  /** 媒体预览区 */
  preview?: ReactNode
  /** 展开后的配置表单 */
  children?: ReactNode
  /** 卡片底部一行摘要（模型名 / 提示词） */
  footer?: ReactNode
  /** 有输出时才允许从右侧拉线 */
  connectable?: boolean
}

const STATUS_TEXT: Record<NodeStatus, string> = {
  idle: '',
  running: '生成中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export function PvNodeShell({
  id,
  data,
  selected,
  color,
  icon,
  preview,
  children,
  footer,
  connectable = true,
}: PvNodeShellProps) {
  const removeNode = usePvStore((s) => s.removeNode)
  const status = (data.status || 'idle') as NodeStatus
  // 有产物默认只看结果（PixVerse 卡片化形态）；没产物就展开配置
  const [expanded, setExpanded] = useState(status === 'idle')

  const busy = status === 'running'

  return (
    // 外层不裁剪：连接点必须露在卡片外面，否则会被下面那层的 overflow-hidden 切掉，
    // 用户只能点到圆角里剩下的那一丁点，连线根本拉不出来。
    <div className="relative h-full w-full">
      {/* 输入连接点：只有生成类节点吃输入 */}
      {connectable && (
        <Handle
          type="target"
          position={Position.Left}
          className="!z-10 !h-3.5 !w-3.5 !border-2 !bg-white"
          style={{ borderColor: color, background: color }}
          isConnectableStart={false}
        />
      )}

      <div
        className="pv-node group relative flex h-full flex-col overflow-hidden animate-fade-in"
        style={{
          // 主题变量驱动：暗色 #1e1e22 / 明色 #ffffff
          background: 'var(--lw-node-bg)',
          borderRadius: 'var(--lw-node-rounded, 16px)',
          boxShadow: selected
            ? `0 0 0 2px ${color}, 0 12px 36px rgba(0,0,0,0.28)`
            : 'var(--lw-node-shadow)',
          border: `1px solid ${selected ? color : 'var(--lw-node-border)'}`,
          width: '100%',
          minWidth: 220,
        }}
      >
      {selected && (
        <NodeResizer minWidth={220} minHeight={120} color={color} lineStyle={{ borderWidth: 1.5 }} />
      )}

      {/* ── 标题栏 ─────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: color, boxShadow: busy ? `0 0 8px ${color}` : undefined }}
        />
        {icon && (
          <span className="shrink-0" style={{ color }}>
            {icon}
          </span>
        )}
        <span className="truncate text-[13px] font-medium text-ink">{data.title || '未命名'}</span>

        {status === 'running' && (
          <Loader2 size={12} className="animate-spin text-ink-2" />
        )}
        {status === 'failed' && <AlertCircle size={12} className="text-red-400" />}

        <span className="ml-auto flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
          {children && (
            <button
              className="nodrag rounded p-1 text-ink-3 transition hover:bg-soft hover:text-ink"
              title={expanded ? '收起' : '展开参数'}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronUp size={13} /> : <Settings2 size={13} />}
            </button>
          )}
          <button
            className="nodrag rounded p-1 text-ink-3 transition hover:bg-soft hover:text-red-400"
            title="删除节点"
            onClick={() => removeNode(id)}
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>

      {/* ── 媒体预览：PixVerse 的主体就是这块 ──────────────────── */}
      {preview && !expanded && <div className="relative px-2 pb-2">{preview}</div>}

      {/* ── 配置表单（展开态）──────────────────────────────────── */}
      {expanded && children && (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">{children}</div>
      )}

      {/* ── 状态提示（无预览时占位）─────────────────────────────── */}
      {!preview && !expanded && (
        <div className="flex min-h-[52px] items-center justify-center px-3 pb-3 text-[11px] text-ink-3">
          {busy ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              {STATUS_TEXT[status]}
            </span>
          ) : (
            '点 ⚙ 配置参数'
          )}
        </div>
      )}

      {/* ── 底部摘要 ──────────────────────────────────────────── */}
      {footer && !expanded && (
        <div className="shrink-0 border-t border-edge px-3 py-1.5">{footer}</div>
      )}

      {/* ── 失败原因 ──────────────────────────────────────────── */}
      {status === 'failed' && data.error && (
        <div className="shrink-0 border-t border-red-500/30 px-3 py-1.5">
          <div className="max-h-16 overflow-y-auto break-words text-[10px] leading-relaxed text-red-400">
            {String(data.error)}
          </div>
        </div>
      )}

      </div>

      {/* 输出连接点 */}
      {connectable && (
        <Handle
          type="source"
          position={Position.Right}
          className="!z-10 !h-3.5 !w-3.5 !border-2 !bg-white"
          style={{ borderColor: color, background: color }}
          isConnectableEnd={false}
        />
      )}
    </div>
  )
}

/** 媒体预览：图片直接铺，视频/音频用原生播放器 */
export function PvPreview({ data }: { data: PvNodeData }) {
  const openLightbox = useUiStore((s) => s.openLightbox)
  const src = String(data.thumbnail_url || data.url || '')
  if (!src) return null

  if (data.content_type === 'video') {
    return (
      <div className="relative overflow-hidden rounded-lg bg-black/40">
        <video
          src={src}
          className="h-auto w-full object-contain"
          style={{ maxHeight: 180 }}
          muted
          playsInline
          controls
        />
      </div>
    )
  }
  if (data.content_type === 'audio') {
    return (
      <div className="rounded-lg bg-soft px-2 py-3">
        <audio src={src} controls className="w-full" />
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg bg-soft">
      <img
        src={src}
        alt={data.title}
        className="nodrag h-auto w-full cursor-zoom-in object-contain"
        style={{ maxHeight: 200 }}
        loading="lazy"
        onClick={() => openLightbox(src)}
      />
    </div>
  )
}
