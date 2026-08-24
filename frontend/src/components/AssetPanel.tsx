import { useEffect, useState } from 'react'
import { getAssets } from '../api'

interface Asset {
  id: string
  task_id: string
  type: string
  url: string
  metadata: Record<string, unknown>
  created_at: string
}

const ASSET_TYPES = ['', 'image', 'video', 'audio', 'file', 'text']

export default function AssetPanel() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [type, setType] = useState('')

  const load = async (t: string) => {
    const res = await getAssets(t || undefined)
    if (res.ok) setAssets(res.data.assets || [])
  }

  useEffect(() => {
    load('')
  }, [])

  const changeType = (t: string) => {
    setType(t)
    load(t)
  }

  return (
    <div className="panel">
      <h2>素材库 Asset</h2>
      <div className="skill-actions" style={{ marginBottom: 12 }}>
        {ASSET_TYPES.map((t) => (
          <button key={t || 'all'} className={type === t ? '' : 'ghost'} onClick={() => changeType(t)}>
            {t || '全部'}
          </button>
        ))}
      </div>

      <div className="renderer-list">
        {assets.map((a) => (
          <div key={a.id} className="renderer-card">
            <div className="renderer-head">
              <div>
                <b>{a.type}</b>
                <span className="muted"> · {a.id}</span>
              </div>
              <span className="muted">{a.created_at?.slice(0, 19).replace('T', ' ')}</span>
            </div>
            {a.type === 'image' && a.url ? (
              <img src={a.url} alt={a.id} className="asset-thumb" loading="lazy" />
            ) : (
              <p className="muted">URL: {a.url || '—'}</p>
            )}
            {a.task_id && <p className="muted">任务: {a.task_id}</p>}
          </div>
        ))}
        {assets.length === 0 && <div className="empty-box">暂无素材（AI 生成结果会沉淀到这里）</div>}
      </div>
    </div>
  )
}
