import { useEffect, useState } from 'react'
import { deleteAsset, getAssets, renameAsset } from '../api'

interface Asset {
  id: string
  task_id: string
  type: string
  url: string
  name: string
  metadata: Record<string, unknown>
  created_at: string
}

const ASSET_TYPES = ['', 'image', 'video', 'audio', 'file', 'text']

export default function AssetPanel() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [type, setType] = useState('')
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editName, setEditName] = useState('')

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

  const startRename = (a: Asset) => {
    setEditingId(a.id)
    setEditName(a.name || '')
  }

  const doRename = async (id: string) => {
    setMessage('')
    const res = await renameAsset(id, editName.trim())
    if (res.ok) {
      setMessage(`已改名「${editName.trim()}」`)
      setEditingId('')
      await load(type)
    } else {
      setMessage(res.data.error || '改名失败')
    }
  }

  const remove = async (a: Asset) => {
    if (!window.confirm(`删除素材「${a.name || a.id}」？`)) return
    setMessage('')
    const res = await deleteAsset(a.id)
    if (res.ok) {
      setMessage('已删除')
      await load(type)
    } else {
      setMessage(res.data.error || '删除失败')
    }
  }

  return (
    <div className="panel">
      <h2>素材库 Asset</h2>
      {message && <div className="message">{message}</div>}
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
                <b>{a.name || a.type}</b>
                <span className="muted"> · {a.type} · {a.id}</span>
              </div>
              <span className="muted">{a.created_at?.slice(0, 19).replace('T', ' ')}</span>
            </div>
            {a.type === 'image' && a.url ? (
              <img src={a.url} alt={a.name || a.id} className="asset-thumb" loading="lazy" />
            ) : (
              <p className="muted">URL: {a.url || '—'}</p>
            )}
            {a.task_id && <p className="muted">任务: {a.task_id}</p>}

            {editingId === a.id ? (
              <div className="skill-actions">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="输入新名称"
                  style={{ flex: 1, minWidth: 120 }}
                  onKeyDown={(e) => e.key === 'Enter' && doRename(a.id)}
                />
                <button onClick={() => doRename(a.id)}>保存</button>
                <button className="ghost" onClick={() => setEditingId('')}>取消</button>
              </div>
            ) : (
              <div className="skill-actions">
                <button className="ghost" onClick={() => startRename(a)}>改名</button>
                <button className="ghost" onClick={() => remove(a)}>删除</button>
              </div>
            )}
          </div>
        ))}
        {assets.length === 0 && <div className="empty-box">暂无素材（AI 生成结果会沉淀到这里）</div>}
      </div>
    </div>
  )
}
