/**
 * 场景时间线（规格书 §15）
 *
 * 把场景内的 shot / storyboard 对象按「场号-镜号」排序，按 duration 等比铺成轨道。
 * 点击色块 = 选中对应画布对象，双向联动。
 */
import { useSceneStore } from '../store/sceneStore'
import { cameraLabel } from '../cameraLabels'

interface Clip {
  id: string
  label: string
  duration: number
  order: number
  camera: string
  color: string
  thumb: string
}

export default function SceneTimeline() {
  const objects = useSceneStore((s) => s.objects)
  const selectedIds = useSceneStore((s) => s.selectedIds)
  const setSelected = useSceneStore((s) => s.setSelected)
  const metaOf = useSceneStore((s) => s.metaOf)

  const clips: Clip[] = objects
    .filter((o) => ['shot', 'storyboard'].includes(String(o.data.objectType)))
    .map((o) => {
      const p = (o.data.payload || {}) as Record<string, unknown>
      const meta = metaOf(String(o.data.objectType))
      const sceneNo = Number(p.scene ?? p.scene_no ?? 0)
      const shotNo = Number(p.shot ?? p.shot_no ?? 0)
      const thumb = [p.image, p.url, p.image_url].find((v) => typeof v === 'string' && v) as string | undefined
      return {
        id: o.id,
        label: `${sceneNo || '?'}-${shotNo || '?'}`,
        duration: Math.max(Number(p.duration) || 3, 1),
        order: sceneNo * 1000 + shotNo,
        camera: String(p.camera ?? p.shot_size ?? ''),
        color: meta.color,
        thumb: thumb || '',
      }
    })
    .sort((a, b) => a.order - b.order)

  const total = clips.reduce((s, c) => s + c.duration, 0)

  if (!clips.length) {
    return (
      <div className="py-4 text-center text-[10px] text-ink-3">
        还没有镜头 / 分镜对象，生成分镜后会在这里排成时间线
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[10px] text-ink-3">
        <span>共 {clips.length} 个镜头</span>
        <span>总时长 {total}s</span>
      </div>

      {/* 轨道 */}
      <div className="flex h-16 w-full gap-0.5 overflow-hidden rounded-lg border border-edge bg-canvas p-0.5">
        {clips.map((c) => {
          const active = selectedIds.includes(c.id)
          return (
            <button
              key={c.id}
              className={`group relative h-full shrink-0 overflow-hidden rounded transition ${
                active ? 'ring-2 ring-brand-500' : 'hover:opacity-90'
              }`}
              style={{
                width: `${Math.max((c.duration / total) * 100, 4)}%`,
                background: c.thumb ? undefined : `${c.color}33`,
              }}
              onClick={() => setSelected([c.id])}
              title={`${c.label} · ${c.duration}s${c.camera ? ` · ${cameraLabel(c.camera)}` : ''}`}
            >
              {c.thumb && (
                <img src={c.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />
              )}
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[9px] text-white">
                {c.label} · {c.duration}s
              </span>
              <span
                className="absolute left-0 top-0 h-0.5 w-full"
                style={{ background: c.color }}
              />
            </button>
          )
        })}
      </div>

      {/* 刻度 */}
      <div className="flex text-[9px] text-ink-3">
        {clips.map((c, i) => {
          const start = clips.slice(0, i).reduce((s, x) => s + x.duration, 0)
          return (
            <span
              key={c.id}
              className="shrink-0 border-l border-edge pl-0.5"
              style={{ width: `${Math.max((c.duration / total) * 100, 4)}%` }}
            >
              {start}s
            </span>
          )
        })}
      </div>
    </div>
  )
}
