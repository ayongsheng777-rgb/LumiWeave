// 悬浮弹窗基础组件（V2.4 节点即画面）
// 跟随全局明暗主题：用语义 token（bg-panel-2/edge/ink），叠加 backdrop-blur 磨砂。
import type { ReactNode } from 'react'

// 弹窗卡片：深/亮色自适应毛玻璃
export function PopoverCard({ title, onClose, children, width = 288 }: { title?: string; onClose?: () => void; children: ReactNode; width?: number }) {
  return (
    <div
      className="nodrag nowheel rounded-2xl border border-edge bg-panel-2/90 shadow-drawer backdrop-blur-xl animate-fade-in"
      style={{ width }}
    >
      {title && (
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <span className="text-sm font-medium text-ink">{title}</span>
          {onClose && (
            <button className="rounded p-0.5 text-ink-3 hover:text-ink" onClick={onClose}>✕</button>
          )}
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  )
}

// 滑块行：标签 + 数值 + range
export function SliderRow({
  label, value, min, max, step = 1, suffix = '', onChange,
}: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-ink-2">{label}</span>
        <span className="font-medium text-brand-300">{value}{suffix}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="nodrag w-full accent-[#8b5cf6]"
      />
    </div>
  )
}

// 方向/选项按钮组
export function OptionGroup<T extends string>({
  options, value, onChange, cols = 3,
}: {
  options: { value: T; zh: string; icon?: ReactNode }[]
  value: T
  onChange: (v: T) => void
  cols?: number
}) {
  return (
    <div className={`grid gap-1.5`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-[11px] transition ${
            value === o.value
              ? 'border-brand-500 bg-brand-500/15 text-brand-300'
              : 'border-edge bg-input/40 text-ink-2 hover:bg-soft'
          }`}
        >
          {o.icon}
          <span>{o.zh}</span>
        </button>
      ))}
    </div>
  )
}

// 下拉选择行
export function SelectRow({
  label, options, value, onChange,
}: {
  label: string; options: string[]; value: string; onChange: (v: string) => void
}) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-[11px] text-ink-2">{label}</span>
      <select
        className="nodrag w-full rounded-lg border border-edge bg-input px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}
