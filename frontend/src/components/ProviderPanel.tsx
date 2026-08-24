import { useEffect, useState } from 'react'
import { deleteProvider, getProviders, routeProviders, upsertProvider } from '../api'

interface Provider {
  id: string
  name: string
  type: string
  endpoint: string
  status: string
  cost_rate: number
  models: string[]
  _score?: number
}

const TYPES = ['llm', 'image', 'video', 'tts', 'stt', 'embedding', 'search', 'custom']

export default function ProviderPanel() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ id: '', name: '', type: 'llm', endpoint: '', api_key: '', status: 'enabled', cost_rate: '0' })
  const [route, setRoute] = useState({ task_type: 'llm', quality: '1', speed: '1', cost: '1' })
  const [routeResult, setRouteResult] = useState<Provider[] | null>(null)

  const load = async () => {
    const res = await getProviders()
    if (res.ok) setProviders(res.data.providers || [])
  }

  useEffect(() => {
    load()
  }, [])

  const save = async () => {
    setMessage('')
    if (!form.id.trim()) {
      setMessage('请填写 ID')
      return
    }
    const res = await upsertProvider({
      ...form,
      cost_rate: parseFloat(form.cost_rate) || 0,
      models: [],
    })
    if (res.ok) {
      setMessage(`已保存 ${form.id}`)
      setForm({ id: '', name: '', type: 'llm', endpoint: '', api_key: '', status: 'enabled', cost_rate: '0' })
      load()
    } else {
      setMessage(res.data.error || '保存失败')
    }
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
      {message && <div className="message">{message}</div>}

      <div className="render-box">
        <h3>新增 / 更新 Provider</h3>
        <div className="provider-form">
          <input placeholder="ID（唯一，如 openai-gpt4o）" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
          <input placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input placeholder="端点 URL" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
          <input placeholder="API Key" type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="enabled">启用</option>
            <option value="disabled">停用</option>
          </select>
          <input placeholder="成本率 cost_rate" value={form.cost_rate} onChange={(e) => setForm({ ...form, cost_rate: e.target.value })} />
          <button onClick={save}>保存</button>
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
            <div className="skill-actions">
              <button className="ghost" onClick={() => remove(p.id)}>删除</button>
            </div>
          </div>
        ))}
        {providers.length === 0 && <div className="empty-box">暂无 Provider，可先新增 LLM / Image 等商业接口</div>}
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
