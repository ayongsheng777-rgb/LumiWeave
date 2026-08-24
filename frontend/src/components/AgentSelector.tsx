import { useWorkflowStore } from '../store/workflowStore'

export default function AgentSelector({
  agents,
  health,
}: {
  agents: { id: string; name: string }[]
  health: Record<string, boolean | null>
}) {
  const selected = useWorkflowStore((s) => s.selectedAgent)
  const setSelected = useWorkflowStore((s) => s.setSelectedAgent)

  return (
    <div className="space-y-3">
      <button
        onClick={() => setSelected('auto')}
        className={`w-full rounded-xl border px-3 py-3 text-left transition ${
          selected === 'auto'
            ? 'border-brand-500 bg-brand-500/10'
            : 'border-edge bg-soft hover:border-ink-3'
        }`}
      >
        <div className="text-sm font-medium text-ink">自动路由</div>
        <div className="text-[11px] text-ink-2">由系统挑选最合适的智能体</div>
      </button>

      {agents.map((a) => (
        <button
          key={a.id}
          onClick={() => setSelected(a.id)}
          className={`w-full rounded-xl border px-3 py-3 text-left transition ${
            selected === a.id
              ? 'border-brand-500 bg-brand-500/10'
              : 'border-edge bg-soft hover:border-ink-3'
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${health[a.id] ? 'bg-status-completed' : 'bg-status-failed'}`}
            />
            <span className="text-sm font-medium text-ink">{a.name}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-3">{a.id}</div>
        </button>
      ))}

      {agents.length === 0 && <p className="text-[11px] text-ink-3">暂无已注册智能体</p>}
    </div>
  )
}
