// 文本便签 —— 在画布上记想法，不参与生成（保留无限画布的「随手记」能力）
import type { NodeProps } from '@xyflow/react'
import { StickyNote } from 'lucide-react'
import { usePvStore } from '../store'
import type { PvNodeData } from '../types'
import { PvNodeShell } from './PvNodeShell'

export function TextNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as PvNodeData
  const updateNodeData = usePvStore((s) => s.updateNodeData)

  return (
    <PvNodeShell
      id={id}
      data={d}
      selected={selected}
      color="#64748b"
      icon={<StickyNote size={14} />}
    >
      <textarea
        className="nodrag nowheel h-24 w-full resize-none rounded-md border border-edge bg-input px-2 py-1.5 text-xs leading-relaxed text-ink outline-none transition focus:border-brand-500 placeholder:text-ink-3"
        placeholder="写点什么…"
        value={d.text || ''}
        onChange={(e) => updateNodeData(id, { text: e.target.value } as Partial<PvNodeData>)}
      />
    </PvNodeShell>
  )
}
