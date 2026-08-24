import { useEffect, useState } from 'react'
import { getRendererHealth, getRenderers, rendererCancel, rendererGenerate } from '../api'

interface Renderer {
  id: string
  name: string
  type: string
  enabled: boolean
  endpoint: string
}

interface RenderImage {
  filename: string
  subfolder: string
  type: string
}

export default function RendererPanel() {
  const [renderers, setRenderers] = useState<Renderer[]>([])
  const [health, setHealth] = useState<Record<string, boolean | null>>({})
  const [workflow, setWorkflow] = useState('')
  const [result, setResult] = useState<{ ok: boolean; prompt_id?: string; images?: RenderImage[]; error?: string } | null>(null)
  const [lastRendererId, setLastRendererId] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    const res = await getRenderers()
    if (res.ok) {
      setRenderers(res.data.renderers || [])
      res.data.renderers?.forEach(async (r: Renderer) => {
        const h = await getRendererHealth(r.id)
        if (h.ok) setHealth((prev) => ({ ...prev, [r.id]: h.data.healthy }))
      })
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleGenerate = async (r: Renderer) => {
    setMessage('')
    setResult(null)
    let wf: Record<string, unknown>
    try {
      wf = JSON.parse(workflow || '{}')
    } catch {
      setMessage('工作流 JSON 格式错误，请检查后重试')
      return
    }
    setLastRendererId(r.id)
    setLoading(true)
    const res = await rendererGenerate(r.id, wf)
    setLoading(false)
    if (res.ok) {
      setResult(res.data)
      if (res.data.ok) {
        setMessage(`渲染完成：${res.data.images?.length ?? 0} 张图片，prompt_id=${res.data.prompt_id}`)
      } else {
        setMessage(`渲染失败：${res.data.error || '未知'}`)
      }
    } else {
      setMessage(res.data.error || '请求失败')
    }
  }

  const handleCancel = async () => {
    if (!lastRendererId) return
    const res = await rendererCancel(lastRendererId, result?.prompt_id || '')
    setMessage(res.ok ? '已发送取消指令' : '取消失败')
  }

  const imageUrl = (r: Renderer, img: RenderImage) => {
    const base = (r.endpoint || '').replace(/\/+$/, '')
    if (!base) return ''
    const params = new URLSearchParams({
      filename: img.filename,
      subfolder: img.subfolder || '',
      type: img.type || 'output',
    })
    return `${base}/view?${params.toString()}`
  }

  const enabledRenderers = renderers.filter((r) => r.enabled)
  const activeRenderer = renderers.find((r) => r.id === lastRendererId)

  return (
    <div className="panel">
      <h2>渲染器（出图）</h2>
      {message && <div className="message">{message}</div>}

      <div className="renderer-list">
        {renderers.map((r) => (
          <div key={r.id} className="renderer-card">
            <div className="renderer-head">
              <div>
                <b>{r.name}</b>
                <span className="muted"> · {r.type} · {r.id}</span>
              </div>
              <span className={`badge ${r.enabled ? 'on' : 'off'}`}>{r.enabled ? '启用' : '停用'}</span>
            </div>
            <p className="muted">端点: {r.endpoint || '未配置'}</p>
            <p>
              健康状态:{' '}
              {health[r.id] === null || health[r.id] === undefined ? (
                <span className="tag">检测中</span>
              ) : health[r.id] ? (
                <span className="tag ok-tag">正常</span>
              ) : (
                <span className="tag bad-tag">不可用</span>
              )}
            </p>
          </div>
        ))}
        {renderers.length === 0 && <div className="empty-box">暂无渲染器（需在数据库中注册 ComfyUI 实例）</div>}
      </div>

      {enabledRenderers.length > 0 && (
        <div className="render-box">
          <h3>提交工作流</h3>
          <textarea
            className="workflow-input"
            value={workflow}
            onChange={(e) => setWorkflow(e.target.value)}
            placeholder={'粘贴 ComfyUI 工作流 JSON，例如：\n{"3": {"class_type": "KSampler", ...}}'}
            rows={10}
          />
          <div className="skill-actions">
            {enabledRenderers.map((r) => (
              <button key={r.id} onClick={() => handleGenerate(r)} disabled={loading || !workflow.trim()}>
                {loading && lastRendererId === r.id ? '渲染中…' : `提交到 ${r.name}`}
              </button>
            ))}
            {result?.prompt_id && (
              <button onClick={handleCancel} className="ghost">
                取消
              </button>
            )}
          </div>
        </div>
      )}

      {result?.images && result.images.length > 0 && (
        <div className="render-result">
          <h3>渲染结果（{result.images.length}）</h3>
          <div className="image-grid">
            {result.images.map((img, i) => {
              const url = activeRenderer ? imageUrl(activeRenderer, img) : ''
              return (
                <div key={i} className="image-card">
                  {url ? <img src={url} alt={img.filename} loading="lazy" /> : <div className="img-placeholder" />}
                  <p className="muted">{img.filename}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
