/**
 * LumiWeave V2.5 PromptNode
 * 规格书 §2: Prompt Node
 */
import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import NodeShell from '../canvas/NodeShell'

export function PromptNode({ id, data }: NodeProps) {
  const { updateObject, deleteObjects } = useCanvasStore()
  const d = data as { text?: string; negative?: string; style?: string; status?: string }
  const [activeTab, setActiveTab] = useState<'main' | 'negative' | 'style'>('main')

  const update = (patch: Record<string, unknown>) => {
    updateObject(id, { ...d, ...patch })
  }

  return (
    <NodeShell
      title="提示词"
      color="#6366f1"
      status={d.status}
      onDelete={() => deleteObjects([id])}
    >
      <div className="space-y-2">
        <div className="flex gap-1 mb-2">
          {(['main', 'negative', 'style'] as const).map((t) => (
            <button
              key={t}
              className={`text-[10px] px-2 py-1 rounded ${activeTab === t ? 'bg-indigo-500 text-white' : 'bg-[var(--lw-ink-1)] text-[var(--lw-ink-3)]'}`}
              onClick={() => setActiveTab(t)}
            >
              {t === 'main' ? '正向' : t === 'negative' ? '负向' : '风格'}
            </button>
          ))}
        </div>

        {activeTab === 'main' && (
          <textarea
            className="nodrag w-full text-xs bg-[var(--lw-ink-1)] border border-[var(--lw-ink-1)] rounded px-2 py-1.5 resize-none focus:outline-none focus:border-indigo-500"
            rows={4}
            placeholder="描述画面内容…"
            value={d.text || ''}
            onChange={(e) => update({ text: e.target.value })}
          />
        )}

        {activeTab === 'negative' && (
          <textarea
            className="nodrag w-full text-xs bg-[var(--lw-ink-1)] border border-[var(--lw-ink-1)] rounded px-2 py-1.5 resize-none focus:outline-none focus:border-indigo-500"
            rows={3}
            placeholder="不想出现的内容…"
            value={d.negative || ''}
            onChange={(e) => update({ negative: e.target.value })}
          />
        )}

        {activeTab === 'style' && (
          <select
            className="nodrag w-full text-xs bg-[var(--lw-ink-1)] border border-[var(--lw-ink-1)] rounded px-2 py-1.5 focus:outline-none"
            value={d.style || '电影感'}
            onChange={(e) => update({ style: e.target.value })}
          >
            {['电影感', '写实', '插画', '动漫', '水彩', '3D渲染', '赛博朋克', '古风'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
      </div>
    </NodeShell>
  )
}
