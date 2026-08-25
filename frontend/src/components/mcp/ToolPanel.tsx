import { useEffect, useState } from 'react'
import { Wrench } from 'lucide-react'
import { mcpClient } from '../../api/client'

interface Tool {
  name: string
  description: string
  category: string
  required_permission?: string | null
}

const CATEGORY_LABEL: Record<string, string> = {
  canvas: '画布 Canvas',
  workflow: '工作流 Workflow',
  asset: '素材 Asset',
  provider: '接口 Provider',
  project: '项目 Project',
}

const PERM_LABEL: Record<string, string> = {
  read: '读',
  write: '写',
  execute: '执行',
}

export default function ToolPanel() {
  const [tools, setTools] = useState<Tool[]>([])

  useEffect(() => {
    mcpClient.info().then((res) => {
      if (res.ok) setTools(res.data.tools || [])
    })
  }, [])

  const grouped = tools.reduce<Record<string, Tool[]>>((acc, t) => {
    const key = t.category || 'other'
    ;(acc[key] ||= []).push(t)
    return acc
  }, {})

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-ink">
        <Wrench size={15} className="text-brand-400" />
        MCP 工具库（{tools.length} 个）
      </div>
      {Object.entries(grouped).map(([cat, list]) => (
        <div key={cat} className="rounded-xl border border-edge bg-panel-2 p-3">
          <div className="mb-2 text-xs font-medium text-ink-2">{CATEGORY_LABEL[cat] ?? cat}</div>
          <div className="space-y-1.5">
            {list.map((t) => (
              <div key={t.name} className="flex items-start gap-2">
                <code className="shrink-0 rounded bg-soft px-1.5 py-0.5 text-[11px] text-brand-300">{t.name}</code>
                <div className="flex-1 text-[11px] text-ink-2">{t.description}</div>
                {t.required_permission && (
                  <span className="shrink-0 rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-3">
                    {PERM_LABEL[t.required_permission] ?? t.required_permission}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {tools.length === 0 && <div className="text-xs text-ink-3">暂无工具（MCP Server 未连接）</div>}
    </div>
  )
}
