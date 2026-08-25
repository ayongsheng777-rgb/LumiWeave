import { useWorkflowStore } from '../../store/workflowStore'

// RefImagePicker — 从画布节点里挑「参考图」（角色图/场景图/道具图/图片/分镜结果），
// 供视频节点的「首帧生视频」单选、「多参考生视频」多选使用。
// 只列出已经生成出结果（有 url / video_url）的节点。
export function RefImagePicker({
  value,
  onChange,
  multiple = true,
  excludeId,
}: {
  value: string[]
  onChange: (urls: string[]) => void
  multiple?: boolean
  excludeId?: string
}) {
  const nodes = useWorkflowStore((s) => s.nodes)

  const candidates = nodes
    .filter((n) => n.id !== excludeId)
    .map((n) => {
      const d = (n.data || {}) as Record<string, unknown>
      const url = String((d.result as Record<string, unknown> | undefined)?.url ?? d.url ?? d.video_url ?? '')
      const label = String(d.name ?? d.label ?? n.type ?? n.id)
      return { id: n.id, type: String(n.type ?? ''), label, url }
    })
    .filter((c) => c.url)

  if (candidates.length === 0) {
    return <div className="rounded bg-soft px-2 py-1 text-[10px] text-ink-3">暂无已生成的图片可引用（先生成角色/场景图）</div>
  }

  const toggle = (url: string) => {
    if (multiple) {
      const next = value.includes(url) ? value.filter((u) => u !== url) : [...value, url]
      onChange(next)
    } else {
      onChange(value.includes(url) ? [] : [url])
    }
  }

  return (
    <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
      {candidates.map((c) => {
        const active = value.includes(c.url)
        return (
          <button
            key={c.id}
            type="button"
            className={`nodrag relative h-12 w-12 overflow-hidden rounded-md border transition ${active ? 'border-brand-500 ring-1 ring-brand-500' : 'border-edge hover:border-brand-400'}`}
            onClick={() => toggle(c.url)}
            title={`${c.label}（${c.type}）`}
          >
            <img src={c.url} alt={c.label} className="h-full w-full object-cover" />
            {active && (
              <span className="absolute inset-0 flex items-center justify-center bg-brand-600/40 text-[10px] font-bold text-white">
                ✓
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
