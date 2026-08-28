// SkillPicker —— 技能库选择器（V2.9l）
// 中英双文技能名 + 名字下黑色小字描述；点击展开面板选择
import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

type AnyObj = Record<string, unknown>

export default function SkillPicker({
  value,
  skills,
  onChange,
  disabled,
  placeholder = '技能库（可选，注入生成质量）',
  className = '',
}: {
  value: string
  skills: AnyObj[]
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cur = skills.find((s) => String(s.id ?? '') === value)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        className="nodrag flex h-7 w-full items-center justify-between gap-1 rounded-md border border-edge bg-input px-2 text-[11px] text-ink outline-none transition hover:border-brand-500 disabled:opacity-50"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="选择技能库注入生成（提升画面描述/提示词质量）；知识库自动引用"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {cur ? String(cur.name ?? cur.id ?? '') : placeholder}
        </span>
        <ChevronDown size={12} className={`shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="nowheel absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-edge bg-panel shadow-xl">
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-[11px] text-ink-3 transition hover:bg-soft"
            onClick={() => { onChange(''); setOpen(false) }}
          >
            不引用技能库
          </button>
          {skills.map((s) => (
            <button
              key={String(s.id ?? '')}
              type="button"
              className={`block w-full px-3 py-2 text-left transition hover:bg-soft ${value === String(s.id ?? '') ? 'bg-brand-500/10' : ''}`}
              onClick={() => { onChange(String(s.id ?? '')); setOpen(false) }}
            >
              <span className="block text-[11px] font-medium leading-snug text-ink">
                {String(s.name ?? s.id ?? '')}
              </span>
              {s.description ? (
                <span className="block pt-0.5 text-[10px] leading-snug text-black/60">
                  {String(s.description).slice(0, 90)}
                  {String(s.description).length > 90 ? '…' : ''}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
