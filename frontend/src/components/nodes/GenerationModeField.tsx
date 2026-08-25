import { Field, inputCls } from './NodeShell'

export interface ProviderInfo {
  id: string
  name: string
}

// 生成方式选择：ComfyUI（本地）/ 云端 API（下拉选具体 provider）
export function GenerationModeField({
  mode,
  providerId,
  providers,
  onModeChange,
  onProviderChange,
}: {
  mode: string
  providerId: string
  providers: ProviderInfo[]
  onModeChange: (v: string) => void
  onProviderChange: (v: string) => void
}) {
  return (
    <Field label="生成方式">
      <select
        className={inputCls}
        value={mode || 'comfyui'}
        onChange={(e) => onModeChange(e.target.value)}
      >
        <option value="comfyui">ComfyUI（本地）</option>
        <option value="cloud">云端 API</option>
      </select>
      {mode === 'cloud' && (
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
      )}
    </Field>
  )
}
