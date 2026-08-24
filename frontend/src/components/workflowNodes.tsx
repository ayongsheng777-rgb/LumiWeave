import { useEffect, useState, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { getSkills } from '../api'
import { useWorkflowStore, type NodeStatus } from '../store/workflowStore'

type NodeData = Record<string, unknown>

function useStatus(id: string): NodeStatus {
  return useWorkflowStore((s) => s.nodeStatus[id] || 'idle')
}

function Shell({ title, status, children }: { title: string; status: NodeStatus; children: ReactNode }) {
  return (
    <div className={`wf-node wf-${status}`}>
      <Handle type="target" position={Position.Left} />
      <div className="wf-node-head">
        <span className="wf-node-title">{title}</span>
        <span className="wf-node-dot" title={status} />
      </div>
      <div className="wf-node-body">{children}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="wf-field">
      <span className="wf-field-label">{label}</span>
      {children}
    </label>
  )
}

// ---- 输入节点 ----
export function InputNode({ id, data }: NodeProps) {
  const d = data as NodeData
  const update = useWorkflowStore((s) => s.updateNodeData)
  return (
    <Shell title="输入" status={useStatus(id)}>
      <Field label="原始需求">
        <textarea
          className="nodrag nowheel"
          rows={3}
          value={String(d.text ?? '')}
          placeholder="输入你的需求，会被传给下游节点"
          onChange={(e) => update(id, { text: e.target.value })}
        />
      </Field>
    </Shell>
  )
}

// ---- LLM 推理节点 ----
export function LLMNode({ id, data }: NodeProps) {
  const d = data as NodeData
  const update = useWorkflowStore((s) => s.updateNodeData)
  return (
    <Shell title="LLM 推理" status={useStatus(id)}>
      <Field label="提示词（可用 {{上游节点id}} 引用）">
        <textarea
          className="nodrag nowheel"
          rows={3}
          value={String(d.prompt ?? '')}
          placeholder="例如：把 {{输入节点id}} 改写成一段小红书文案"
          onChange={(e) => update(id, { prompt: e.target.value })}
        />
      </Field>
      <Field label="温度（0~1，越低越稳）">
        <input
          className="nodrag nowheel"
          type="number"
          step="0.1"
          min="0"
          max="2"
          value={Number(d.temperature ?? 0.3)}
          onChange={(e) => update(id, { temperature: Number(e.target.value) })}
        />
      </Field>
    </Shell>
  )
}

// ---- Prompt 模板节点 ----
export function PromptNode({ id, data }: NodeProps) {
  const d = data as NodeData
  const update = useWorkflowStore((s) => s.updateNodeData)
  return (
    <Shell title="提示词模板" status={useStatus(id)}>
      <Field label="模板（{{kb}} 会被替换成知识库检索结果）">
        <textarea
          className="nodrag nowheel"
          rows={3}
          value={String(d.template ?? '')}
          placeholder="你是 XX 专家，请基于以下参考：{{kb}} 来完成任务"
          onChange={(e) => update(id, { template: e.target.value })}
        />
      </Field>
      <Field label="检索关键词">
        <input
          className="nodrag nowheel"
          type="text"
          value={String(d.query ?? '')}
          placeholder="从知识库检索的关键词"
          onChange={(e) => update(id, { query: e.target.value })}
        />
      </Field>
    </Shell>
  )
}

// ---- Skill 工具节点 ----
export function SkillNode({ id, data }: NodeProps) {
  const d = data as NodeData
  const update = useWorkflowStore((s) => s.updateNodeData)
  const [skills, setSkills] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    getSkills().then((r) => {
      if (r.ok) setSkills(r.data.skills || [])
    })
  }, [])
  return (
    <Shell title="技能调用" status={useStatus(id)}>
      <Field label="选择技能">
        <select
          className="nodrag nowheel"
          value={String(d.skill_id ?? '')}
          onChange={(e) => update(id, { skill_id: e.target.value })}
        >
          <option value="">（选择技能）</option>
          {skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="参数（JSON）">
        <textarea
          className="nodrag nowheel"
          rows={2}
          value={typeof d.args === 'string' ? d.args : JSON.stringify(d.args ?? {}, null, 2)}
          placeholder='{"key": "value"}'
          onChange={(e) => {
            let parsed: unknown = e.target.value
            try {
              parsed = JSON.parse(e.target.value)
            } catch {
              /* 保留原始文本 */
            }
            update(id, { args: parsed })
          }}
        />
      </Field>
    </Shell>
  )
}

// ---- 输出节点 ----
export function OutputNode({ id, data }: NodeProps) {
  const d = data as NodeData
  const update = useWorkflowStore((s) => s.updateNodeData)
  return (
    <Shell title="输出" status={useStatus(id)}>
      <Field label="备注（无上游时直接输出这段文字）">
        <textarea
          className="nodrag nowheel"
          rows={2}
          value={String(d.text ?? '')}
          placeholder="可选"
          onChange={(e) => update(id, { text: e.target.value })}
        />
      </Field>
    </Shell>
  )
}

export const nodeTypes = {
  input: InputNode,
  llm: LLMNode,
  prompt_template: PromptNode,
  skill: SkillNode,
  output: OutputNode,
}
