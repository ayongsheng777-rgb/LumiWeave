import { type NodeProps } from '@xyflow/react'
import { FileText } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { NodeShell, Field, inputCls } from './NodeShell'

export function PromptNode({ id, data }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>
  return (
    <NodeShell id={id} title="提示词模板" icon={<FileText size={15} />}>
      <Field label="模板（{{kb}} 会被替换成知识库检索结果）">
        <textarea
          className={inputCls}
          rows={3}
          value={String(d.template ?? '')}
          placeholder="你是 XX 专家，请基于以下参考：{{kb}} 来完成任务"
          onChange={(e) => update(id, { template: e.target.value })}
        />
      </Field>
      <Field label="检索关键词">
        <input
          className={inputCls}
          type="text"
          value={String(d.query ?? '')}
          placeholder="从知识库检索的关键词"
          onChange={(e) => update(id, { query: e.target.value })}
        />
      </Field>
    </NodeShell>
  )
}
