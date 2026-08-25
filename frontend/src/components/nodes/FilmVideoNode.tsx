import { useEffect, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Film } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { getProviders } from '../../api'
import { cameraLabel } from '../../cameraLabels'
import { NodeShell, Field, inputCls } from './NodeShell'
import { GenerationModeField } from './GenerationModeField'

const CAMERAS  = ['static', 'slow push-in', 'pan-left', 'pan-right', 'handheld', 'orbit', 'zoom-in', 'dolly', 'tracking']
const RATIOS   = ['16:9', '9:16', '1:1', '4:3']
const STYLES   = ['电影感', '动漫', '写实', '3D']

export function FilmVideoNode({ id, data, selected }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    getProviders().then((r) => {
      if (r.ok) setProviders((r.data.providers || []).filter((p: { type: string }) => p.type === 'video'))
    })
  }, [])

  const prompt     = String(d.prompt ?? '')
  const camera     = String(d.camera ?? 'static')
  const duration   = Number(d.duration ?? 10)
  const fps        = Number(d.fps ?? 24)
  const ratio      = String(d.ratio ?? '16:9')
  const style      = String(d.style ?? '电影感')
  const images     = (d.images as string[]) || []
  const videoUrl   = String(d.video_url ?? '')
  const renderMode = String(d.render_mode ?? 'comfyui')
  const providerId = String(d.provider_id ?? '')

  const run = () => update(id, { action: 'execute' })

  return (
    <NodeShell id={id} selected={selected} title="视频生成" icon={<Film size={15} />}>
      <Field label="视频提示词">
        <textarea className={inputCls} rows={2} value={prompt} placeholder="描述视频动作/运镜……"
          onChange={(e) => update(id, { prompt: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="运镜">
          <select className={inputCls} value={camera} onChange={(e) => update(id, { camera: e.target.value })}>
            {CAMERAS.map((c) => <option key={c} value={c}>{cameraLabel(c)}</option>)}
            {!CAMERAS.includes(camera) && camera && <option value={camera}>{camera}</option>}
          </select>
        </Field>
        <Field label="比例">
          <select className={inputCls} value={ratio} onChange={(e) => update(id, { ratio: e.target.value })}>
            {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="时长(秒)">
          <input className={inputCls} type="number" min={3} max={60} value={duration}
            onChange={(e) => update(id, { duration: Number(e.target.value) })} />
        </Field>
        <Field label="帧率">
          <input className={inputCls} type="number" min={12} max={60} value={fps}
            onChange={(e) => update(id, { fps: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="风格">
        <select className={inputCls} value={style} onChange={(e) => update(id, { style: e.target.value })}>
          {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <GenerationModeField
        mode={renderMode}
        providerId={providerId}
        providers={providers}
        onModeChange={(v) => update(id, { render_mode: v })}
        onProviderChange={(v) => update(id, { provider_id: v })}
      />
      {images.length > 0 && (
        <div className="flex gap-1 overflow-x-auto py-1">
          {images.map((img, i) => <img key={i} src={img} className="h-12 w-20 rounded-md object-cover" alt={`img-${i}`} />)}
        </div>
      )}
      {videoUrl
        ? <video className="h-36 w-full rounded-md object-cover" src={videoUrl} controls muted loop />
        : <div className="flex h-24 items-center justify-center rounded-md bg-soft text-[11px] text-ink-3">点击生成获取视频</div>}
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={run}>
        生成视频
      </button>
    </NodeShell>
  )
}
