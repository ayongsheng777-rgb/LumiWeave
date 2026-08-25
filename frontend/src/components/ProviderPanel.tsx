import { useEffect, useState } from 'react'
import { deleteProvider, getProfiles, getProviders, listPlatformModels, routeProviders, upsertProvider } from '../api'
import { PLATFORM_PRESETS } from '../platformPresets'

interface Provider {
  id: string
  name: string
  type: string
  endpoint: string
  status: string
  cost_rate: number
  models: string[]
  api_key?: string
  _score?: number
}

const TYPES = ['llm', 'image', 'video', 'tts', 'stt', 'embedding', 'search', 'custom']

const EMPTY_FORM = { id: '', name: '', type: 'llm', endpoint: '', api_key: '', status: 'enabled', cost_rate: '0', models: '' }

export default function ProviderPanel() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [message, setMessage] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editing, setEditing] = useState(false)
  const [route, setRoute] = useState({ task_type: 'llm', quality: '1', speed: '1', cost: '1' })
  const [routeResult, setRouteResult] = useState<Provider[] | null>(null)
  const [configuredModels, setConfiguredModels] = useState<{ id: string; name: string; model: string; base_url: string }[]>([])
  const [platformModels, setPlatformModels] = useState<string[]>([])

  const load = async () => {
    const res = await getProviders()
    if (res.ok) setProviders(res.data.providers || [])
  }

  useEffect(() => {
    load()
    getProfiles().then((r) => {
      if (r.ok) setConfiguredModels(r.data.profiles || [])
    })
  }, [])

  // 复用已配置的模型：把它的 base_url + model 填进 Provider 表单
  const reuseModel = (m: { id: string; name: string; model: string; base_url: string }) => {
    setForm((f) => ({
      ...f,
      id: f.id || `provider-${m.id}`,
      name: f.name || m.name,
      endpoint: f.endpoint || m.base_url || '',
      models: f.models ? `${f.models}, ${m.model}` : m.model,
    }))
    setMessage(`已复用模型 ${m.name}（${m.model}）`)
  }

  const handleFetchModels = async () => {
    setMessage('')
    const res = await listPlatformModels()
    if (res.ok && res.data.models) {
      setPlatformModels(res.data.models)
      setMessage(`已获取 ${res.data.count} 个平台可用模型，点击填入`)
    } else {
      setPlatformModels([])
      setMessage(res.data.error || '获取失败（需先配置一个有 Key 的模型）')
    }
  }

  const applyPreset = (key: string) => {
    const p = PLATFORM_PRESETS.find((x) => x.key === key)
    if (!p) return
    setForm((f) => ({ ...f, id: p.key, name: p.name, type: 'llm', endpoint: p.baseUrl, models: p.models.join(', ') }))
  }

  const save = async () => {
    setMessage('')
    if (!form.id.trim()) {
      setMessage('请填写 ID')
      return
    }
    const res = await upsertProvider({
      id: form.id.trim(),
      name: form.name.trim(),
      type: form.type,
      endpoint: form.endpoint.trim(),
      api_key: form.api_key,
      status: form.status,
      cost_rate: parseFloat(form.cost_rate) || 0,
      models: form.models.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    })
    if (res.ok) {
      setMessage(`已保存 ${form.id}`)
      setForm(EMPTY_FORM)
      setEditing(false)
      load()
    } else {
      setMessage(res.data.error || '保存失败')
    }
  }

  const edit = (p: Provider) => {
    setForm({
      id: p.id, name: p.name, type: p.type, endpoint: p.endpoint,
      api_key: p.api_key || '', status: p.status,
      cost_rate: String(p.cost_rate ?? 0), models: (p.models || []).join(', '),
    })
    setEditing(true)
    setMessage('')
  }

  const remove = async (pid: string) => {
    if (!window.confirm(`删除 Provider「${pid}」？`)) return
    const res = await deleteProvider(pid)
    if (res.ok) load()
  }

  const doRoute = async () => {
    const res = await routeProviders({
      task_type: route.task_type,
      quality: parseFloat(route.quality) || 1,
      speed: parseFloat(route.speed) || 1,
      cost: parseFloat(route.cost) || 1,
    })
    if (res.ok) setRouteResult(res.data.providers || [])
  }

  return (
    <div className="panel">
      <h2>商业接口 Provider</h2>
      <div className="message" style={{ marginBottom: 12, background: 'var(--soft, #f3f4f6)' }}>
        <b>什么是 Provider：</b>「外面 AI 服务」的统一插头，把对话/图片/视频/语音等能力标准化。
        推荐起步三件套：<b>llm→DeepSeek</b>、<b>image→硅基流动 FLUX</b>、<b>video→MiniMax H3/可灵</b>。
        完整说明见 <code>docs/PROVIDER_GUIDE.md</code>。API Key 只显示 ****，不泄露明文。
      </div>
      {message && <div className="message">{message}</div>}

      <div className="render-box">
        <h3>{editing ? `编辑 Provider ${form.id}` : '新增 Provider'}</h3>
        <div className="message" style={{ marginBottom: 8, background: 'var(--soft, #f3f4f6)' }}>
          <b>快速选择平台：</b>选中后自动填好名称、端点 URL、模型列表，你只需填 API Key。
        </div>
        <select
          value=""
          onChange={(e) => applyPreset(e.target.value)}
          style={{ maxWidth: 420 }}
        >
          <option value="" disabled>选择平台预设…</option>
          {PLATFORM_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>{p.name}{p.note ? `（${p.note}）` : ''}</option>
          ))}
        </select>
        <div className="provider-form">
          <label>
            <span className="field-label">ID（唯一）</span>
            <input placeholder="如 deepseek-chat" value={form.id} disabled={editing} onChange={(e) => setForm({ ...form, id: e.target.value })} />
          </label>
          <label>
            <span className="field-label">名称</span>
            <input placeholder="如 DeepSeek 对话" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            <span className="field-label">类型</span>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">端点 URL（接口地址）</span>
            <input placeholder="https://api.deepseek.com/v1" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
          </label>
          <label>
            <span className="field-label">API Key（暗号）</span>
            <input placeholder="sk-..." type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
          </label>
          <label>
            <span className="field-label">状态</span>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="enabled">启用</option>
              <option value="disabled">停用</option>
            </select>
          </label>
          <label>
            <span className="field-label">成本率（0~100，越小越优先）</span>
            <input placeholder="0" value={form.cost_rate} onChange={(e) => setForm({ ...form, cost_rate: e.target.value })} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span className="field-label">模型列表（逗号分隔，可选）</span>
            <input placeholder="如 deepseek-chat, deepseek-reasoner" value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} />
          </label>

          <div style={{ gridColumn: '1 / -1' }}>
            <span className="field-label">复用已配置模型 / 自动获取平台模型</span>
            <div className="skill-actions" style={{ marginTop: 4 }}>
              {configuredModels.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    const m = configuredModels.find((x) => x.id === e.target.value)
                    if (m) reuseModel(m)
                  }}
                  style={{ flex: 1, minWidth: 180 }}
                >
                  <option value="" disabled>复用已配置的模型…</option>
                  {configuredModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}（{m.model}）</option>
                  ))}
                </select>
              )}
              <button className="ghost" onClick={handleFetchModels}>自动获取可用模型</button>
            </div>
            {platformModels.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--lw-edge)] bg-[var(--lw-input-bg)] p-2" style={{ marginTop: 6 }}>
                {platformModels.map((m) => (
                  <button
                    key={m}
                    onClick={() => setForm((f) => ({ ...f, models: f.models ? `${f.models}, ${m}` : m }))}
                    className="block w-full truncate rounded px-2 py-1 text-left text-[11px] text-[var(--lw-ink-2)] transition hover:bg-[var(--lw-hover)]"
                  >
                    ＋ {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="skill-actions">
          <button onClick={save}>保存</button>
          {editing && <button className="ghost" onClick={() => { setForm(EMPTY_FORM); setEditing(false) }}>取消编辑</button>}
        </div>
      </div>

      <div className="renderer-list">
        {providers.map((p) => (
          <div key={p.id} className="renderer-card">
            <div className="renderer-head">
              <div>
                <b>{p.name || p.id}</b>
                <span className="muted"> · {p.type} · {p.id}</span>
              </div>
              <span className={`badge ${p.status === 'enabled' ? 'on' : 'off'}`}>{p.status === 'enabled' ? '启用' : '停用'}</span>
            </div>
            <p className="muted">端点: {p.endpoint || '未配置'} · 成本率: {p.cost_rate}</p>
            {p.models && p.models.length > 0 && <p className="muted">模型: {p.models.join(', ')}</p>}
            <div className="skill-actions">
              <button className="ghost" onClick={() => edit(p)}>编辑</button>
              <button className="ghost" onClick={() => remove(p.id)}>删除</button>
            </div>
          </div>
        ))}
        {providers.length === 0 && <div className="empty-box">暂无 Provider，点「新增 Provider」配置商业接口（URL + Key）</div>}
      </div>

      <div className="render-box">
        <h3>评分路由测试</h3>
        <div className="provider-form">
          <select value={route.task_type} onChange={(e) => setRoute({ ...route, task_type: e.target.value })}>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input placeholder="质量权重" value={route.quality} onChange={(e) => setRoute({ ...route, quality: e.target.value })} />
          <input placeholder="速度权重" value={route.speed} onChange={(e) => setRoute({ ...route, speed: e.target.value })} />
          <input placeholder="成本权重" value={route.cost} onChange={(e) => setRoute({ ...route, cost: e.target.value })} />
          <button onClick={doRoute}>路由</button>
        </div>
        {routeResult && (
          <div className="renderer-list">
            {routeResult.map((p, i) => (
              <div key={p.id} className="renderer-card">
                <div className="renderer-head">
                  <div>
                    <b>#{i + 1} {p.name || p.id}</b>
                    <span className="muted"> · {p.type}</span>
                  </div>
                  <span className="tag ok-tag">评分 {p._score}</span>
                </div>
              </div>
            ))}
            {routeResult.length === 0 && <div className="empty-box">该任务类型下没有启用的 Provider</div>}
          </div>
        )}
      </div>
    </div>
  )
}
