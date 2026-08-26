// =====================================================================
// 灵境节点属性面板 — 素材各种属性的编辑入口（原版复刻 P0）
// 由 NodeConfigDrawer 在选中 lj_* 节点时挂载，提供：
//   · 按节点类型的字段化编辑（中文标签，不再裸露 JSON key）
//   · 版本资源管理（多版本缩略、点选切换、删除）
//   · 上游输入只读展示（连线即输入）+ {{Ref N}} 语法提示
// =====================================================================
import { useState } from 'react'
import type { Node } from '@xyflow/react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { useCanvasStore } from '../store/canvasStore'
import { collectInputs, runLjNode, type LjResource } from '../canvas/ljEngine'
import { CAMERA_MOTIONS } from '../canvas/cameraMotions'

type AnyObj = Record<string, unknown>
type Widget = 'text' | 'textarea' | 'number' | 'bool' | 'select' | 'camera'

interface FieldDef {
  key: string
  label: string
  widget: Widget
  options?: string[]
  placeholder?: string
}

/** 比例 / 景别 / 机位 / 运动 / 构图 / 灯光等选项（灵境口径） */
const RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9']
const SHOT_SIZES = ['远景', '全景', '中景', '中近景', '近景', '特写', '大特写']
const CAMERA_POS = ['平视', '俯视', '仰视', '低角度', '高角度', '鸟瞰', '过肩']
const COMPOSITIONS = ['三分法', '居中', '对称', '引导线', '框架式', '留白', '对角线']
const LIGHTINGS = ['自然光', '顺光', '侧光', '逆光', '侧逆光', '顶光', '暖光', '冷光', '霓虹光', '夜景灯光']
const COLORS = ['暖色低饱和', '冷色高对比', '黑白', '低饱和', '高饱和', '赛博朋克', '胶片感', '莫兰迪']
const LENSES = ['广角 24mm', '标准 35mm', '标准 50mm', '中长焦 85mm', '长焦 105mm', '长焦 135mm', '特写微距']

/** 镜头/灯光专业字段（图片、视频、分镜节点共用） */
const SHOT_FIELDS: FieldDef[] = [
  { key: 'aspect_ratio', label: '比例', widget: 'select', options: RATIOS },
  { key: 'shot_size', label: '景别', widget: 'select', options: SHOT_SIZES },
  { key: 'lens', label: '镜头（焦距）', widget: 'select', options: LENSES },
  { key: 'camera_motion', label: '运镜方案', widget: 'camera' },
  { key: 'camera_position', label: '机位', widget: 'select', options: CAMERA_POS },
  { key: 'composition', label: '构图', widget: 'select', options: COMPOSITIONS },
  { key: 'lighting', label: '灯光', widget: 'select', options: LIGHTINGS },
  { key: 'color', label: '色调', widget: 'select', options: COLORS },
]

/** 各类型的可编辑字段（顺序即展示顺序） */
const SCHEMA: Record<string, FieldDef[]> = {
  lj_image_source: [{ key: 'label', label: '名称', widget: 'text' }],
  lj_image_config: [
    { key: 'prompt', label: '生成提示词', widget: 'textarea', placeholder: '支持 {{Ref 1}} 引用第1张输入图…' },
    ...SHOT_FIELDS,
    { key: 'model', label: '模型', widget: 'text', placeholder: '如：图片 2.1' },
    { key: 'render_mode', label: '渲染方式', widget: 'select', options: ['cloud', 'comfyui'] },
    { key: 'provider_id', label: '云端接口 ID', widget: 'text', placeholder: 'cloud 模式必填' },
    { key: 'renderer_id', label: 'ComfyUI 渲染器 ID', widget: 'text', placeholder: 'comfyui 模式必填' },
    { key: 'label', label: '节点名称', widget: 'text' },
  ],
  lj_video_config: [
    { key: 'prompt', label: '生成提示词', widget: 'textarea', placeholder: '{{Ref 1}}=人物参考，{{Ref 2}}=场景参考…' },
    ...SHOT_FIELDS,
    { key: 'model', label: '模型', widget: 'text', placeholder: '如：视频 2.1' },
    { key: 'duration', label: '时长（秒）', widget: 'number' },
    { key: 'fps', label: '帧率', widget: 'number' },
    { key: 'width', label: '宽度', widget: 'number' },
    { key: 'height', label: '高度', widget: 'number' },
    { key: 'generate_audio', label: '生成音效/旁白', widget: 'bool' },
    { key: 'subtitle', label: '字幕开关', widget: 'bool' },
    { key: 'subtitle_text', label: '字幕文本（可选）', widget: 'textarea', placeholder: '开启字幕时填入对白，逐句一行' },
    { key: 'source_type', label: '生成模式', widget: 'select', options: ['reference-video', 'image-to-video', 'text-to-video'] },
    { key: 'render_mode', label: '渲染方式', widget: 'select', options: ['cloud', 'comfyui'] },
    { key: 'provider_id', label: '云端接口 ID', widget: 'text' },
    { key: 'renderer_id', label: 'ComfyUI 渲染器 ID', widget: 'text' },
    { key: 'label', label: '节点名称', widget: 'text' },
  ],
  lj_text_config: [
    { key: 'prompt', label: '内容要求', widget: 'textarea' },
    { key: 'text', label: '产出内容', widget: 'textarea' },
    { key: 'label', label: '节点名称', widget: 'text' },
  ],
  lj_script_config: [
    { key: 'prompt', label: '剧本 brief', widget: 'textarea', placeholder: '如：末日荒原科幻短片，45s，史诗感' },
    { key: 'duration', label: '目标时长（秒）', widget: 'number' },
    { key: 'text', label: '产出剧本', widget: 'textarea' },
    { key: 'label', label: '节点名称', widget: 'text' },
  ],
  lj_storyboard_config: [
    { key: 'prompt', label: '分镜拆解要求', widget: 'textarea' },
    ...SHOT_FIELDS,
    { key: 'text', label: '产出分镜表', widget: 'textarea' },
    { key: 'label', label: '节点名称', widget: 'text' },
  ],
  lj_video_clip: [{ key: 'label', label: '节点名称', widget: 'text' }],
}

const inputCls =
  'nodrag nowheel w-full rounded-md border border-edge bg-input px-2 py-1.5 text-xs text-ink outline-none focus:border-brand-500'

export default function LjPropertyPanel({ node }: { node: Node }) {
  const id = node.id
  const data = (node.data ?? {}) as AnyObj
  const update = useCanvasStore((s) => s.updateObject)
  const objects = useCanvasStore((s) => s.objects)
  const [busy, setBusy] = useState(false)

  const fields = SCHEMA[String(node.type)] ?? []
  const resources = Array.isArray(data.resources) ? (data.resources as LjResource[]) : []
  const selectedIndex = typeof data.selectedIndex === 'number' ? data.selectedIndex : Math.max(0, resources.length - 1)
  const inputs = collectInputs(id)

  const set = (key: string, value: unknown) => update(id, { [key]: value })

  const removeResource = (idx: number) => {
    const next = resources.filter((_, i) => i !== idx)
    update(id, {
      resources: next,
      selectedIndex: Math.min(selectedIndex > idx ? selectedIndex - 1 : selectedIndex, Math.max(0, next.length - 1)),
    })
  }

  const run = async () => {
    setBusy(true)
    await runLjNode(id)
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      {/* 状态与执行 */}
      <div className="flex items-center gap-2">
        <button
          className="nodrag flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? '执行中…' : '▶ 执行此节点'}
        </button>
        {data.error ? (
          <span className="truncate rounded bg-red-500/15 px-2 py-1 text-[10px] text-red-400" title={String(data.error)}>
            {String(data.error).slice(0, 40)}
          </span>
        ) : null}
      </div>

      {/* 字段化属性编辑：提示词横版全宽，镜头/灯光等短字段两列横排 */}
      {fields.map((f) => {
        const v = data[f.key]
        const label = (
          <span className="inspector-label">{f.label}</span>
        )
        const widget = (() => {
          switch (f.widget) {
            case 'textarea':
              return (
                <textarea
                  className={`${inputCls} min-h-[120px] leading-relaxed`}
                  rows={6}
                  value={v == null ? '' : String(v)}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )
            case 'camera':
              return (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-3 gap-1.5">
                    {CAMERA_MOTIONS.map((c) => {
                      const active = String(v ?? '') === c.name
                      return (
                        <button
                          key={c.name}
                          title={c.desc}
                          className={`nodrag truncate rounded-md border px-1 py-1.5 text-[11px] transition ${
                            active ? 'border-brand-400 bg-brand-500/15 text-brand-400' : 'border-edge bg-input text-ink-2 hover:border-brand-300'
                          }`}
                          onClick={() => set('camera_motion', active ? '' : c.name)}
                        >
                          {c.name}
                        </button>
                      )
                    })}
                  </div>
                  <input
                    className={inputCls}
                    placeholder="自定义运镜补充（英文运镜词更佳）…"
                    value={String(data.camera_motion_custom ?? '')}
                    onChange={(e) => set('camera_motion_custom', e.target.value)}
                  />
                </div>
              )
            case 'number':
              return <input type="number" className={inputCls} value={v == null ? '' : Number(v)} onChange={(e) => set(f.key, Number(e.target.value))} />
            case 'bool':
              return (
                <button
                  className={`nodrag rounded-full px-3 py-1 text-xs transition ${v === true ? 'bg-green-500/20 text-green-400' : 'bg-soft text-ink-3'}`}
                  onClick={() => set(f.key, v !== true)}
                >
                  {v === true ? '✓ 开启' : '关闭'}
                </button>
              )
            case 'select':
              return (
                <select className={inputCls} value={String(v ?? f.options?.[0] ?? '')} onChange={(e) => set(f.key, e.target.value)}>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              )
            default:
              return <input className={inputCls} value={v == null ? '' : String(v)} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
          }
        })()
        // 提示词（textarea）横版独占一行；其余字段两列横排
        return f.widget === 'textarea' ? (
          <label key={f.key} className="block space-y-1">
            {label}
            {widget}
          </label>
        ) : (
          <label key={f.key} className="block space-y-1">
            {label}
            {widget}
          </label>
        )
      })}

      {/* 上游输入（连线即输入） */}
      <div className="inspector-section">
        <div className="inspector-label">上游输入 · {inputs.length} 项</div>
        {inputs.length === 0 ? (
          <p className="inspector-hint">从上游节点拉一条连线过来，其当前资源自动成为本节点的参考图；Prompt 里用 {'{{Ref 1}}'} 引用第 1 张。</p>
        ) : (
          <div className="space-y-1.5">
            {inputs.map((inp, i) => (
              <div key={inp.nodeId} className="flex items-center gap-2 rounded-md border border-edge bg-input p-1.5">
                {inp.cover ? <img src={inp.cover} alt="" className="h-8 w-8 shrink-0 rounded object-cover" draggable={false} /> : null}
                <span className="truncate text-[11px] text-ink-2">
                  Ref {i + 1} · {inp.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 版本资源管理 */}
      <div className="inspector-section">
        <div className="inspector-label">版本资源 · {resources.length} 个</div>
        {resources.length === 0 ? (
          <p className="inspector-hint">
            <ImagePlus size={12} className="mr-1 inline" />
            执行后每个版本都会留在这里，不覆盖旧版本。
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {resources.map((r, i) => (
                <button
                  key={r.id}
                  className={`group relative aspect-square overflow-hidden rounded-md border transition ${
                    i === selectedIndex ? 'border-brand-400 ring-1 ring-brand-400' : 'border-edge opacity-75 hover:opacity-100'
                  }`}
                  onClick={() => update(id, { selectedIndex: i })}
                  title={`版本 ${i + 1}${i === selectedIndex ? '（当前）' : ''}`}
                >
                  <img src={r.cover ?? r.url} alt={`v${i + 1}`} className="h-full w-full object-cover" draggable={false} />
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] text-white">v{i + 1}</span>
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex justify-end">
              <button
                className="nodrag flex items-center gap-1 rounded px-2 py-1 text-[10px] text-ink-3 transition hover:text-red-400"
                onClick={() => removeResource(selectedIndex)}
                title="删除当前选中的版本"
              >
                <Trash2 size={11} /> 删除当前版本
              </button>
            </div>
          </>
        )}
      </div>

      {/* 关联对象只读信息 */}
      <div className="inspector-section">
        <div className="inspector-label">画布引用</div>
        <p className="inspector-hint truncate">
          节点 ID：<span className="font-mono">{id}</span>（{objects.length} 个节点共享此画布）
        </p>
      </div>
    </div>
  )
}
