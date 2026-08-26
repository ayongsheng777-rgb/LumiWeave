// =====================================================================
// MediaNodeShell — 节点即画面（V2.4）
// 节点主体 = 一张图片/视频结果，底部一条胶囊工具条，参数收敛进悬浮弹窗。
// 跟随全局明暗主题（语义 token + backdrop-blur 磨砂）。
// =====================================================================
import { useState, type ReactNode } from 'react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { Camera, Lightbulb, Film, Clapperboard, Wand2, PencilLine, Lock, LockOpen, Trash2, Loader2 } from 'lucide-react'
import { useNodeAdapter } from '../../../store/nodeAdapter'
import type { NodeStatus } from '../../../store/workflowStore'
import type { MediaPreset } from '../../../data/mediaModels'
import { ResultMedia } from '../ResultMedia'
import { CameraMovePanel, LightingPanel, CameraLensPanel, ModelSelectPanel } from './panels'

type PopKind = 'model' | 'camera' | 'light' | 'lens' | 'prompt' | null

export interface LightingState {
  brightness: number
  colorTemp: number
  direction: string
}
export interface LensState {
  body: string
  lens: string
  focal: string
  aperture: string
}

// 胶囊工具条里的紧凑下拉段
function SegSelect({ value, options, onChange, title }: { value: string | number; options: (string | number)[]; onChange: (v: string) => void; title?: string }) {
  return (
    <select
      title={title}
      className="nodrag cursor-pointer appearance-none bg-transparent px-0.5 text-[11px] font-medium text-ink-2 outline-none hover:text-ink"
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => <option key={String(o)} value={String(o)} className="text-ink">{o}</option>)}
    </select>
  )
}

// 胶囊工具条图标按钮
function IconBtn({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`nodrag rounded-full p-1.5 transition-colors ${
        active ? 'bg-brand-500/20 text-brand-300' : 'text-ink-3 hover:bg-black/5 hover:text-ink dark:hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}

const ringOf: Record<NodeStatus, string> = {
  idle: 'ring-edge',
  running: 'ring-status-running/60',
  completed: 'ring-status-completed/60',
  failed: 'ring-status-failed/60',
  cancelled: 'ring-status-failed/60',
}

export function MediaNodeShell({
  id, selected, kind, status, url, error, presets, modelKey, durations, resolutions, ratios,
  durationValue, resolutionValue, ratioValue,
  camera, light, lens, costText, promptPreview, promptPanel,
  onChange, onGenerate,
}: {
  id: string
  selected?: boolean
  kind: 'video' | 'image'
  status: NodeStatus
  url: string
  error?: string
  presets: MediaPreset[]
  modelKey: string
  durations?: number[]
  resolutions: string[]
  ratios: string[]
  durationValue: number
  resolutionValue: string
  ratioValue: string
  camera: string
  light: LightingState
  lens: LensState
  costText: string
  promptPreview: string
  promptPanel?: ReactNode
  onChange: (patch: Record<string, unknown>) => void
  onGenerate: () => void
}) {
  const { getLocked, toggleLock, remove } = useNodeAdapter()
  const [pop, setPop] = useState<PopKind>(null)
  const locked = getLocked(id)

  const curPreset = presets.find((p) => p.key === modelKey)
  const isVideo = kind === 'video'

  return (
    <div className={`group relative overflow-visible rounded-2xl border border-edge bg-panel-2 ring-1 ${ringOf[status]} shadow-node-dark transition-all duration-300`} style={{ width: 340 }}>
      <NodeResizer isVisible={!!selected && !locked} minWidth={260} minHeight={140} color="#8b5cf6" lineStyle={{ borderWidth: 1.5 }} />

      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-canvas !bg-brand-500" />

      {/* 悬浮角标：锁定/删除（悬停显现） */}
      <div className="absolute -top-2 right-1 z-30 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className="nodrag rounded-full bg-panel-2/90 p-1 text-ink-3 shadow-sm backdrop-blur transition hover:text-ink"
          onClick={() => toggleLock(id)}
          title={locked ? '解锁' : '锁定'}
        >
          {locked ? <LockOpen size={12} /> : <Lock size={12} />}
        </button>
        <button
          className="nodrag rounded-full bg-panel-2/90 p-1 text-ink-3 shadow-sm backdrop-blur transition hover:text-red-400"
          onClick={() => remove(id)}
          title="删除节点"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* ── 画面层：结果媒体 / 占位 ── */}
      <div className="relative flex min-h-[180px] w-full items-center justify-center overflow-hidden rounded-2xl bg-soft/40">
        {url ? (
          <ResultMedia url={url} type={isVideo ? 'video' : 'image'} maxH={520} />
        ) : (
          <div className="px-4 py-6 text-center">
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/15 text-brand-300">
              {isVideo ? <Film size={16} /> : <Clapperboard size={16} />}
            </div>
            {promptPreview ? (
              <p className="mx-auto max-w-[260px] line-clamp-3 text-[11px] leading-relaxed text-ink-3">{promptPreview}</p>
            ) : (
              <p className="text-[11px] text-ink-3">点击下方紫色按钮生成</p>
            )}
          </div>
        )}

        {/* 运行中遮罩 */}
        {status === 'running' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-black/40 backdrop-blur-sm">
            <span className="flex items-center gap-2 text-xs text-white">
              <Loader2 size={14} className="animate-spin" /> AI 正在创作中…
            </span>
          </div>
        )}
      </div>

      {/* ── 弹出层容器（胶囊条上方） ── */}
      {pop && (
        <div className="absolute bottom-16 left-0 z-40 flex w-full justify-center">
          {pop === 'model' && (
            <ModelSelectPanel presets={presets} current={modelKey} onPick={(k) => { onChange({ model_key: k }); setPop(null) }} onClose={() => setPop(null)} />
          )}
          {pop === 'camera' && (
            <CameraMovePanel value={camera} onChange={(v) => onChange({ camera: v })} onClose={() => setPop(null)} />
          )}
          {pop === 'light' && (
            <LightingPanel
              brightness={light.brightness} colorTemp={light.colorTemp} direction={light.direction}
              onChange={(p) => onChange({ light: { ...light, ...p } })}
              onReset={() => onChange({ light: { brightness: 50, colorTemp: 5000, direction: 'front' } })}
              onClose={() => setPop(null)}
            />
          )}
          {pop === 'lens' && (
            <CameraLensPanel
              body={lens.body} lens={lens.lens} focal={lens.focal} aperture={lens.aperture}
              onChange={(p) => onChange({ lens: { ...lens, ...p } })}
              onClose={() => setPop(null)}
            />
          )}
          {pop === 'prompt' && promptPanel && (
            <div className="nodrag nowheel w-[340px] rounded-2xl border border-edge bg-panel-2/95 p-3 shadow-drawer backdrop-blur-xl animate-fade-in">
              {promptPanel}
              <button onClick={() => setPop(null)} className="mt-2 w-full rounded-lg bg-brand-500 py-1.5 text-xs text-white transition hover:bg-brand-600">
                完成
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 底部胶囊工具条 ── */}
      <div className="absolute bottom-3 left-1/2 z-30 flex w-[94%] -translate-x-1/2 items-center justify-between rounded-full border border-edge bg-panel-2/80 px-3 py-1.5 shadow-md backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-1.5">
          {/* 模型选择 */}
          <button
            onClick={() => setPop(pop === 'model' ? null : 'model')}
            className={`nodrag flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition ${pop === 'model' ? 'bg-brand-500/20 text-brand-300' : 'text-ink hover:bg-soft'}`}
          >
            <span className="max-w-[92px] truncate">{curPreset?.name || '选择模型'}</span>
            <span className="text-[9px] text-ink-3">▾</span>
          </button>

          {/* 时长（视频）/ 分辨率（图片） */}
          {isVideo && durations && durations.length > 0 && (
            <SegSelect title="时长" value={durationValue} options={durations} onChange={(v) => onChange({ duration: Number(v) })} />
          )}

          {/* 分辨率 */}
          {resolutions.length > 1 && (
            <SegSelect title="分辨率" value={resolutionValue} options={resolutions} onChange={(v) => onChange({ resolution: v })} />
          )}

          {/* 比例 */}
          {ratios.length > 1 && (
            <SegSelect title="比例" value={ratioValue} options={ratios} onChange={(v) => onChange({ ratio: v })} />
          )}

          {/* 运镜 / 打光 / 摄像机（视频专属运镜+打光，图片打光+摄像机） */}
          {isVideo && (
            <IconBtn title="运镜" active={pop === 'camera'} onClick={() => setPop(pop === 'camera' ? null : 'camera')}>
              <Camera size={14} />
            </IconBtn>
          )}
          <IconBtn title="打光" active={pop === 'light'} onClick={() => setPop(pop === 'light' ? null : 'light')}>
            <Lightbulb size={14} />
          </IconBtn>
          <IconBtn title="摄像机" active={pop === 'lens'} onClick={() => setPop(pop === 'lens' ? null : 'lens')}>
            <Film size={14} />
          </IconBtn>
          <IconBtn title="提示词" active={pop === 'prompt'} onClick={() => setPop(pop === 'prompt' ? null : 'prompt')}>
            <PencilLine size={14} />
          </IconBtn>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {costText && <span className="text-[10px] text-ink-3">{costText}</span>}
          <button
            onClick={onGenerate}
            className="nodrag flex items-center gap-1 rounded-full bg-brand-500 px-3 py-1.5 text-[11px] text-white shadow-sm transition-transform hover:bg-brand-600 active:scale-95"
          >
            <Wand2 size={13} /> 生成
          </button>
        </div>
      </div>

      {/* 失败原因条 */}
      {status === 'failed' && error && (
        <div className="absolute bottom-14 left-1/2 z-30 w-[92%] -translate-x-1/2 rounded-lg border border-status-failed/40 bg-status-failed/10 px-3 py-1.5 text-[10px] text-red-300 backdrop-blur">
          {error}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-canvas !bg-brand-500" />
    </div>
  )
}
