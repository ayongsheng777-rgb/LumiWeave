import { useEffect, useState } from 'react'
import { Server, Plus, Trash2, Edit2 } from 'lucide-react'
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

// 输入框公共样式：圆润 rounded-xl + 半透明白底 + 紫色聚焦环（V2.4 亮色毛玻璃规范）
const inputBaseCls = "w-full rounded-xl border border-black/5 bg-white/60 px-4 py-2.5 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:bg-white focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"

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
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">

      {/* 标题与说明 */}
      <div>
        <h2 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
          <Server className="text-violet-500" />
          商业接口 Provider
        </h2>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed bg-blue-50/50 p-3 rounded-xl border border-blue-100/50">
          <strong className="text-blue-700">什么是 Provider：</strong>「外面 AI 服务」的统一插头，把对话/图片/视频/语音等能力标准化。
          推荐起步三件套：<b>llm→DeepSeek</b>、<b>image→硅基流动 FLUX</b>、<b>video→MiniMax H3/可灵</b>。
          API Key 只显示 ****，不泄露明文。
        </p>
      </div>

      {message && <div className="p-3 rounded-xl bg-violet-50 text-violet-600 text-sm border border-violet-100">{message}</div>}

      {/* 新增/编辑表单区：微凸起卡片 */}
      <div className="bg-slate-50/40 border border-black/5 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <h3 className="text-lg font-semibold text-slate-800">
            {editing ? `编辑接口: ${form.id}` : '新增接口配置'}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">快速平台预设：</span>
            <select className={`${inputBaseCls} !w-56 !py-1.5 !text-xs`} value="" onChange={(e) => applyPreset(e.target.value)}>
              <option value="" disabled>选择预设...</option>
              {PLATFORM_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{p.name}{p.note ? `（${p.note}）` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5">
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-500 ml-1">ID (唯一标识)</span>
            <input className={inputBaseCls} placeholder="如 deepseek-chat" value={form.id} disabled={editing} onChange={(e) => setForm({ ...form, id: e.target.value })} />
          </label>
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-500 ml-1">显示名称</span>
            <input className={inputBaseCls} placeholder="如 DeepSeek 对话" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>

          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-500 ml-1">接口类型</span>
            <select className={inputBaseCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-500 ml-1">端点 URL</span>
            <input className={inputBaseCls} placeholder="https://api.deepseek.com/v1" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
          </label>

          <label className="col-span-2 space-y-1.5 block">
            <span className="text-xs font-medium text-slate-500 ml-1">API Key (暗号)</span>
            <input className={inputBaseCls} placeholder="sk-..." type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
          </label>

          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-500 ml-1">状态</span>
            <select className={inputBaseCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="enabled">启用</option>
              <option value="disabled">停用</option>
            </select>
          </label>
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-500 ml-1">成本率（0~100，越小越优先）</span>
            <input className={inputBaseCls} placeholder="0" value={form.cost_rate} onChange={(e) => setForm({ ...form, cost_rate: e.target.value })} />
          </label>

          <label className="col-span-2 space-y-1.5 block">
            <span className="text-xs font-medium text-slate-500 ml-1">模型列表（逗号分隔，可选）</span>
            <input className={inputBaseCls} placeholder="如 deepseek-chat, deepseek-reasoner" value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} />
          </label>

          {/* 复用已配置模型 / 自动获取平台模型 */}
          <div className="col-span-2 space-y-2">
            <span className="text-xs font-medium text-slate-500 ml-1">复用已配置模型 / 自动获取平台模型</span>
            <div className="flex items-center gap-2 flex-wrap">
              {configuredModels.length > 0 && (
                <select
                  className={`${inputBaseCls} !w-auto min-w-[220px] flex-1`}
                  value=""
                  onChange={(e) => {
                    const m = configuredModels.find((x) => x.id === e.target.value)
                    if (m) reuseModel(m)
                  }}
                >
                  <option value="" disabled>复用已配置的模型…</option>
                  {configuredModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}（{m.model}）</option>
                  ))}
                </select>
              )}
              <button onClick={handleFetchModels} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 bg-white/60 border border-black/5 hover:bg-black/5 transition-all active:scale-95">
                自动获取可用模型
              </button>
            </div>
            {platformModels.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-xl border border-black/5 bg-white/60 p-2">
                {platformModels.map((m) => (
                  <button
                    key={m}
                    onClick={() => setForm((f) => ({ ...f, models: f.models ? `${f.models}, ${m}` : m }))}
                    className="block w-full truncate rounded-lg px-3 py-1.5 text-left text-xs text-slate-600 transition hover:bg-violet-50 hover:text-violet-600"
                  >
                    ＋ {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3 pt-5 border-t border-black/5">
          <button onClick={save} className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-2.5 rounded-xl text-sm font-medium shadow-md shadow-violet-500/20 transition-all flex items-center gap-2 active:scale-95">
            <Plus size={16} /> 保存配置
          </button>
          {editing && (
            <button onClick={() => { setForm(EMPTY_FORM); setEditing(false) }} className="px-6 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-black/5 transition-all">
              取消
            </button>
          )}
        </div>
      </div>

      {/* 已配置列表区 */}
      <div>
        <h3 className="text-lg font-semibold text-slate-800 mb-4">已启用的接口 ({providers.length})</h3>
        {providers.length === 0 ? (
          <div className="py-12 text-center text-slate-400 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
            暂无配置，请在上方添加您的 API 接口
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {providers.map((p) => (
              <div key={p.id} className="group relative bg-white border border-black/5 shadow-sm hover:shadow-md rounded-2xl p-5 transition-all">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h4 className="text-base font-bold text-slate-800">{p.name || p.id}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">{p.id}</p>
                  </div>
                  <span className={`px-2.5 py-1 text-[10px] font-bold rounded-full ${p.status === 'enabled' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {p.status === 'enabled' ? 'Active' : 'Disabled'}
                  </span>
                </div>

                <div className="space-y-1.5 mb-4">
                  <div className="text-xs text-slate-500 flex items-center gap-2">
                    <span className="w-12 text-slate-400 shrink-0">类型:</span>
                    <span className="bg-slate-100 px-2 py-0.5 rounded-md">{p.type}</span>
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-2">
                    <span className="w-12 text-slate-400 shrink-0">端点:</span>
                    <span className="truncate flex-1" title={p.endpoint}>{p.endpoint || '未配置'}</span>
                  </div>
                  {p.models && p.models.length > 0 && (
                    <div className="text-xs text-slate-500 flex items-center gap-2">
                      <span className="w-12 text-slate-400 shrink-0">模型:</span>
                      <span className="truncate flex-1" title={p.models.join(', ')}>{p.models.join(', ')}</span>
                    </div>
                  )}
                  <div className="text-xs text-slate-500 flex items-center gap-2">
                    <span className="w-12 text-slate-400 shrink-0">成本率:</span>
                    <span>{p.cost_rate}</span>
                  </div>
                </div>

                {/* 操作区：默认半透明，悬停变清晰 */}
                <div className="flex gap-2 border-t border-black/5 pt-3 opacity-60 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => edit(p)} className="flex-1 flex justify-center items-center gap-1.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-violet-50 hover:text-violet-600 rounded-lg transition-colors">
                    <Edit2 size={12} /> 编辑
                  </button>
                  <button onClick={() => remove(p.id)} className="flex-1 flex justify-center items-center gap-1.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-rose-50 hover:text-rose-600 rounded-lg transition-colors">
                    <Trash2 size={12} /> 删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 评分路由测试 */}
      <div className="bg-slate-50/40 border border-black/5 rounded-2xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-800 mb-5">评分路由测试</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <select className={inputBaseCls} value={route.task_type} onChange={(e) => setRoute({ ...route, task_type: e.target.value })}>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input className={inputBaseCls} placeholder="质量权重" value={route.quality} onChange={(e) => setRoute({ ...route, quality: e.target.value })} />
          <input className={inputBaseCls} placeholder="速度权重" value={route.speed} onChange={(e) => setRoute({ ...route, speed: e.target.value })} />
          <input className={inputBaseCls} placeholder="成本权重" value={route.cost} onChange={(e) => setRoute({ ...route, cost: e.target.value })} />
        </div>
        <button onClick={doRoute} className="mt-4 bg-violet-600 hover:bg-violet-500 text-white px-6 py-2 rounded-xl text-sm font-medium shadow-md shadow-violet-500/20 transition-all active:scale-95">
          路由测试
        </button>
        {routeResult && (
          <div className="mt-5 space-y-3">
            {routeResult.map((p, i) => (
              <div key={p.id} className="flex justify-between items-center bg-white border border-black/5 shadow-sm rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <b className="text-sm text-slate-800">#{i + 1} {p.name || p.id}</b>
                  <span className="text-xs text-slate-400">· {p.type}</span>
                </div>
                <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-violet-100 text-violet-700">评分 {p._score}</span>
              </div>
            ))}
            {routeResult.length === 0 && (
              <div className="py-8 text-center text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                该任务类型下没有启用的 Provider
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
