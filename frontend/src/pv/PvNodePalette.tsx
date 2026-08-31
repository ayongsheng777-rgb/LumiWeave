// 节点库 —— 对标 PixVerse 左下角的 ➕ 添加节点
// 展开后按「素材 / 生成 / 辅助」分组，可以拖到画布指定位置，也可以点一下落在画布中央。
import { useMemo, useState } from 'react'
import {
  Plus,
  X,
  ImagePlus,
  Film,
  Music,
  Sparkles,
  Wand2,
  Clapperboard,
  PlayCircle,
  Copy,
  AudioLines,
  StickyNote,
} from 'lucide-react'
import { templatesByGroup } from './registry'
import type { PvNodeTemplate } from './types'
import { DND_KEY } from './PvCanvas'

const ICONS: Record<string, typeof Plus> = {
  ImagePlus,
  Film,
  Music,
  Sparkles,
  Wand2,
  Clapperboard,
  PlayCircle,
  Copy,
  AudioLines,
  StickyNote,
  Plus,
}

export function PvNodePalette({
  open,
  onToggle,
  onPick,
}: {
  open: boolean
  onToggle: () => void
  onPick: (tpl: PvNodeTemplate) => void
}) {
  const groups = useMemo(() => templatesByGroup(), [])
  const [keyword, setKeyword] = useState('')

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return groups
    return groups
      .map((g) => ({
        group: g.group,
        items: g.items.filter(
          (i) => i.label.toLowerCase().includes(kw) || i.description.toLowerCase().includes(kw),
        ),
      }))
      .filter((g) => g.items.length > 0)
  }, [groups, keyword])

  return (
    <div className="relative">
      {open && (
        <div
          className="absolute bottom-14 left-0 z-20 w-[19rem] animate-fade-in overflow-hidden rounded-2xl border backdrop-blur-xl"
          style={{
            borderColor: 'var(--lw-glass-strong-edge)',
            background: 'var(--lw-glass-strong-bg)',
            boxShadow: 'var(--lw-node-shadow-hover)',
          }}
        >
          <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
            <span className="text-xs font-medium text-ink">添加节点</span>
            <button
              className="ml-auto rounded p-1 text-ink-3 transition hover:bg-soft hover:text-ink"
              onClick={onToggle}
              title="收起"
            >
              <X size={13} />
            </button>
          </div>

          <div className="px-3 py-2">
            <input
              className="w-full rounded-md border border-edge bg-input px-2 py-1.5 text-xs text-ink outline-none transition focus:border-brand-500 placeholder:text-ink-3"
              placeholder="搜索节点…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>

          <div className="max-h-[22rem] space-y-3 overflow-y-auto px-3 pb-3">
            {filtered.map((g) => (
              <div key={g.group}>
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-ink-3">
                  {g.group}
                </div>
                <div className="space-y-1">
                  {g.items.map((tpl) => {
                    const Icon = ICONS[tpl.icon] || Plus
                    return (
                      <button
                        key={tpl.label}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DND_KEY, JSON.stringify(tpl))
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        onClick={() => onPick(tpl)}
                        className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-soft"
                        title="拖到画布上，或点一下加到中央"
                      >
                        <span
                          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                          style={{ background: `${tpl.color}22`, color: tpl.color }}
                        >
                          <Icon size={13} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-ink">
                            {tpl.label}
                          </span>
                          <span className="block text-[10px] leading-relaxed text-ink-3">
                            {tpl.description}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="py-6 text-center text-xs text-ink-3">没有匹配的节点</div>
            )}
          </div>
        </div>
      )}

      <button
        onClick={onToggle}
        title="添加节点"
        className="flex h-11 w-11 items-center justify-center rounded-full text-white transition hover:brightness-110"
        style={{ background: 'var(--brand)', boxShadow: 'var(--lw-node-shadow-hover)' }}
      >
        <Plus size={20} className={open ? 'rotate-45 transition' : 'transition'} />
      </button>
    </div>
  )
}
