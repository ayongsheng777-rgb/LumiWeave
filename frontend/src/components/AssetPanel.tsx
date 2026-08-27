import { useEffect, useState } from 'react'
import { deleteAsset, getAssets, getAssetsDir, renameAsset, setAssetsDir } from '../api'
import { FolderOpen, Pencil, Trash2, Maximize2 } from 'lucide-react'

interface Asset {
  id: string
  task_id: string
  type: string
  url: string
  name: string
  file_path?: string
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

  // 素材保存目录（V2.8）：显示当前路径 + 可修改
  const [dir, setDir] = useState('')
  const [dirInput, setDirInput] = useState('')
  const [dirEditing, setDirEditing] = useState(false)
  const [dirBusy, setDirBusy] = useState(false)

  const load = async (t: string) => {
    const [aRes, dRes] = await Promise.all([getAssets(t || undefined), getAssetsDir()])
    if (aRes.ok) setAssets(aRes.data.assets || [])
    if (dRes.ok) {
      setDir(String(dRes.data.dir || ''))
      setDirInput(String(dRes.data.dir || ''))
    }
  }

  useEffect(() => {
    load('')
  }, [])

  const changeType = (t: string) => {
    setType(t)
    load(t)
  }

  const saveDir = async () => {
    const d = dirInput.trim()
    if (!d || dirBusy) return
    setDirBusy(true)
    setMessage('')
    const res = await setAssetsDir(d)
    setDirBusy(false)
    if (res.ok) {
      setDir(String(res.data.dir || d))
      setDirInput(String(res.data.dir || d))
      setDirEditing(false)
      setMessage(`素材保存目录已更新：${res.data.dir}`)
    } else {
      setMessage(res.data.error || '设置失败')
    }
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

  const previewUrl = (a: Asset) => (a.url?.startsWith('/') ? a.url : a.url)

  return (
    <div className="panel">
      <h2>素材库 Asset</h2>
      {message && <div className="message">{message}</div>}

      {/* 素材保存路径：显示 + 可配置（V2.8） */}
      <div className="rounded-lg border border-edge bg-panel-2 p-3" style={{ marginBottom: 12 }}>
        <div className="flex items-center gap-2">
          <FolderOpen size={14} className="shrink-0 text-ink-3" />
          <span className="text-[11px] text-ink-2">素材保存路径</span>
          {dirEditing ? (
            <>
              <input
                type="text"
                value={dirInput}
                onChange={(e) => setDirInput(e.target.value)}
                placeholder="输入本地目录，如 D:\WorkBuddy\lumi-assets"
                style={{ flex: 1, minWidth: 160, fontFamily: 'ui-monospace, monospace' }}
                onKeyDown={(e) => e.key === 'Enter' && saveDir()}
              />
              <button onClick={() => void saveDir()} disabled={dirBusy}>{dirBusy ? '保存中…' : '保存'}</button>
              <button className="ghost" onClick={() => { setDirEditing(false); setDirInput(dir) }}>取消</button>
            </>
          ) : (
            <>
              <code style={{ flex: 1, fontSize: 12, color: 'var(--lw-ink-2)', wordBreak: 'break-all' }}>{dir || '—'}</code>
              <button className="ghost" onClick={() => setDirEditing(true)}>修改</button>
            </>
          )}
        </div>
        <div className="notice" style={{ marginTop: 8 }}>
          本地素材（上传/生成/视频抽帧）会保存到该目录；云端外链素材只记录 URL 不落盘。修改后新素材写入新目录。
        </div>
      </div>

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

            {/* 素材预览（V2.8）：图片缩略图可点击放大 / 视频 / 音频 / 文件 */}
            {a.type === 'image' && a.url ? (
              <div className="relative inline-block">
                <img
                  src={previewUrl(a)}
                  alt={a.name || a.id}
                  className="asset-thumb"
                  style={{ cursor: 'zoom-in' }}
                  loading="lazy"
                  onClick={() => window.open(previewUrl(a), '_blank')}
                />
                <span className="absolute right-1 top-1 rounded bg-black/50 p-1 text-white" title="点击放大">
                  <Maximize2 size={11} />
                </span>
              </div>
            ) : a.type === 'video' && a.url ? (
              <video src={previewUrl(a)} controls className="asset-thumb" style={{ background: '#000' }} preload="metadata" />
            ) : a.type === 'audio' && a.url ? (
              <audio src={previewUrl(a)} controls className="w-full" style={{ margin: '6px 0' }} preload="metadata" />
            ) : (
              <p className="muted" style={{ wordBreak: 'break-all' }}>URL: {a.url || '—'}</p>
            )}

            {/* 本地保存路径 */}
            {a.file_path && (
              <p className="muted" style={{ wordBreak: 'break-all' }} title="本地磁盘路径">
                路径: {a.file_path}
              </p>
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
                <button className="ghost" onClick={() => startRename(a)}><Pencil size={12} /> 改名</button>
                <button className="ghost" onClick={() => remove(a)}><Trash2 size={12} /> 删除</button>
              </div>
            )}
          </div>
        ))}
        {assets.length === 0 && <div className="empty-box">暂无素材（AI 生成结果会沉淀到这里）</div>}
      </div>
    </div>
  )
}
