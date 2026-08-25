import { type NodeProps } from '@xyflow/react'
import { Type } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { NodeShell, Field, inputCls } from './NodeShell'

const FORMATS = ['srt', 'ass', 'ssa']

export function SubtitleNode({ id, data }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>

  const videoUrl  = String(d.video_url ?? '')
  const audioUrl  = String(d.audio_url ?? '')
  const format    = String(d.format ?? 'srt')
  const burntIn   = Boolean(d.burnt_in)
  const content   = String(d.content ?? '')
  const subUrl    = String(d.subtitle_url ?? '')

  const run = () => update(id, { action: 'execute' })

  return (
    <NodeShell id={id} title="字幕" icon={<Type size={15} />}>
      <Field label="视频URL">
        <input className={inputCls} value={videoUrl} placeholder="视频链接"
          onChange={(e) => update(id, { video_url: e.target.value })} />
      </Field>
      <Field label="音频URL（可选）">
        <input className={inputCls} value={audioUrl} placeholder="音频链接（用于语音识别）"
          onChange={(e) => update(id, { audio_url: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="格式">
          <select className={inputCls} value={format} onChange={(e) => update(id, { format: e.target.value })}>
            {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </Field>
        <Field label="烧录进视频">
          <label className="flex items-center gap-2 pt-4 text-[11px] text-ink-2">
            <input type="checkbox" checked={burntIn}
              onChange={(e) => update(id, { burnt_in: e.target.checked })} />
            烧录
          </label>
        </Field>
      </div>
      {content && (
        <div className="max-h-24 overflow-y-auto rounded bg-soft px-2 py-1 font-mono text-[10px] text-ink-2">
          {content.slice(0, 200)}{content.length > 200 ? '…' : ''}
        </div>
      )}
      {subUrl ? (
        <div className="rounded bg-status-completed/10 px-2 py-1 text-[11px] text-status-completed">
          字幕文件已生成：{subUrl}
        </div>
      ) : (
        <div className="flex h-10 items-center justify-center rounded-md bg-soft text-[11px] text-ink-3">
          点击生成字幕
        </div>
      )}
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={run}>
        生成字幕
      </button>
    </NodeShell>
  )
}
