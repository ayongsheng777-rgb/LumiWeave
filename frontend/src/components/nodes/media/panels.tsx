// 悬浮面板：运镜选择 / 打光设置 / 摄像机设置 / 模型选择（V2.4）
import { ChevronRight } from 'lucide-react'
import {
  CAMERA_MOVES, LIGHT_DIRECTIONS, CAMERA_BODIES, LENSES, FOCAL_LENGTHS, APERTURES,
  type MediaPreset,
} from '../../../data/mediaModels'
import { PopoverCard, SliderRow, OptionGroup, SelectRow } from './Popover'

// ── 运镜选择面板（九宫格镜头卡）────────────────────────
export function CameraMovePanel({ value, onChange, onClose }: { value: string; onChange: (v: string) => void; onClose?: () => void }) {
  return (
    <PopoverCard title="运镜选择" onClose={onClose} width={320}>
      <OptionGroup
        options={CAMERA_MOVES}
        value={value}
        onChange={onChange}
        cols={3}
      />
    </PopoverCard>
  )
}

// ── 打光设置面板（亮度/色温/光源方向）──────────────────
export function LightingPanel({
  brightness, colorTemp, direction, onChange, onReset, onClose,
}: {
  brightness: number; colorTemp: number; direction: string
  onChange: (p: { brightness?: number; colorTemp?: number; direction?: string }) => void
  onReset: () => void
  onClose?: () => void
}) {
  return (
    <PopoverCard title="打光设置" onClose={onClose} width={300}>
      <SliderRow label="亮度" value={brightness} min={0} max={100} suffix="%" onChange={(v) => onChange({ brightness: v })} />
      <SliderRow label="色温" value={colorTemp} min={2500} max={7500} step={100} suffix="K" onChange={(v) => onChange({ colorTemp: v })} />
      <div className="mb-2 text-xs text-ink-2">主光源方向</div>
      <OptionGroup options={LIGHT_DIRECTIONS} value={direction} onChange={(v) => onChange({ direction: v })} cols={3} />
      <button onClick={onReset} className="mt-3 w-full text-center text-xs text-brand-300 hover:underline">
        重置参数
      </button>
    </PopoverCard>
  )
}

// ── 摄像机设置面板（相机/镜头/焦距/光圈）────────────────
export function CameraLensPanel({
  body, lens, focal, aperture, onChange, onClose,
}: {
  body: string; lens: string; focal: string; aperture: string
  onChange: (p: { body?: string; lens?: string; focal?: string; aperture?: string }) => void
  onClose?: () => void
}) {
  return (
    <PopoverCard title="摄像机" onClose={onClose} width={280}>
      <SelectRow label="相机" options={CAMERA_BODIES} value={body} onChange={(v) => onChange({ body: v })} />
      <SelectRow label="镜头" options={LENSES} value={lens} onChange={(v) => onChange({ lens: v })} />
      <SelectRow label="焦距" options={FOCAL_LENGTHS} value={focal} onChange={(v) => onChange({ focal: v })} />
      <SelectRow label="光圈" options={APERTURES} value={aperture} onChange={(v) => onChange({ aperture: v })} />
    </PopoverCard>
  )
}

// ── 模型选择面板（带能力说明的列表）─────────────────────
export function ModelSelectPanel({
  presets, current, onPick, onClose,
}: {
  presets: MediaPreset[]
  current: string
  onPick: (key: string) => void
  onClose?: () => void
}) {
  return (
    <PopoverCard title="选择模型" onClose={onClose} width={360}>
      <div className="max-h-72 overflow-y-auto">
        {presets.map((p) => (
          <button
            key={p.key}
            onClick={() => onPick(p.key)}
            className="mb-1 flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-soft"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                {p.badge && <span className="shrink-0 rounded bg-brand-500/20 px-1 py-0.5 text-[9px] font-bold text-brand-300">{p.badge}</span>}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-ink-3">{p.desc}</div>
            </div>
            {p.key === current
              ? <span className="mt-1 shrink-0 text-brand-300"><ChevronRight size={14} /></span>
              : <span className="mt-1 shrink-0 text-ink-3">○</span>}
          </button>
        ))}
      </div>
    </PopoverCard>
  )
}
