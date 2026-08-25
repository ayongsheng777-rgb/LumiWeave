import { useEffect, useState } from 'react'
import { deleteRenderer, getRendererHealth, getRenderers, upsertRenderer } from '../api'
import { Plus, Trash2, Pencil } from 'lucide-react'

interface Renderer {
  id: string
  name: string
  type: string
  endpoint: string
  api_key: string
  client_id: string
  enabled: boolean
  timeout: number
  has_api_key?: boolean
}

const inputCls =
  'w-full rounded-lg border border-edge bg-input px-2.5 py-1.5 text-sm text-ink outline-none transition focus:border-brand-500 placeholder:text-ink-3'

const EMPTY_FORM = { id: '', name: '', type: 'comfyui', endpoint: '', api_key: '', client_id: '', enabled: true, timeout: 600 }

export default function RendererPanel() {
  const [renderers, setRenderers] = useState<Renderer[]>([])
  const [health, setHealth] = useState<Record<string, Record<string, unknown> | null>>({})
  const [form, setForm] = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const res = await getRenderers()
    if (res.ok) setRenderers(res.data.renderers || [])
  }

  const loadHealth = async () => {
    const h: Record<string, Record<string, unknown> | null> = {}
    for (const r of renderers) {
      const res = await getRendererHealth(r.id)
      h[r.id] = res.ok ? res.data : null
    }
    setHealth(h)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (renderers.length) loadHealth()
  }, [renderers])

  const save = async () => {
    if (!form.id.trim()) {
      setMessage('ID 不能为空')
      return
    }
    setBusy(true)
    setMessage('')
    const res = await upsertRenderer({
      ...form,
      timeout: Number(form.timeout) || 600,
      enabled: Boolean(form.enabled),
    })
    setBusy(false)
    if (res.ok) {
      setMessage(`已保存渲染器 ${form.id}，并已重载生效`)
      setShowForm(false)
      setForm(EMPTY_FORM)
      setEditing(false)
      load()
    } else {
      setMessage(res.data.error || '保存失败')
    }
  }

  const edit = (r: Renderer) => {
    setForm({
      id: r.id, name: r.name, type: r.type, endpoint: r.endpoint,
      api_key: r.api_key || '', client_id: r.client_id || '',
      enabled: r.enabled, timeout: r.timeout || 600,
    })
    setEditing(true)
    setShowForm(true)
    setMessage('')
  }

  const remove = async (id: string) => {
    if (!window.confirm(`删除渲染器「${id}」？`)) return
    const res = await deleteRenderer(id)
    if (res.ok) load()
    else setMessage(res.data.error || '删除失败')
  }

  const healthBadge = (r: Renderer) => {
    const h = health[r.id]
    if (h === null || h === undefined) return <span className="text-[11px] text-ink-3">检测中…</span>
    if (h.healthy) return <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-400">正常 {String(h.latency_ms ?? '')}ms</span>
    return <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-400">不可用</span>
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">出图 / 视频 配置</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-500"
        >
          <Plus size={14} /> {editing ? '编辑中…' : '添加渲染器'}
        </button>
      </div>

      {message && (
        <div className="rounded-lg border border-edge bg-soft px-3 py-2 text-sm text-ink-2">{message}</div>
      )}

      {showForm && (
        <div className="rounded-xl border border-brand-500/30 bg-panel-2 p-4">
          <h3 className="mb-3 text-sm font-medium text-ink">{editing ? `编辑渲染器 ${form.id}` : '新增渲染器'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-2">ID（comfy-local / comfy-cloud）</span>
              <input className={inputCls} value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="comfy-local" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-2">名称</span>
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="本地 ComfyUI" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-2">类型</span>
              <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="comfyui">comfyui</option>
                <option value="image-api">image-api</option>
                <option value="video-api">video-api</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-2">超时（秒）</span>
              <input className={inputCls} type="number" value={form.timeout} onChange={(e) => setForm({ ...form, timeout: Number(e.target.value) })} />
            </label>
            <label className="col-span-2 block">
              <span className="mb-1 block text-[11px] text-ink-2">{form.type === 'video-api' ? '视频 API 端点 URL' : 'ComfyUI 端点 URL'}</span>
              <input className={inputCls} value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} placeholder={form.type === 'video-api' ? '如 https://api.minimax.chat 或 https://api.klingai.com 或 https://api.siliconflow.cn' : 'http://127.0.0.1:8188 或 http://comfyui:8188'} />
            </label>
            {form.type === 'video-api' && (
              <div className="col-span-2 rounded-lg border border-edge bg-soft px-3 py-2 text-[11px] text-ink-2">
                视频 API 会自动识别服务商：MiniMax H3（api.minimax.chat）、可灵（api.klingai.com）、硅基流动（api.siliconflow.cn）、其它走 OpenAI 兼容。填对应 endpoint + API Key 即可。
              </div>
            )}
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-2">API Key（留空/**** 表示不改动）</span>
              <input className={inputCls} type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="通常本地无认证" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-2">Client ID（可选）</span>
              <input className={inputCls} value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} placeholder="留空自动生成" />
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 accent-brand-600" />
              启用此渲染器（启用后才会参与出图调度）
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={save} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-brand-500 disabled:opacity-40">
              保存并重载
            </button>
            <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setEditing(false) }} className="rounded-lg border border-edge px-4 py-1.5 text-xs text-ink-2 transition hover:bg-soft">
              取消
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {renderers.map((r) => (
          <div key={r.id} className="rounded-xl border border-edge bg-panel-2 p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">{r.name}</span>
              <span className="text-[11px] text-ink-3">{r.type} · {r.id}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${r.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-soft text-ink-3'}`}>
                {r.enabled ? '启用' : '停用'}
              </span>
              {healthBadge(r)}
              <div className="ml-auto flex gap-1.5">
                <button onClick={() => edit(r)} className="rounded-md border border-edge p-1 text-ink-2 transition hover:bg-soft" title="编辑">
                  <Pencil size={12} />
                </button>
                <button onClick={() => remove(r.id)} className="rounded-md border border-edge p-1 text-ink-2 transition hover:bg-soft hover:text-red-400" title="删除">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            <div className="mt-1.5 text-[11px] text-ink-2">
              端点：{r.endpoint || '未配置'} · Key：{r.has_api_key ? '已配置' : '未配置'}
            </div>
            {health[r.id] && health[r.id]!.reason != null && (
              <div className="mt-1 text-[11px] text-ink-3">原因：{String(health[r.id]!.reason)}</div>
            )}
          </div>
        ))}
        {renderers.length === 0 && (
          <div className="rounded-lg border border-edge bg-panel-2 p-4 text-center text-sm text-ink-3">
            暂无渲染器，点右上角「添加渲染器」配置你的 ComfyUI 实例（含端点地址）
          </div>
        )}
      </div>
    </div>
  )
}
