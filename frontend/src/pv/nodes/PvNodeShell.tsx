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
  /**
   * 卡片形态：
   * - card（默认）：标题栏 + 预览 + 表单的重卡片（生成/文本节点用）
   * - media      ：媒体优先，标题做成浮动标签，操作按钮悬浮才出现（素材节点用，对标 PixVerse）
   */
  variant?: 'card' | 'media'
  /** media 变体：浮动标签右侧的小徽标（如「上传素材」「引用素材」） */
  labelBadge?: ReactNode
  /** media 变体：媒体区右上角悬浮操作按钮 */
  hoverActions?: ReactNode
  /** media 变体：媒体区右下角角标（如时长/分辨率 13.7s · 1920×1080） */
  mediaBadge?: ReactNode
  /** 自定义输入连接点（如图生视频的首帧/尾帧双点），给了就不画默认输入点 */
  customTargetHandles?: ReactNode
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
  variant = 'card',
  labelBadge,
  hoverActions,
  mediaBadge,
  customTargetHandles,
}: PvNodeShellProps) {
  const removeNode = usePvStore((s) => s.removeNode)
  const status = (data.status || 'idle') as NodeStatus
  // 有产物默认只看结果（PixVerse 卡片化形态）；没产物就展开配置
  const [expanded, setExpanded] = useState(status === 'idle')

  const busy = status === 'running'

  // ── 媒体优先形态（素材节点）：标题浮动在卡片上方，媒体铺满卡片 ──
  if (variant === 'media') {
    return (
      <div className="group/media relative h-full w-full">
        {/* 浮动标签：类型 chip + 徽标（对标 PixVerse 节点上方的小字） */}
        <div className="absolute -top-7 left-0 flex items-center gap-1.5 whitespace-nowrap">
          <span
            className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] text-ink-2"
            style={{ borderColor: 'var(--lw-edge)', background: 'var(--lw-node-bg)' }}
          >
            {icon && <span style={{ color }}>{icon}</span>}
            {data.title || '未命名'}
          </span>
          {labelBadge}
        </div>

        {customTargetHandles ??
          (connectable && (
            <Handle
              type="target"
              position={Position.Left}
              className="!z-10 !h-3.5 !w-3.5 !border-2 !bg-white"
              style={{ borderColor: color, background: color }}
              isConnectableStart={false}
            />
          ))}

        <div
          className="pv-node relative h-full w-full overflow-hidden animate-fade-in"
          style={{
            background: 'var(--lw-node-bg)',
            borderRadius: 'var(--lw-node-rounded, 14px)',
            boxShadow: selected
              ? `0 0 0 2px ${color}, 0 12px 36px rgba(0,0,0,0.28)`
              : 'var(--lw-node-shadow)',
            border: `1px solid ${selected ? color : 'var(--lw-node-border)'}`,
          }}
        >
          {selected && (
            <NodeResizer minWidth={160} minHeight={100} color={color} lineStyle={{ borderWidth: 1.5 }} />
          )}

          {/* 媒体区（由素材节点自己渲染：图/视频/音频/上传按钮） */}
          {children}

          {/* 右下角角标：时长/分辨率 */}
          {mediaBadge}

          {/* 悬浮操作：替换 / 删除，鼠标移上来才出现 */}
          <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition group-hover/media:opacity-100">
            {hoverActions}
            <button
              className="nodrag flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm transition hover:bg-red-500/80"
              title="删除节点"
              onClick={() => removeNode(id)}
            >
              <Trash2 size={12} />
            </button>
          </div>

          {/* 运行态蒙层 */}
          {busy && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
              <span className="flex items-center gap-1.5 text-[11px] text-white">
                <Loader2 size={13} className="animate-spin" />
                {STATUS_TEXT[status] || '处理中'}
              </span>
            </div>
          )}
          {status === 'failed' && (
            <div className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-1 rounded-md bg-red-500/85 px-2 py-1 text-[10px] text-white">
              <AlertCircle size={11} className="shrink-0" />
              <span className="truncate">{data.error || '失败'}</span>
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

  // ── 卡片形态（生成/文本节点，原有外观）──
  return (
    // 外层不裁剪：连接点必须露在卡片外面，否则会被下面那层的 overflow-hidden 切掉，
    // 用户只能点到圆角里剩下的那一丁点，连线根本拉不出来。
    <div className="relative h-full w-full">
      {/* 输入连接点：只有生成类节点吃输入 */}
      {customTargetHandles ??
        (connectable && (
          <Handle
            type="target"
            position={Position.Left}
            className="!z-10 !h-3.5 !w-3.5 !border-2 !bg-white"
            style={{ borderColor: color, background: color }}
            isConnectableStart={false}
          />
        ))}

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
