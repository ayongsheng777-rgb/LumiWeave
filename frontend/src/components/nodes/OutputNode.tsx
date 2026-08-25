import { type NodeProps } from '@xyflow/react'
import { Download } from 'lucide-react'
import { useNodeAdapter } from '../../store/nodeAdapter'
import { NodeShell, Field, inputCls } from './NodeShell'

export function OutputNode({ id, data, selected }: NodeProps) {
  const { update } = useNodeAdapter()
  const d = data as Record<string, unknown>
  return (
    <NodeShell id={id} selected={selected} title="输出" icon={<Download size={15} />}>
      <Field label="备注（无上游时直接输出这段文字）">
        <textarea
          className={inputCls}
          rows={2}
          value={String(d.text ?? '')}
          placeholder="可选"
          onChange={(e) => update(id, { text: e.target.value })}
        />
      </Field>
    </NodeShell>
  )
}
