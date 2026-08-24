import { useEffect, useState } from 'react'
import { autoBest, getAiStats, getProfiles, probe } from '../api'

interface Profile {
  id: string
  name: string
  model: string
  base_url: string
  api_key: string
  proxy: string
  user_agent: string
  provider: string
  tags: string[]
}

export default function ModelPanel() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [active, setActive] = useState('')
  const [stats, setStats] = useState<Record<string, number | string>>({})
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [autoBestResult, setAutoBestResult] = useState<any>(null)

  const load = async () => {
    const pRes = await getProfiles()
    if (pRes.ok) {
      setProfiles(pRes.data.profiles)
      setActive(pRes.data.active)
    }
    const sRes = await getAiStats()
    if (sRes.ok) setStats(sRes.data)
  }

  useEffect(() => {
    load()
  }, [])

  const handleProbe = async (id: string) => {
    setLoading(true)
    setMessage('')
    const res = await probe(id)
    setLoading(false)
    if (res.ok && res.data.ok) {
      setMessage(`连通正常：${res.data.model}，延迟 ${res.data.latency_ms}ms`)
    } else {
      setMessage(`连通失败：${res.data.reason || res.data.error || '未知'}`)
    }
  }

  const handleAutoBest = async (id?: string) => {
    setLoading(true)
    setMessage('')
    setAutoBestResult(null)
    const res = await autoBest(id)
    setLoading(false)
    if (res.ok) {
      setAutoBestResult(res.data)
      setMessage(`自动优选完成：${res.data.model}，延迟 ${res.data.latency_ms}ms（已自动生效）`)
      await load()
    } else {
      setMessage(`自动优选失败：${res.data.reason || res.data.error || '未知'}`)
      setAutoBestResult(res.data)
    }
  }

  return (
    <div className="panel">
      <h2>模型配置面板</h2>
      {message && <div className="message">{message}</div>}
      <div className="stats-row">
        <div className="stat-card"><b>总调用</b><span>{stats.calls ?? 0}</span></div>
        <div className="stat-card"><b>成功</b><span>{stats.ok ?? 0}</span></div>
        <div className="stat-card"><b>失败</b><span>{stats.fail ?? 0}</span></div>
        <div className="stat-card"><b>缓存命中</b><span>{stats.cached ?? 0}</span></div>
        <div className="stat-card"><b>输入 Token</b><span>{stats.prompt_tokens ?? 0}</span></div>
        <div className="stat-card"><b>输出 Token</b><span>{stats.completion_tokens ?? 0}</span></div>
      </div>

      <div className="model-list">
        {profiles.map((p) => (
          <div key={p.id} className={`model-card ${p.id === active ? 'active-card' : ''}`}>
            <div className="model-header">
              <h3>{p.name}</h3>
              <span className="badge">{p.id === active ? '生效中' : p.id}</span>
            </div>
            <div className="model-body">
              <p><b>模型：</b>{p.model}</p>
              <p><b>渠道：</b>{p.provider}</p>
              <p><b>地址：</b>{p.base_url}</p>
              <p><b>Key：</b>{p.api_key || '未配置'}</p>
              {p.proxy && <p><b>代理：</b>{p.proxy}</p>}
              {p.user_agent && <p><b>UA：</b>{p.user_agent}</p>}
              <p className="tags">{p.tags.map((t) => <span key={t} className="tag">{t}</span>)}</p>
            </div>
            <div className="model-actions">
              <button onClick={() => handleProbe(p.id)} disabled={loading}>连通测试</button>
              <button onClick={() => handleAutoBest(p.id)} disabled={loading}>自动优选</button>
            </div>
          </div>
        ))}
      </div>

      {autoBestResult && autoBestResult.tested && (
        <div className="autobest-detail">
          <h4>自动优选实测明细</h4>
          <div className="tested-list">
            {autoBestResult.tested.map((t: any) => (
              <span
                key={t.model}
                className={`tested-tag ${t.success ? 'ok' : 'fail'}`}
                title={t.error || `${t.latency_ms}ms`}
              >
                {t.model} {t.success ? `${t.latency_ms}ms` : '×'}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="notice">
        <p>说明：模型库通过环境变量 AI_MODELS_JSON 配置；默认模型来自 AI_BASE_URL / AI_API_KEY / AI_MODEL。</p>
      </div>
    </div>
  )
}
