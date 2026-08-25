import { useEffect, useState } from 'react'
import { deleteAgent, getAgents, getAgentTools, saveAgentTools, upsertAgent } from '../api'

interface Agent {
  id: string
  name: string
  enabled: boolean
  protocol: string
  model: string
  endpoint: string
  base_url: string
  api_key: string
  has_api_key: boolean
  tools: string[]
}

interface Tool {
  id: string
  name: string
  description: string
}

const PROTOCOLS = ['openai-compatible', 'anthropic', 'custom-http']
const EMPTY_FORM = { id: '', name: '', protocol: 'openai-compatible', model: '', url: '', api_key: '', enabled: true, tools: [] as string[] }

const inputCls =
  'w-full rounded-lg border border-edge bg-input px-2.5 py-1.5 text-sm text-ink outline-none transition focus:border-brand-500 placeholder:text-ink-3'

export default function AgentManager() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [tools, setTools] = useState<Tool[]>([])
  const [searchCfg, setSearchCfg] = useState({ provider: 'duckduckgo', tavily_key: '', serper_key: '' })
  const [form, setForm] = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const aRes = await getAgents()
    if (aRes.ok) setAgents(aRes.data.agents || [])
    const tRes = await getAgentTools()
    if (tRes.ok) {
      setTools(tRes.data.tools || [])
      if (tRes.data.search_config) setSearchCfg(tRes.data.search_config)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const save = async () => {
    if (!form.id.trim()) {
      setMessage('请填写 ID')
      return
    }
    setBusy(true)
    setMessage('')
    const payload: Record<string, unknown> = {
      id: form.id.trim(),
      name: form.name.trim() || form.id.trim(),
      protocol: form.protocol,
      model: form.model.trim(),
      api_key: form.api_key,
      enabled: form.enabled,
      tools: form.tools,
    }
    if (form.protocol === 'anthropic') payload.endpoint = form.url.trim()
    else payload.base_url = form.url.trim()
    const res = await upsertAgent(payload)
    setBusy(false)
    if (res.ok) {
      setMessage(`已保存 ${form.id}`)
      setShowForm(false)
      setForm(EMPTY_FORM)
      setEditing(false)
      load()
    } else {
      setMessage(res.data.error || '保存失败')
    }
  }

  const edit = (a: Agent) => {
    setForm({
      id: a.id, name: a.name, protocol: a.protocol, model: a.model,
      url: a.endpoint || a.base_url, api_key: a.api_key || '', enabled: a.enabled, tools: a.tools || [],
    })
    setEditing(true)
    setShowForm(true)
    setMessage('')
  }

  const remove = async (id: string) => {
    if (!window.confirm(`删除智能体「${id}」？`)) return
    setMessage('')
    const res = await deleteAgent(id)
    if (res.ok) {
      setMessage(`已删除 ${id}`)
      load()
    } else {
      setMessage(res.data.error || '删除失败')
    }
  }

  const toggleTool = (toolId: string) => {
    setForm((f) => ({
      ...f,
      tools: f.tools.includes(toolId) ? f.tools.filter((t) => t !== toolId) : [...f.tools, toolId],
    }))
  }

  const saveSearch = async () => {
    setMessage('')
    const res = await saveAgentTools(searchCfg)
    setMessage(res.ok ? '搜索配置已保存' : '保存失败')
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-lg border border-edge bg-soft px-3 py-2 text-xs text-ink-2">{message}</div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">智能体列表</span>
        <button
          onClick={() => { setForm(EMPTY_FORM); setEditing(false); setShowForm((v) => !v) }}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-500"
        >
          {showForm ? '收起' : '＋ 新增'}
        </button>
      </div>

      {showForm && (
        <div className="space-y-2 rounded-xl border border-brand-500/30 bg-panel-2 p-3">
          <div className="text-xs font-medium text-ink">{editing ? `编辑 ${form.id}` : '新增智能体'}</div>
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} placeholder="ID（唯一）" value={form.id} disabled={editing} onChange={(e) => setForm({ ...form, id: e.target.value })} />
            <input className={inputCls} placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className={inputCls} value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })}>
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input className={inputCls} placeholder="模型名" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input className={`${inputCls} col-span-2`} placeholder={form.protocol === 'anthropic' ? '接口地址 endpoint' : 'Base URL（如 https://api.deepseek.com/v1）'} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <input className={`${inputCls} col-span-2`} placeholder="API Key（留空/**** 表示不改动）" type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
          </div>

          <div className="text-xs font-medium text-ink">可调用的工具</div>
          <div className="space-y-1">
            {tools.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-edge bg-panel-2 px-2.5 py-1.5">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={form.tools.includes(t.id)} onChange={() => toggleTool(t.id)} />
                <span className="text-xs">
                  <span className="text-ink">{t.name}</span>
                  <span className="block text-[10px] text-ink-3">{t.description}</span>
                </span>
              </label>
            ))}
            {tools.length === 0 && <div className="text-[11px] text-ink-3">暂无工具</div>}
          </div>

          <label className="flex items-center gap-2 text-xs text-ink">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            启用此智能体
          </label>

          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-brand-500 disabled:opacity-40">保存</button>
            <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setEditing(false) }} className="rounded-lg border border-edge px-4 py-1.5 text-xs text-ink-2 transition hover:bg-soft">取消</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {agents.map((a) => (
          <div key={a.id} className="rounded-xl border border-edge bg-panel-2 p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">{a.name}</span>
              <span className="text-[11px] text-ink-3">{a.id} · {a.protocol}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${a.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-soft text-ink-3'}`}>
                {a.enabled ? '启用' : '停用'}
              </span>
              <div className="ml-auto flex gap-1.5">
                <button onClick={() => edit(a)} className="rounded-md border border-edge px-2 py-0.5 text-[11px] text-ink-2 transition hover:bg-soft">编辑</button>
                <button onClick={() => remove(a.id)} className="rounded-md border border-edge px-2 py-0.5 text-[11px] text-ink-2 transition hover:bg-soft hover:text-red-400">删除</button>
              </div>
            </div>
            <div className="mt-1 text-[11px] text-ink-2">
              模型：{a.model || '—'} · 地址：{a.endpoint || a.base_url || '—'} · Key：{a.has_api_key ? '已配置' : '未配置'}
            </div>
            {(a.tools || []).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {a.tools.map((tid) => {
                  const t = tools.find((x) => x.id === tid)
                  return <span key={tid} className="rounded bg-brand-500/10 px-1.5 py-0.5 text-[10px] text-brand-300">{t?.name || tid}</span>
                })}
              </div>
            )}
          </div>
        ))}
        {agents.length === 0 && <div className="rounded-lg border border-edge bg-panel-2 p-3 text-center text-xs text-ink-3">暂无智能体</div>}
      </div>

      <div className="rounded-xl border border-edge bg-panel-2 p-3">
        <div className="text-xs font-medium text-ink">联网搜索配置</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select className={inputCls} value={searchCfg.provider} onChange={(e) => setSearchCfg({ ...searchCfg, provider: e.target.value })}>
            <option value="duckduckgo">DuckDuckGo（免费）</option>
            <option value="tavily">Tavily（需 key）</option>
            <option value="serper">Serper（需 key）</option>
          </select>
          <input className={inputCls} placeholder="Tavily Key" type="password" value={searchCfg.tavily_key} onChange={(e) => setSearchCfg({ ...searchCfg, tavily_key: e.target.value })} />
          <input className={`${inputCls} col-span-2`} placeholder="Serper Key" type="password" value={searchCfg.serper_key} onChange={(e) => setSearchCfg({ ...searchCfg, serper_key: e.target.value })} />
        </div>
        <button onClick={saveSearch} className="mt-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-500">保存搜索配置</button>
      </div>
    </div>
  )
}
