import { type NodeProps } from '@xyflow/react'
import { Brain } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { NodeShell, Field, inputCls } from './NodeShell'

export function LLMNode({ id, data, selected }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>
  return (
    <NodeShell id={id} selected={selected} title="LLM 推理" icon={<Brain size={15} />}>
      <Field label="提示词（可用 {{上游节点id}} 引用）">
        <textarea
          className={inputCls}
          rows={3}
          value={String(d.prompt ?? '')}
          placeholder="例如：把 {{输入节点id}} 改写成一段小红书文案"
          onChange={(e) => update(id, { prompt: e.target.value })}
        />
      </Field>
      <Field label="温度（0~1，越低越稳）">
        <input
          className={inputCls}
          type="number"
          step="0.1"
          min="0"
          max="2"
          value={Number(d.temperature ?? 0.3)}
          onChange={(e) => update(id, { temperature: Number(e.target.value) })}
        />
      </Field>
    </NodeShell>
  )
}
