import { useState } from 'react'
import { RefreshCw, Settings2, Wand2 } from 'lucide-react'
import { Field, inputCls } from './NodeShell'
import { getRendererWorkflows, routeProviders } from '../../api'
import { useUiStore } from '../../store/uiStore'

export interface ProviderInfo {
  id: string
  name: string
  models?: string[]
  status?: string
}

export interface RendererInfo {
  id: string
  name: string
  type?: string
  endpoint?: string
}

interface ComfyCapabilities {
  checkpoints: string[]
  samplers: string[]
  extras: Record<string, boolean>
}

// 生成方式选择：ComfyUI（本地/局域网）/ 云端 API；并联动选择具体模型方案
// comfyui 模式带「获取」按钮：拉取该 ComfyUI 实际可用的 Checkpoint 列表与节点包（V2.3）
export function GenerationModeField({
  mode,
  providerId,
  providers,
  rendererId,
  renderers,
  model,
  onModeChange,
  onProviderChange,
  onRendererChange,
  onModelChange,
}: {
  mode: string
  providerId: string
  providers: ProviderInfo[]
  rendererId: string
  renderers: RendererInfo[]
  model: string
  onModeChange: (v: string) => void
  onProviderChange: (v: string) => void
  onRendererChange: (v: string) => void
  onModelChange: (v: string) => void
}) {
  const selectedProvider = providers.find((p) => p.id === providerId)
  const providerModels = selectedProvider?.models || []

  const [fetching, setFetching] = useState(false)
  const [caps, setCaps] = useState<ComfyCapabilities | null>(null)
  const [capError, setCapError] = useState('')
  const [routing, setRouting] = useState(false)
  const openManagement = useUiStore((s) => s.openManagement)

  // 自动优选：按 质量/速度/成本 综合评分挑最优 image 接口+模型，直接填进节点
  const autoRoute = async () => {
    if (routing) return
    setRouting(true)
    try {
      const res = await routeProviders({ task_type: 'image', quality: 1.0, speed: 1.0, cost: 1.0, limit: 1 })
      const chain = ((res.data as Record<string, unknown> | undefined)?.providers as ProviderInfo[]) || []
      const best = chain[0]
      if (best?.id) {
        onProviderChange(best.id)
        onModelChange((best.models || [])[0] || '')
      }
    } finally {
      setRouting(false)
    }
  }

  const fetchWorkflows = async () => {
    const rid = rendererId || renderers[0]?.id || ''
    if (!rid || fetching) return
    setFetching(true)
    setCapError('')
    try {
      const res = await getRendererWorkflows(rid)
      const d = res.data as Record<string, unknown> | undefined
      if (res.ok && d?.ok) {
        setCaps({
          checkpoints: (d.checkpoints as string[]) || [],
          samplers: (d.samplers as string[]) || [],
          extras: (d.extras as Record<string, boolean>) || {},
        })
      } else {
        setCaps(null)
        setCapError(String(d?.error || '获取失败'))
      }
    } catch (e) {
      setCaps(null)
      setCapError(String(e))
    } finally {
      setFetching(false)
    }
  }

  return (
    <Field label="生成方式">
      <select
        className={inputCls}
        value={mode || 'comfyui'}
        onChange={(e) => onModeChange(e.target.value)}
      >
        <option value="comfyui">ComfyUI（本地/局域网）</option>
        <option value="cloud">云端 API</option>
      </select>

      {mode === 'cloud' && (
        <>
          {/* 云端接口：下拉 + ⚙ 配置（直达管理面板接口页） + 自动优选 */}
          <div className="mt-1.5 flex gap-1.5">
            <select
              className={`${inputCls} min-w-0 flex-1`}
              value={providerId}
              onChange={(e) => { onProviderChange(e.target.value); onModelChange('') }}
            >
              <option value="">选择云端接口…</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.status && p.status !== 'enabled' ? `（${p.status}）` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="nodrag flex shrink-0 items-center gap-1 rounded-lg border border-edge bg-soft px-2 py-1 text-xs text-ink-2 transition hover:bg-hover hover:text-ink"
              onClick={() => openManagement('providers')}
              title="接口单独配置：新增/修改云端接口与模型清单"
            >
              <Settings2 size={12} />
              配置
            </button>
            <button
              type="button"
              className="nodrag flex shrink-0 items-center gap-1 rounded-lg border border-brand-500/50 bg-brand-500/10 px-2 py-1 text-xs text-brand-300 transition hover:bg-brand-500/20 disabled:opacity-50"
              onClick={autoRoute}
              disabled={routing || providers.length === 0}
              title="按 质量/速度/成本 自动挑选最优可用接口与模型"
            >
              <Wand2 size={12} className={routing ? 'animate-pulse' : ''} />
              {routing ? '优选中' : '自动优选'}
            </button>
          </div>

          {/* 模型：来自接口配置里已配置的模型清单（仅列该接口下可调用的） */}
          <select
            className={`${inputCls} mt-1.5`}
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
          >
            <option value="">
              模型：默认{selectedProvider ? (providerModels.length ? `（已配置 ${providerModels.length} 个）` : '（该接口未配置模型，点「配置」添加）') : ''}
            </option>
            {providerModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {model && !providerModels.includes(model) && <option value={model}>{model}</option>}
          </select>
        </>
      )}

      {mode === 'comfyui' && (
        <>
          <select
            className={`${inputCls} mt-1.5`}
            value={rendererId}
            onChange={(e) => { onRendererChange(e.target.value); setCaps(null); setCapError('') }}
          >
            <option value="">渲染器：自动（第一个启用）</option>
            {renderers.map((r) => (
              <option key={r.id} value={r.id}>{r.name}{r.endpoint ? `（${r.endpoint}）` : ''}</option>
            ))}
          </select>

          {/* Checkpoint：未获取时可手填，点「获取」变成可用列表下拉 */}
          <div className="mt-1.5 flex gap-1.5">
            {caps && caps.checkpoints.length > 0 ? (
              <select
                className={`${inputCls} min-w-0 flex-1`}
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
              >
                <option value="">Checkpoint：默认{caps.checkpoints.length ? `（${caps.checkpoints.length} 个可用）` : ''}</option>
                {caps.checkpoints.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                {model && !caps.checkpoints.includes(model) && <option value={model}>{model}</option>}
              </select>
            ) : (
              <input
                className={`${inputCls} min-w-0 flex-1`}
                value={model}
                placeholder="Checkpoint 名（留空用工作流默认）"
                onChange={(e) => onModelChange(e.target.value)}
              />
            )}
            <button
              type="button"
              className="nodrag flex shrink-0 items-center gap-1 rounded-lg border border-edge bg-soft px-2 py-1 text-xs text-ink-2 transition hover:bg-hover hover:text-ink disabled:opacity-50"
              onClick={fetchWorkflows}
              disabled={fetching || (renderers.length === 0)}
              title="从 ComfyUI 拉取可用的 Checkpoint 与节点包"
            >
              <RefreshCw size={12} className={fetching ? 'animate-spin' : ''} />
              {fetching ? '获取中' : '获取'}
            </button>
          </div>

          {capError && <div className="mt-1 text-[10px] text-red-400">{capError}</div>}
          {caps && (
            <div className="mt-1 rounded bg-soft px-2 py-1 text-[10px] leading-relaxed text-ink-3">
              节点包：文生图 ✓ / 文生视频 ✓{caps.extras.ltx_video ? ' / LTX 视频 ✓' : ''}{caps.extras.wan_video ? ' / Wan 视频 ✓' : ''}
              {caps.checkpoints.length === 0 && '（未检测到 Checkpoint，请检查 ComfyUI models 目录）'}
            </div>
          )}
        </>
      )}
    </Field>
  )
}
