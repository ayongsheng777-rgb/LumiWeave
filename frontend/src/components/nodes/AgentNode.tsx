import { type NodeProps } from '@xyflow/react'
import { Cpu } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { NodeShell, Field, inputCls } from './NodeShell'

export function AgentNode({ id, data }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>
  return (
    <NodeShell id={id} title="智能体" icon={<Cpu size={15} />}>
      <Field label="智能体（留空自动路由）">
        <input
          className={inputCls}
          value={String(d.agent_id ?? '')}
          placeholder="auto / default / claude"
          onChange={(e) => update(id, { agent_id: e.target.value })}
        />
      </Field>
      <Field label="任务描述">
        <textarea
          className={inputCls}
          rows={3}
          value={String(d.message ?? '')}
          placeholder="例如：把 {{上游节点id}} 整理成一份执行方案"
          onChange={(e) => update(id, { message: e.target.value })}
        />
      </Field>
    </NodeShell>
  )
}
