import { useState } from 'react'
import { RefreshCw, Settings2 } from 'lucide-react'
import { Field, inputCls } from './NodeShell'
import { getRendererWorkflows } from '../../api'
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
  const openManagement = useUiStore((s) => s.openManagement)

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
          {/* 云端模型：从「模型库」选择（直连，不用商业接口预设）；⚙ 直达模型页 */}
          <div className="mt-1.5 flex gap-1.5">
            <select
              className={`${inputCls} min-w-0 flex-1`}
              value={providerId}
              onChange={(e) => { onProviderChange(e.target.value); onModelChange('') }}
            >
              <option value="">选择模型（系统自动选）…</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.status && p.status !== 'enabled' ? `（${p.status}）` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="nodrag flex shrink-0 items-center gap-1 rounded-lg border border-edge bg-soft px-2 py-1 text-xs text-ink-2 transition hover:bg-hover hover:text-ink"
              onClick={() => openManagement('model')}
              title="在「设置-模型」中新增/修改模型配置"
            >
              <Settings2 size={12} />
              配置
            </button>
          </div>

          {/* 模型：来自模型库该配置的模型名（单模型配置时自动带出） */}
          <select
            className={`${inputCls} mt-1.5`}
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
          >
            <option value="">
              模型：默认{selectedProvider ? (providerModels.length ? `（已配置 ${providerModels.length} 个）` : '（该配置未填模型，点「配置」补全）') : ''}
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
