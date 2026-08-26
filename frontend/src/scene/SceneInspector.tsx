/**
 * 动态属性检查器（规格书 §13 / §17）
 *
 * 关键设计：字段不写死在前端，而是读后端注册表 OBJECT_LIBRARY[type].fields
 * （key → 中文标签）。后端加字段，前端自动出现输入框（§40）。
 *
 * 字段类型推断：
 *  - 数组 → 多行文本（一行一项）
 *  - 数字 → number input
 *  - 布尔 → 勾选框
 *  - 长文本键（description/prompt/text/summary/analysis/dialogue）→ textarea
 *  - 镜头术语键（camera/motion/shot_size…）→ 下拉（中英双文）
 *  - 其余 → 单行文本
 */
import { useSceneStore, ACTION_LABELS } from '../store/sceneStore'
import { CAMERA_ZH, cameraLabel } from '../cameraLabels'
import { Sparkles, Loader2 } from 'lucide-react'

const LONG_TEXT_KEYS = new Set([
  'description', 'prompt', 'text', 'summary', 'analysis', 'dialogue',
  'appearance', 'marketing_plan', 'composition',
])

const CAMERA_KEYS = new Set(['camera', 'motion', 'shot_size', 'camera_motion', 'lens'])

const CAMERA_OPTIONS = Object.keys(CAMERA_ZH)

export default function SceneInspector() {
  const selectedIds = useSceneStore((s) => s.selectedIds)
  const objects = useSceneStore((s) => s.objects)
  const patchObject = useSceneStore((s) => s.patchObject)
  const metaOf = useSceneStore((s) => s.metaOf)
  const runAction = useSceneStore((s) => s.runAction)
  const busy = useSceneStore((s) => s.busy)
  const typeDef = useSceneStore((s) => s.currentTypeDef())

  const node = objects.find((o) => o.id === selectedIds[0])

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-ink-3">
        选中画布上的对象后
        <br />
        在此编辑它的专业参数
      </div>
    )
  }

  const objectType = String(node.data.objectType || 'text')
  const payload = (node.data.payload || {}) as Record<string, unknown>
  const meta = metaOf(objectType)
  const fields = meta.fields || {}
  const locked = node.data.locked === true

  // 该类型可用的场景动作
  const actions = (typeDef?.actions || []).filter((a) => {
    if (objectType === 'product') return a.includes('product') || a.includes('image') || a.includes('poster') || a === 'batch_generate' || a.includes('detail')
    if (objectType === 'shot') return a.includes('shot') || a === 'generate_prompt' || a === 'generate_reference' || a === 'generate_video'
    if (objectType === 'storyboard') return a.includes('image') || a === 'generate_video'
    if (objectType === 'scene') return a.includes('scene') || a.includes('image')
    if (objectType === 'story') return a.includes('character') || a.includes('scene') || a.includes('storyboard')
    if (objectType === 'video') return a.includes('video') || a.includes('shot') || a.includes('frame')
    if (objectType === 'image') return a === 'generate_video'
    return false
  })

  const set = (key: string, value: unknown) => patchObject(node.id, { [key]: value })

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <span className="h-3 w-1 rounded-full" style={{ background: meta.color }} />
        <span className="text-xs font-medium text-ink">{meta.label}</span>
        {locked && <span className="text-[10px] text-amber-400">已锁定</span>}
        <span className="ml-auto truncate text-[10px] text-ink-3" title={node.id}>
          {node.id.slice(-6)}
        </span>
      </div>

      {/* 字段区 */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {Object.keys(fields).length === 0 && (
          <div className="text-[10px] text-ink-3">该对象类型未定义可编辑字段。</div>
        )}

        {Object.entries(fields).map(([key, label]) => {
          const value = payload[key]

          // 数组 → 一行一项
          if (Array.isArray(value) || (value === undefined && ['selling_points', 'characters', 'images', 'sku'].includes(key))) {
            const arr = Array.isArray(value) ? value : []
            return (
              <label key={key} className="block">
                <span className="mb-1 block text-[10px] text-ink-3">{label}（一行一项）</span>
                <textarea
                  className="w-full resize-y rounded-lg border border-edge bg-canvas px-2 py-1.5 text-[11px] text-ink outline-none focus:border-brand-500"
                  rows={3}
                  disabled={locked}
                  value={arr.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('\n')}
                  onChange={(e) =>
                    set(key, e.target.value.split('\n').map((l) => l.trim()).filter(Boolean))
                  }
                />
              </label>
            )
          }

          // 布尔
          if (typeof value === 'boolean') {
            return (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-brand-500"
                  disabled={locked}
                  checked={value}
                  onChange={(e) => set(key, e.target.checked)}
                />
                <span className="text-[11px] text-ink-2">{label}</span>
              </label>
            )
          }

          // 镜头术语 → 下拉（中英双文）
          if (CAMERA_KEYS.has(key)) {
            const cur = String(value ?? '')
            return (
              <label key={key} className="block">
                <span className="mb-1 block text-[10px] text-ink-3">{label}</span>
                <select
                  className="w-full rounded-lg border border-edge bg-canvas px-2 py-1.5 text-[11px] text-ink outline-none focus:border-brand-500"
                  disabled={locked}
                  value={CAMERA_OPTIONS.includes(cur) ? cur : ''}
                  onChange={(e) => set(key, e.target.value)}
                >
                  <option value="">{cur && !CAMERA_OPTIONS.includes(cur) ? cur : '未指定'}</option>
                  {CAMERA_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {cameraLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
            )
          }

          // 数字
          if (typeof value === 'number' || ['duration', 'scene_no', 'shot_no', 'scene', 'shot', 'start', 'end'].includes(key)) {
            return (
              <label key={key} className="block">
                <span className="mb-1 block text-[10px] text-ink-3">{label}</span>
                <input
                  type="number"
                  className="w-full rounded-lg border border-edge bg-canvas px-2 py-1.5 text-[11px] text-ink outline-none focus:border-brand-500"
                  disabled={locked}
                  value={value === undefined || value === null ? '' : String(value)}
                  onChange={(e) => set(key, e.target.value === '' ? '' : Number(e.target.value))}
                />
              </label>
            )
          }

          // 对象 → JSON
          if (value !== null && typeof value === 'object') {
            return (
              <label key={key} className="block">
                <span className="mb-1 block text-[10px] text-ink-3">{label}（JSON）</span>
                <textarea
                  className="w-full resize-y rounded-lg border border-edge bg-canvas px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-brand-500"
                  rows={3}
                  disabled={locked}
                  defaultValue={JSON.stringify(value, null, 2)}
                  onBlur={(e) => {
                    try {
                      set(key, JSON.parse(e.target.value || '{}'))
                    } catch {
                      /* JSON 非法时忽略，保留原值 */
                    }
                  }}
                />
              </label>
            )
          }

          // 长文本
          if (LONG_TEXT_KEYS.has(key)) {
            return (
              <label key={key} className="block">
                <span className="mb-1 block text-[10px] text-ink-3">{label}</span>
                <textarea
                  className="w-full resize-y rounded-lg border border-edge bg-canvas px-2 py-1.5 text-[11px] leading-relaxed text-ink outline-none focus:border-brand-500"
                  rows={4}
                  disabled={locked}
                  value={String(value ?? '')}
                  onChange={(e) => set(key, e.target.value)}
                />
              </label>
            )
          }

          // 单行文本
          return (
            <label key={key} className="block">
              <span className="mb-1 block text-[10px] text-ink-3">{label}</span>
              <input
                className="w-full rounded-lg border border-edge bg-canvas px-2 py-1.5 text-[11px] text-ink outline-none focus:border-brand-500"
                disabled={locked}
                value={String(value ?? '')}
                onChange={(e) => set(key, e.target.value)}
              />
            </label>
          )
        })}
      </div>

      {/* 动作区 */}
      {actions.length > 0 && (
        <div className="shrink-0 border-t border-edge px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-1 text-[10px] text-ink-3">
            <Sparkles size={11} />
            可执行动作
          </div>
          <div className="flex flex-wrap gap-1.5">
            {actions.map((a) => (
              <button
                key={a}
                className="flex items-center gap-1 rounded-lg border border-edge bg-canvas px-2 py-1 text-[10px] text-ink-2 transition hover:border-brand-500 hover:text-ink disabled:opacity-40"
                disabled={!!busy}
                onClick={() => void runAction(a, [node.id])}
              >
                {busy === a && <Loader2 size={10} className="animate-spin" />}
                {ACTION_LABELS[a] || a}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
