/**
 * LumiWeave V2.5 RenderNode
 * 规格书 §2: Render Node（渲染执行节点）
 */
import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import NodeShell from '../canvas/NodeShell'
import { rendererGenerate } from '../api'

const ENGINES = [
  { value: 'comfyui', label: 'ComfyUI' },
  { value: 'cloud', label: '云渲染' },
  { value: 'video', label: '视频引擎' },
]

const OUTPUT_FORMATS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPG' },
  { value: 'webp', label: 'WebP' },
  { value: 'mp4', label: 'MP4' },
]

export function RenderNode({ id, data }: NodeProps) {
  const objects = useCanvasStore((s) => s.objects) as Array<{ id: string; type?: string; data?: Record<string, unknown> }>
  const { updateObject, deleteObjects } = useCanvasStore()
  const d = data as {
    engine?: string; model?: string; output_format?: string
    width?: number; height?: number; status?: string; result?: { url?: string; error?: string }
  }
  const [submitting, setSubmitting] = useState(false)

  const update = (patch: Record<string, unknown>) => {
    updateObject(id, { ...d, ...patch })
  }

  // 从上游 prompt 节点收集文本
  const connectedPrompt = (() => {
    const promptNode = objects.find((n) => n.id !== id && n.type === 'prompt')
    return (promptNode?.data as { text?: string })?.text || ''
  })()

  const isRunning = d.status === 'running' || d.status === 'queued'

  const handleSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    updateObject(id, { ...d, status: 'queued' })
    try {
      const res = await rendererGenerate(d.engine || 'comfyui', {
        params: {
          prompt: connectedPrompt || d.model || '',
          model: d.model || undefined,
          width: d.width || 1024,
          height: d.height || 1024,
        },
      }) as { ok: boolean; data?: { url?: string; job_id?: string; error?: string } }
      if (res.ok && (res.data?.url || res.data?.job_id)) {
        updateObject(id, { ...d, status: 'completed', result: { url: res.data?.url } })
      } else {
        updateObject(id, { ...d, status: 'failed', result: { error: res.data?.error || '渲染失败' } })
      }
    } catch (err) {
      updateObject(id, { ...d, status: 'failed', result: { error: String(err) } })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <NodeShell
      title="渲染"
      color="#ef4444"
      status={d.status}
      onDelete={() => deleteObjects([id])}
    >
      <div className="space-y-2">
        <div>
          <label className="text-[9px] text-[var(--lw-ink-3)]">渲染引擎</label>
          <div className="flex gap-1">
            {ENGINES.map((e) => (
              <button
                key={e.value}
                className={`flex-1 text-[9px] py-1 rounded ${d.engine === e.value ? 'bg-red-500 text-white' : 'bg-[var(--lw-ink-1)] text-[var(--lw-ink-3)]'}`}
                onClick={() => update({ engine: e.value })}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[9px] text-[var(--lw-ink-3)]">模型</label>
          <input
            className="nodrag w-full text-xs bg-[var(--lw-ink-1)] border border-[var(--lw-ink-1)] rounded px-1.5 py-1 focus:outline-none focus:border-red-500"
            placeholder="SDXL / DALL-E 3 / Kling…"
            value={d.model || ''}
            onChange={(e) => update({ model: e.target.value })}
          />
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[9px] text-[var(--lw-ink-3)]">宽</label>
            <input
              type="number"
              className="nodrag w-full text-xs bg-[var(--lw-ink-1)] border border-[var(--lw-ink-1)] rounded px-1.5 py-1 focus:outline-none"
              value={d.width || 1024}
              onChange={(e) => update({ width: parseInt(e.target.value) || 1024 })}
            />
          </div>
          <div className="flex-1">
            <label className="text-[9px] text-[var(--lw-ink-3)]">高</label>
            <input
              type="number"
              className="nodrag w-full text-xs bg-[var(--lw-ink-1)] border border-[var(--lw-ink-1)] rounded px-1.5 py-1 focus:outline-none"
              value={d.height || 1024}
              onChange={(e) => update({ height: parseInt(e.target.value) || 1024 })}
            />
          </div>
        </div>

        <div>
          <label className="text-[9px] text-[var(--lw-ink-3)]">格式</label>
          <div className="flex gap-1">
            {OUTPUT_FORMATS.map((f) => (
              <button
                key={f.value}
                className={`flex-1 text-[9px] py-0.5 rounded ${d.output_format === f.value ? 'bg-red-500 text-white' : 'bg-[var(--lw-ink-1)] text-[var(--lw-ink-3)]'}`}
                onClick={() => update({ output_format: f.value })}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {connectedPrompt && (
          <div className="text-[8px] text-[var(--lw-ink-3)] bg-[var(--lw-ink-1)] rounded px-1.5 py-1 truncate" title={connectedPrompt}>
            📝 {connectedPrompt.slice(0, 40)}…
          </div>
        )}

        {d.result?.url && (
          <img src={d.result.url} alt="渲染结果" className="w-full rounded border border-[var(--lw-ink-1)]" />
        )}

        {d.result?.error && (
          <div className="text-[9px] text-red-400 bg-red-500/10 rounded px-1.5 py-1">{d.result.error}</div>
        )}

        <button
          className={`nodrag w-full text-xs py-1.5 rounded font-medium ${isRunning ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-red-500 text-white hover:bg-red-600'}`}
          onClick={handleSubmit}
          disabled={isRunning || submitting}
        >
          {submitting ? '提交中…' : isRunning ? '渲染中…' : '▶ 提交渲染'}
        </button>
      </div>
    </NodeShell>
  )
}
