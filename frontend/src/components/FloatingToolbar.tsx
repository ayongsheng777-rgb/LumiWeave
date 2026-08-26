// 影视创作节点系统 V2 — 左侧悬浮工具条
// 13个影视节点图标，支持拖拽和点击添加
// V2.3：默认收起为单个圆钮，点击展开浮层（不挤占画布）
import { useState } from 'react'
import { BookOpen, User, Mountain, Package, Clapperboard,
  ImageIcon, Film, Music, Type, Layout, Download,
  FileText, Sparkles, LayoutGrid, ImagePlus } from 'lucide-react'
import { makeNode, defaultDataFor, useWorkflowStore } from '../store/workflowStore'

const ITEMS: { type: string; label: string; icon: React.ReactNode; color: string }[] = [
  // ── 创作入口 ──────────────────────────────────────────────
  { type: 'story',       label: '故事',    icon: <BookOpen size={18} />,    color: 'text-violet-400' },
  { type: 'image_input', label: '图片上传', icon: <ImagePlus size={18} />,   color: 'text-blue-400' },
  // ── 资产生成 ──────────────────────────────────────────────
  { type: 'character',   label: '角色',    icon: <User size={18} />,        color: 'text-rose-400' },
  { type: 'scene',       label: '场景',    icon: <Mountain size={18} />,    color: 'text-emerald-400' },
  { type: 'prop',        label: '道具',    icon: <Package size={18} />,    color: 'text-amber-400' },
  // ── 分镜 ─────────────────────────────────────────────────
  { type: 'storyboard',  label: '分镜',    icon: <Clapperboard size={18} />, color: 'text-orange-400' },
  // ── 媒体生成 ──────────────────────────────────────────────
  { type: 'image',       label: '图片',    icon: <ImageIcon size={18} />,  color: 'text-sky-400' },
  { type: 'video',       label: '视频',    icon: <Film size={18} />,        color: 'text-pink-400' },
  // ── 后期 ─────────────────────────────────────────────────
  { type: 'audio',       label: '声音',    icon: <Music size={18} />,       color: 'text-teal-400' },
  { type: 'subtitle',    label: '字幕',    icon: <Type size={18} />,       color: 'text-indigo-400' },
  { type: 'layout',      label: '排版',    icon: <Layout size={18} />,     color: 'text-cyan-400' },
  { type: 'export',      label: '导出',    icon: <Download size={18} />,   color: 'text-green-400' },
  // ── 通用 ─────────────────────────────────────────────────
  { type: 'prompt',      label: '提示词',  icon: <FileText size={18} />,    color: 'text-gray-400' },
  { type: 'skill',       label: '技能',    icon: <Sparkles size={18} />,   color: 'text-yellow-400' },
]

export default function FloatingToolbar() {
  const [open, setOpen] = useState(false)
  const add = (type: string) => {
    const node = makeNode(type, defaultDataFor(type))
    useWorkflowStore.getState().addNode(node)
  }

  return (
    <div className="pointer-events-none absolute left-3 top-1/2 z-20 -translate-y-1/2">
      {/* 收起态：单圆钮 */}
      <button
        className={`pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-panel/90 text-ink-2 shadow-node-dark backdrop-blur-md transition hover:text-ink ${open ? 'bg-brand-500 !text-white' : ''}`}
        onClick={() => setOpen(!open)}
        title={open ? '收起节点库' : '展开节点库'}
      >
        <LayoutGrid size={19} />
      </button>

      {/* 展开态：浮动图标列（从圆钮向上展开，限高可视区；nowheel 让滚轮滚动面板而不是画布） */}
      {open && (
        <div className="nowheel pointer-events-auto absolute bottom-full left-0 mb-2 flex max-h-[calc(50vh-3rem)] w-14 flex-col items-center gap-1 overflow-y-auto rounded-2xl border border-edge bg-panel/90 py-2 shadow-node-dark backdrop-blur-md">
          <div className="mb-1 text-[10px] text-ink-3">节点</div>
          {ITEMS.map((it) => (
            <button
              key={it.type}
              title={`${it.label}（拖到画布，或点击添加）`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/lumiweave-node', it.type)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onClick={() => add(it.type)}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-2 transition hover:bg-hover active:scale-95"
            >
              <span className={it.color}>{it.icon}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
