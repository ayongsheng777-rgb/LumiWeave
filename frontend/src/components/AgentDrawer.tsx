import { useEffect, useState } from 'react'
import { Play, X, Cpu, Save, SlidersHorizontal } from 'lucide-react'
import { getAgentHealth, getAgents } from '../api'
import { useWorkflowStore } from '../store/workflowStore'
import { useUiStore } from '../store/uiStore'
import AgentSelector from './AgentSelector'
import AgentManager from './AgentManager'

export default function AgentDrawer() {
  const open = useUiStore((s) => s.drawerOpen)
  const toggle = useUiStore((s) => s.toggleDrawer)
  const running = useWorkflowStore((s) => s.running)
  const run = useWorkflowStore((s) => s.run)
  const save = useWorkflowStore((s) => s.save)
  const saveStatus = useWorkflowStore((s) => s.saveStatus)
  const nodeCount = useWorkflowStore((s) => s.nodes.length)
  const [mode, setMode] = useState<'select' | 'manage'>('select')
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const [health, setHealth] = useState<Record<string, boolean | null>>({})

  useEffect(() => {
    getAgents().then((r) => {
      if (r.ok) {
        const list = r.data.agents || []
        setAgents(list)
        list.forEach(async (a: { id: string; name: string }) => {
          const h = await getAgentHealth(a.id)
          if (h.ok) setHealth((p) => ({ ...p, [a.id]: h.data.healthy }))
        })
      }
    })
  }, [mode])

  if (!open) {
    return (
      <button
        onClick={toggle}
        className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white shadow-node-dark transition hover:bg-brand-500"
      >
        <Cpu size={14} /> 智能体
      </button>
    )
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-edge bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <Cpu size={16} className="text-brand-400" /> 智能体控制台
        </div>
        <div className="flex items-center gap-1">
          <div className="flex rounded-lg border border-edge bg-soft p-0.5">
            <button
              onClick={() => setMode('select')}
              className={`rounded-md px-2 py-1 text-[11px] transition ${mode === 'select' ? 'bg-brand-600 text-white' : 'text-ink-2'}`}
            >
              选择
            </button>
            <button
              onClick={() => setMode('manage')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition ${mode === 'manage' ? 'bg-brand-600 text-white' : 'text-ink-2'}`}
            >
              <SlidersHorizontal size={11} /> 管理
            </button>
          </div>
          <button onClick={toggle} className="text-ink-2 transition hover:text-ink">
            <X size={16} />
          </button>
        </div>
      </div>

      {mode === 'select' ? (
        <>
          <div className="flex-1 overflow-y-auto p-4">
            <AgentSelector agents={agents} health={health} />
          </div>
          <div className="border-t border-edge p-3">
            <button
              onClick={() => run()}
              disabled={running || nodeCount === 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white shadow-node-dark transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={16} /> {running ? '执行中…' : '运行工作流'}
            </button>
            <button
              onClick={() => save()}
              disabled={nodeCount === 0}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-edge bg-soft py-2 text-sm font-medium text-ink-2 transition hover:bg-soft/70 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save size={16} />
              {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '已保存' : '保存工作流'}
            </button>
            <p className="mt-2 text-center text-[11px] text-ink-3">
              {nodeCount === 0 ? '先拖入节点' : `${nodeCount} 个节点`}
            </p>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <AgentManager />
        </div>
      )}
    </aside>
  )
}
