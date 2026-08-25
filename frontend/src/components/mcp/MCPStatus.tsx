import { useEffect, useState, useCallback } from 'react'
import { Trash2, Plus, Plug, KeyRound, RefreshCw } from 'lucide-react'
import { mcpClient } from '../../api/client'

interface McpClient {
  id: string
  name: string
  type: string
  token: string
  permissions: string[]
}

export default function MCPStatus() {
  const [info, setInfo] = useState<{ name: string; version: string; tools: unknown[] } | null>(null)
  const [clients, setClients] = useState<McpClient[]>([])
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ name: '', type: 'codex' })
  const [newToken, setNewToken] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [iRes, cRes] = await Promise.all([mcpClient.info(), mcpClient.clients()])
    if (iRes.ok) setInfo(iRes.data)
    if (cRes.ok) setClients(cRes.data.clients || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const create = async () => {
    setMessage('')
    if (!form.name.trim()) {
      setMessage('请输入客户端名称')
      return
    }
    const res = await mcpClient.createClient({ name: form.name, type: form.type, permissions: ['read', 'write', 'execute'] })
    if (res.ok) {
      setNewToken(res.data.token || '')
      setMessage('客户端已创建，请复制下方 Token')
      setForm({ name: '', type: 'codex' })
      await load()
    } else {
      setMessage(res.data.error || '创建失败')
    }
  }

  const remove = async (id: string) => {
    const res = await mcpClient.deleteClient(id)
    if (res.ok) await load()
  }

  return (
    <div className="space-y-4">
      {message && <div className="rounded-lg border border-edge bg-soft px-3 py-2 text-xs text-ink">{message}</div>}

      {/* MCP Server 状态 */}
      <div className="rounded-xl border border-edge bg-panel-2 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Plug size={15} className="text-brand-400" />
            MCP Server
          </div>
          <button
            onClick={() => load()}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg border border-edge bg-soft px-2.5 py-1 text-xs text-ink transition hover:border-brand-500 hover:text-brand-400 disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
        <div className="space-y-1 text-xs text-ink-2">
          <p>名称：{info?.name ?? 'lumiweave'}</p>
          <p>版本：{info?.version ?? '—'}</p>
          <p>已注册工具：{info?.tools?.length ?? 0} 个</p>
          <p className="text-ink-3">stdio：<code className="text-brand-300">python -m app.mcp</code></p>
          <p className="text-ink-3">HTTP：<code className="text-brand-300">/mcp</code>（streamable-http）</p>
        </div>
      </div>

      {/* 注册客户端 */}
      <div className="rounded-xl border border-edge bg-panel-2 p-4">
        <div className="mb-2 text-sm font-medium text-ink">注册客户端</div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-edge bg-input px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
            placeholder="客户端名称（如 Codex / Claude / WorkBuddy）"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            className="rounded-lg border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
            <option value="workbuddy">WorkBuddy</option>
            <option value="cursor">Cursor</option>
            <option value="generic">其他</option>
          </select>
          <button
            onClick={create}
            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white transition hover:bg-brand-500"
          >
            <Plus size={14} /> 创建
          </button>
        </div>
        {newToken && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2">
            <KeyRound size={14} className="text-brand-300" />
            <code className="flex-1 break-all text-xs text-brand-200">{newToken}</code>
          </div>
        )}
      </div>

      {/* 客户端列表 */}
      <div className="rounded-xl border border-edge bg-panel-2 p-4">
        <div className="mb-2 text-sm font-medium text-ink">已注册客户端（{clients.length}）</div>
        {clients.length === 0 ? (
          <div className="text-xs text-ink-3">暂无客户端，外部编程智能体接入前请先注册</div>
        ) : (
          <div className="space-y-2">
            {clients.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-lg border border-edge bg-soft px-3 py-2">
                <div className="flex-1">
                  <div className="text-sm text-ink">{c.name}</div>
                  <div className="text-[11px] text-ink-3">
                    {c.type} · {c.permissions?.length || 0} 权限 · <code>{c.token.slice(0, 16)}…</code>
                  </div>
                </div>
                <button onClick={() => remove(c.id)} className="rounded p-1.5 text-ink-2 transition hover:bg-soft hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
