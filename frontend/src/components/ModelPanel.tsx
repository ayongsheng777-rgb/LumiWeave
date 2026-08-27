import { useEffect, useState } from 'react'
import { autoBest, deleteModel, getAiStats, getProfiles, listPlatformModels, probe, upsertModel } from '../api'
import { Plus, Trash2, Pencil, Zap, Gauge, ListPlus } from 'lucide-react'
import { PLATFORM_PRESETS } from '../platformPresets'

interface Profile {
  id: string
  name: string
  model: string
  base_url: string
  api_key: string
  proxy: string
  provider: string
  description: string
  scenario: string
  scenes?: string[]
}

const inputCls =
  'w-full rounded-lg border border-edge bg-input px-2.5 py-1.5 text-sm text-ink outline-none transition focus:border-brand-500 placeholder:text-ink-3'

const EMPTY_FORM = { id: '', name: '', model: '', base_url: '', api_key: '', proxy: '', description: '', scenario: 'general', scenes: [] as string[] }

/** 适用场景分类（多选）：节点生成时按场景过滤可调用的模型 */
const SCENES: { key: string; label: string }[] = [
  { key: 'prompt', label: '提示词生成' },
  { key: 'image', label: '图片生成' },
  { key: 'video', label: '视频生成' },
  { key: 'audio', label: '音频生成' },
  { key: 'kb', label: '知识库' },
  { key: 'skills', label: '技能库' },
  { key: 'general', label: '通用' },
]

export default function ModelPanel() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [active, setActive] = useState('')
  const [stats, setStats] = useState<Record<string, number | string>>({})
  const [form, setForm] = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [platformModels, setPlatformModels] = useState<string[]>([])
  const [showModels, setShowModels] = useState(false)

  const load = async () => {
    const pRes = await getProfiles()
    if (pRes.ok) {
      setProfiles(pRes.data.profiles || [])
      setActive(pRes.data.active || '')
    }
    const sRes = await getAiStats()
    if (sRes.ok) setStats(sRes.data || {})
  }

  useEffect(() => {
    load()
  }, [])

  const applyPreset = (key: string) => {
    const p = PLATFORM_PRESETS.find((x) => x.key === key)
    if (!p) return
    // 一键匹配：平台预设自动填好地址/模型 + 默认适用场景；没有对应的留空
    setForm((f) => ({ ...f, id: p.key, name: p.name, model: p.model, base_url: p.baseUrl, scenes: p.scenes || [] }))
  }

  const save = async () => {
    if (!form.id.trim() || !form.model.trim()) {
      setMessage('ID 和模型名必填')
      return
    }
    setBusy(true)
    setMessage('')
    const res = await upsertModel(form)
    setBusy(false)
    if (res.ok) {
      setMessage(`已保存 ${form.id}（key ${form.api_key ? '已更新' : '未改动'}）`)
      setShowForm(false)
      setForm(EMPTY_FORM)
      setEditing(false)
      load()
    } else {
      setMessage(res.data.error || '保存失败')
    }
  }

  const edit = (p: Profile) => {
    setForm({
      id: p.id, name: p.name, model: p.model, base_url: p.base_url, api_key: p.api_key,
      proxy: p.proxy, description: p.description || '', scenario: p.scenario || 'general',
      scenes: Array.isArray(p.scenes) ? p.scenes : [],
    })
    setEditing(true)
    setShowForm(true)
    setMessage('')
  }

  const remove = async (id: string) => {
    if (!window.confirm(`删除模型「${id}」？`)) return
    const res = await deleteModel(id)
    if (res.ok) load()
    else setMessage(res.data.error || '删除失败')
  }

  const handleProbe = async (id: string) => {
    setBusy(true)
    setMessage('')
    const res = await probe(id)
    setBusy(false)
    if (res.ok && res.data.ok) setMessage(`连通正常：${res.data.model}，延迟 ${res.data.latency_ms}ms`)
    else setMessage(`连通失败：${res.data.reason || res.data.error || '未知'}`)
  }

  const handleAutoBest = async (id?: string) => {
    setBusy(true)
    setMessage('')
    const res = await autoBest(id)
    setBusy(false)
    if (res.ok) {
      setMessage(`自动优选完成：${res.data.model}（已生效）`)
      load()
    } else {
      setMessage(`自动优选失败：${res.data.reason || res.data.error || '未知'}`)
    }
  }

  const handleFetchModels = async () => {
    setBusy(true)
    setMessage('')
    const res = await listPlatformModels(form.id || undefined)
    setBusy(false)
    if (res.ok && res.data.models) {
      setPlatformModels(res.data.models)
      setShowModels(true)
      setMessage(`已获取 ${res.data.count} 个可用模型，点击填入模型名`)
    } else {
      setPlatformModels([])
      setShowModels(false)
      setMessage(res.data.error || '获取失败（请先填好 Base URL 和 Key）')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">模型配置</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-500"
        >
          <Plus size={14} /> {editing ? '编辑中…' : '添加模型'}
        </button>
      </div>

      {message && (
        <div className="rounded-lg border border-edge bg-soft px-3 py-2 text-sm text-ink-2">{message}</div>
      )}

      {/* 新增/编辑表单 */}
      {showForm && (
        <div className="rounded-xl border border-brand-500/30 bg-panel-2 p-4">
          <h3 className="mb-3 text-sm font-medium text-ink">{editing ? `编辑模型 ${form.id}` : '新增模型'}</h3>
          <div className="mb-3 rounded-lg border border-edge bg-soft px-3 py-2">
            <span className="mb-1 block text-[11px] text-ink-2">快速选择平台（自动填好地址和模型，你只需填 API Key）</span>
            <select
              className={inputCls}
              value=""
              onChange={(e) => applyPreset(e.target.value)}
            >
              <option value="" disabled>选择平台预设…</option>
              {PLATFORM_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{p.name}{p.note ? `（${p.note}）` : ''}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-2">ID（唯一，default 可改默认模型）</span>
              <input className={inputCls} value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="deepseek / default" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-2">名称</span>
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="DeepSeek" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-2">模型名</span>
              <div className="flex gap-1.5">
                <input className={inputCls} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="deepseek-chat" />
                <button type="button" onClick={handleFetchModels} disabled={busy} className="flex shrink-0 items-center gap-1 rounded-lg border border-edge px-2.5 text-[11px] text-ink-2 transition hover:bg-soft" title="从平台拉取可用模型列表">
                  <ListPlus size={13} /> 拉取
                </button>
              </div>
            </label>
            {showModels && (
              <div className="col-span-2 max-h-40 overflow-y-auto rounded-lg border border-edge bg-input p-2">
                {platformModels.length === 0 ? (
                  <div className="text-[11px] text-ink-3">未获取到模型</div>
                ) : (
                  platformModels.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setForm((f) => ({ ...f, model: m })); setMessage(`已填入模型 ${m}`) }}
                      className={`block w-full truncate rounded px-2 py-1 text-left text-[11px] transition hover:bg-soft ${form.model === m ? 'text-brand-300' : 'text-ink-2'}`}
                    >
                      {m}
                    </button>
                  ))
                )}
              </div>
            )}
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-2">Base URL</span>
              <input className={inputCls} value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.deepseek.com/v1" />
            </label>
            <label className="col-span-2 block">
              <span className="mb-1 block text-[11px] text-ink-2">API Key（留空/**** 表示不改动）</span>
              <input className={inputCls} type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="sk-..." />
            </label>
            <label className="col-span-2 block">
              <span className="mb-1 block text-[11px] text-ink-2">代理（可选）</span>
              <input className={inputCls} value={form.proxy} onChange={(e) => setForm({ ...form, proxy: e.target.value })} placeholder="http://127.0.0.1:1080" />
            </label>
            <label className="col-span-2 block">
              <span className="mb-1 block text-[11px] text-ink-2">说明（这个模型是干什么的）</span>
              <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="例如：通用中文对话，性价比高" />
            </label>
            <label className="col-span-2 block">
              <span className="mb-1 block text-[11px] text-ink-2">
                适用场景（多选，节点生成时按场景匹配可调用模型；不选=通用）
              </span>
              <div className="flex flex-wrap gap-1.5">
                {SCENES.map((s) => {
                  const on = form.scenes.includes(s.key)
                  return (
                    <label
                      key={s.key}
                      className={`nodrag flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition ${
                        on ? 'border-brand-500 bg-brand-500/15 text-brand-300' : 'border-edge bg-soft text-ink-2 hover:text-ink'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="nodrag accent-brand-500"
                        checked={on}
                        onChange={() => {
                          const next = on ? form.scenes.filter((k) => k !== s.key) : [...form.scenes, s.key]
                          setForm({ ...form, scenes: next })
                        }}
                      />
                      {s.label}
                    </label>
                  )
                })}
              </div>
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={save} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-brand-500 disabled:opacity-40">
              保存
            </button>
            <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setEditing(false) }} className="rounded-lg border border-edge px-4 py-1.5 text-xs text-ink-2 transition hover:bg-soft">
              取消
            </button>
          </div>
        </div>
      )}

      {/* 统计 */}
      <div className="grid grid-cols-6 gap-2">
        {[
          ['总调用', stats.calls], ['成功', stats.ok], ['失败', stats.fail], ['缓存', stats.cached],
          ['输入Token', stats.prompt_tokens], ['输出Token', stats.completion_tokens],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-edge bg-panel-2 px-3 py-2">
            <div className="text-[11px] text-ink-3">{k}</div>
            <div className="text-lg font-semibold text-ink">{String(v ?? 0)}</div>
          </div>
        ))}
      </div>

      {/* 模型列表 */}
      <div className="space-y-2">
        {profiles.map((p) => (
          <div key={p.id} className={`rounded-xl border p-3 ${p.id === active ? 'border-brand-500/40 bg-brand-500/5' : 'border-edge bg-panel-2'}`}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">{p.name}</span>
              {p.id === active && <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] text-white">生效中</span>}
              <span className="text-[11px] text-ink-3">{p.id} · {p.provider}</span>
              <div className="ml-auto flex gap-1.5">
                <button onClick={() => handleProbe(p.id)} disabled={busy} className="flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-[11px] text-ink-2 transition hover:bg-soft" title="连通测试">
                  <Gauge size={12} /> 测试
                </button>
                <button onClick={() => handleAutoBest(p.id)} disabled={busy} className="flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-[11px] text-ink-2 transition hover:bg-soft" title="自动优选">
                  <Zap size={12} /> 优选
                </button>
                <button onClick={() => edit(p)} className="rounded-md border border-edge p-1 text-ink-2 transition hover:bg-soft" title="编辑">
                  <Pencil size={12} />
                </button>
                <button onClick={() => remove(p.id)} className="rounded-md border border-edge p-1 text-ink-2 transition hover:bg-soft hover:text-red-400" title="删除">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-ink-2">
              <span>模型：{p.model}</span>
              <span>地址：{p.base_url || '—'}</span>
              <span>Key：{p.api_key || '未配置'}</span>
              <span className="flex items-center gap-1">
                场景：
                {(Array.isArray(p.scenes) && p.scenes.length ? p.scenes : ['general']).map((k) => (
                  <span key={k} className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-2">
                    {SCENES.find((s) => s.key === k)?.label || k}
                  </span>
                ))}
              </span>
            </div>
            {p.description && <div className="mt-1 text-[11px] text-ink-3">说明：{p.description}</div>}
          </div>
        ))}
        {profiles.length === 0 && (
          <div className="rounded-lg border border-edge bg-panel-2 p-4 text-center text-sm text-ink-3">
            暂无模型，点右上角「添加模型」配置你的 LLM（含 API Key）
          </div>
        )}
      </div>
    </div>
  )
}
