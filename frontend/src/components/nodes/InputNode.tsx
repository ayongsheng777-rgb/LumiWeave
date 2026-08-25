import { type NodeProps } from '@xyflow/react'
import { FileInput } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { NodeShell, Field, inputCls } from './NodeShell'

export function InputNode({ id, data, selected }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>
  return (
    <NodeShell id={id} selected={selected} title="输入" icon={<FileInput size={15} />}>
      <Field label="原始需求">
        <textarea
          className={inputCls}
          rows={3}
          value={String(d.text ?? '')}
          placeholder="输入你的需求，会传给下游节点"
          onChange={(e) => update(id, { text: e.target.value })}
        />
      </Field>
    </NodeShell>
  )
}
