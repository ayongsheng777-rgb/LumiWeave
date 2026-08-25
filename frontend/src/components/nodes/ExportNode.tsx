import { type NodeProps } from '@xyflow/react'
import { Download } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { NodeShell, Field, inputCls } from './NodeShell'

const FORMATS = [
  { value: 'mp4',  label: 'MP4 视频' },
  { value: 'mov',  label: 'MOV 视频' },
  { value: 'png',  label: 'PNG 图片包' },
  { value: 'pdf',  label: 'PDF 分镜脚本' },
  { value: 'storyboard_json', label: 'Storyboard JSON' },
]

export function ExportNode({ id, data, selected }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>

  const format   = String(d.format ?? 'mp4')
  const videoUrl = String(d.video_url ?? '')
  const subUrl   = String(d.subtitle_url ?? '')
  const incStory = Boolean(d.include_storyboard ?? true)
  const incSub   = Boolean(d.include_subtitles ?? true)
  const result   = d.result as Record<string, unknown> | undefined
  const expPath  = String(result?.path ?? '')

  const run = () => update(id, { action: 'execute' })

  return (
    <NodeShell id={id} selected={selected} title="导出成片" icon={<Download size={15} />}>
      <Field label="导出格式">
        <select className={inputCls} value={format} onChange={(e) => update(id, { format: e.target.value })}>
          {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </Field>
      <Field label="视频源">
        <input className={inputCls} value={videoUrl} placeholder="视频 URL"
          onChange={(e) => update(id, { video_url: e.target.value })} />
      </Field>
      <Field label="字幕源">
        <input className={inputCls} value={subUrl} placeholder="字幕 URL"
          onChange={(e) => update(id, { subtitle_url: e.target.value })} />
      </Field>
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-[11px] text-ink-2">
          <input type="checkbox" checked={incStory}
            onChange={(e) => update(id, { include_storyboard: e.target.checked })} />
          包含分镜脚本
        </label>
        <label className="flex items-center gap-2 text-[11px] text-ink-2">
          <input type="checkbox" checked={incSub}
            onChange={(e) => update(id, { include_subtitles: e.target.checked })} />
          包含字幕
        </label>
      </div>
      {expPath && (
        <div className="rounded bg-status-completed/10 px-2 py-1 text-[11px] text-status-completed">
          已导出：{expPath}
        </div>
      )}
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={run}>
        导出 {FORMATS.find((f) => f.value === format)?.label ?? format}
      </button>
    </NodeShell>
  )
}
