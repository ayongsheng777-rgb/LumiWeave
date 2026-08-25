// 影视创作节点系统 V2 — 左侧悬浮工具条
// 13个影视节点图标，支持拖拽和点击添加
import { BookOpen, User, Mountain, Package, Clapperboard,
  ImageIcon, Film, Music, Type, Layout, Download,
  FileText, Sparkles } from 'lucide-react'
import { makeNode, defaultDataFor, useWorkflowStore } from '../store/workflowStore'

const ITEMS: { type: string; label: string; icon: React.ReactNode; color: string }[] = [
  // ── 创作入口 ──────────────────────────────────────────────
  { type: 'story',       label: '故事',    icon: <BookOpen size={18} />,    color: 'text-violet-400' },
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
  { type: 'subtitle',    label: '字幕',    icon: <Type size={18} />,        color: 'text-indigo-400' },
  { type: 'layout',      label: '排版',    icon: <Layout size={18} />,     color: 'text-cyan-400' },
  { type: 'export',      label: '导出',    icon: <Download size={18} />,   color: 'text-green-400' },
  // ── 通用 ─────────────────────────────────────────────────
  { type: 'prompt',      label: '提示词',  icon: <FileText size={18} />,    color: 'text-gray-400' },
  { type: 'skill',       label: '技能',    icon: <Sparkles size={18} />,   color: 'text-yellow-400' },
]

export default function FloatingToolbar() {
  const add = (type: string) => {
    const node = makeNode(type, defaultDataFor(type))
    useWorkflowStore.getState().addNode(node)
  }

  return (
    <div className="z-10 flex w-14 shrink-0 flex-col items-center gap-1 border-r border-edge bg-panel py-3">
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
          className={`flex h-10 w-10 items-center justify-center rounded-lg text-ink-2 transition hover:bg-hover hover:${it.color} active:scale-95`}
        >
          <span className={it.color}>{it.icon}</span>
        </button>
      ))}
    </div>
  )
}
