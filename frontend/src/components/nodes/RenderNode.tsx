import { type NodeProps } from '@xyflow/react'
import { Sparkles } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { NodeShell, Field, inputCls } from './NodeShell'

// 算力 / 出图节点：后端暂无执行器，运行时会被 workflowStore.run 友好拦截
export function RenderNode({ id, data }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>
  return (
    <NodeShell id={id} title="出图 / 算力" icon={<Sparkles size={15} />}>
      <div className="rounded-md bg-brand-500/10 px-2 py-1.5 text-[11px] leading-snug text-brand-300">
        运行时会经算力路由自动派发：大显存任务走云端，其余进本地队列
      </div>
      <Field label="出图提示词">
        <textarea
          className={inputCls}
          rows={3}
          value={String(d.prompt ?? '')}
          placeholder="描述你想生成的画面"
          onChange={(e) => update(id, { prompt: e.target.value })}
        />
      </Field>
      <Field label="模型（预留）">
        <input
          className={inputCls}
          type="text"
          value={String(d.model ?? '')}
          placeholder="如 sd-xl"
          onChange={(e) => update(id, { model: e.target.value })}
        />
      </Field>
    </NodeShell>
  )
}
