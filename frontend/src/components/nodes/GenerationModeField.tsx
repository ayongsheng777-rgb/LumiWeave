import { Field, inputCls } from './NodeShell'

export interface ProviderInfo {
  id: string
  name: string
  models?: string[]
}

export interface RendererInfo {
  id: string
  name: string
  type?: string
  endpoint?: string
}

// 生成方式选择：ComfyUI（本地/局域网）/ 云端 API；并联动选择具体模型方案
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
          <select
            className={`${inputCls} mt-1.5`}
            value={providerId}
            onChange={(e) => onProviderChange(e.target.value)}
          >
            <option value="">选择云端接口…</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            className={`${inputCls} mt-1.5`}
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
          >
            <option value="">模型：默认</option>
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
            onChange={(e) => onRendererChange(e.target.value)}
          >
            <option value="">渲染器：自动（第一个启用）</option>
            {renderers.map((r) => (
              <option key={r.id} value={r.id}>{r.name}{r.endpoint ? `（${r.endpoint}）` : ''}</option>
            ))}
          </select>
          <input
            className={`${inputCls} mt-1.5`}
            value={model}
            placeholder="Checkpoint 名（留空用工作流默认）"
            onChange={(e) => onModelChange(e.target.value)}
          />
        </>
      )}
    </Field>
  )
}
