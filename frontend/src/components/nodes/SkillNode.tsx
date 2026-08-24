import { useEffect, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Wrench, Plus, X } from 'lucide-react'
import { getSkills } from '../../api'
import { useWorkflowStore } from '../../store/workflowStore'
import { NodeShell, Field, inputCls } from './NodeShell'

// 把 data.args（对象）展开成键值对行，便于列表编辑
function toRows(args: unknown): { k: string; v: string }[] {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const entries = Object.entries(args as Record<string, unknown>)
    if (entries.length) {
      return entries.map(([k, v]) => ({ k, v: typeof v === 'string' ? v : JSON.stringify(v) }))
    }
  }
  return [{ k: '', v: '' }]
}

// 把键值对行收拢回对象（空键忽略；值尝试 JSON 解析，失败按字符串）
function toArgs(rows: { k: string; v: string }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const { k, v } of rows) {
    const key = k.trim()
    if (!key) continue
    let val: unknown = v
    try {
      val = JSON.parse(v)
    } catch {
      val = v
    }
    out[key] = val
  }
  return out
}

export function SkillNode({ id, data }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>
  const [skills, setSkills] = useState<{ id: string; name: string }[]>([])
  const [rows, setRows] = useState(() => toRows(d.args))

  useEffect(() => {
    getSkills().then((r) => {
      if (r.ok) setSkills(r.data.skills || [])
    })
  }, [])

  const sync = (next: { k: string; v: string }[]) => {
    setRows(next)
    update(id, { args: toArgs(next) })
  }

  const setRow = (i: number, field: 'k' | 'v', val: string) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [field]: val } : r))
    sync(next)
  }
  const addRow = () => sync([...rows, { k: '', v: '' }])
  const delRow = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i)
    sync(next.length ? next : [{ k: '', v: '' }])
  }

  return (
    <NodeShell id={id} title="技能调用" icon={<Wrench size={15} />}>
      <Field label="选择技能">
        <select
          className={inputCls}
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

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] text-ink-3">参数（键 = 值）</span>
          <button
            type="button"
            onClick={addRow}
            className="nodrag flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-brand-300 transition hover:bg-brand-500/15"
          >
            <Plus size={12} /> 加一行
          </button>
        </div>
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                className={`${inputCls} !w-2/5`}
                placeholder="参数名"
                value={r.k}
                onChange={(e) => setRow(i, 'k', e.target.value)}
              />
              <input
                className={`${inputCls} !w-3/5`}
                placeholder="值"
                value={r.v}
                onChange={(e) => setRow(i, 'v', e.target.value)}
              />
              <button
                type="button"
                onClick={() => delRow(i)}
                className="nodrag shrink-0 rounded-md p-1 text-ink-3 transition hover:bg-status-failed/15 hover:text-red-400"
                title="删除此行"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </NodeShell>
  )
}
