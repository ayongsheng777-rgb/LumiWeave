import { type NodeProps } from '@xyflow/react'
import { Music } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import { NodeShell, Field, inputCls } from './NodeShell'

const AUDIO_TYPES = [
  { value: 'narration', label: '旁白' },
  { value: 'voice_over', label: '角色配音' },
  { value: 'bgm', label: '背景音乐' },
  { value: 'sfx', label: '音效' },
]

export function AudioNode({ id, data }: NodeProps) {
  const update = useWorkflowStore((s) => s.updateNodeData)
  const d = data as Record<string, unknown>

  const type    = String(d.type ?? 'narration')
  const script  = String(d.script ?? '')
  const voice   = String(d.voice ?? '默认')
  const musicUrl = String(d.music_url ?? '')
  const audioUrl = String(d.audio_url ?? '')

  const run = () => update(id, { action: 'execute' })

  return (
    <NodeShell id={id} title="声音" icon={<Music size={15} />}>
      <Field label="类型">
        <select className={inputCls} value={type} onChange={(e) => update(id, { type: e.target.value })}>
          {AUDIO_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      {type === 'narration' || type === 'voice_over' ? (
        <>
          <Field label="配音脚本">
            <textarea className={inputCls} rows={3} value={script} placeholder="输入配音文案……"
              onChange={(e) => update(id, { script: e.target.value })} />
          </Field>
          <Field label="音色">
            <select className={inputCls} value={voice} onChange={(e) => update(id, { voice: e.target.value })}>
              {['默认', '男声-磁性', '女声-甜美', '男声-低沉', '童声', '老人'].map((v) =>
                <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
        </>
      ) : type === 'bgm' ? (
        <Field label="音乐参考（URL）">
          <input className={inputCls} value={musicUrl} placeholder="参考音乐链接"
            onChange={(e) => update(id, { music_url: e.target.value })} />
        </Field>
      ) : null}
      {audioUrl
        ? <audio className="w-full" src={audioUrl} controls />
        : <div className="flex h-12 items-center justify-center rounded-md bg-soft text-[11px] text-ink-3">点击生成获取音频</div>}
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={run}>
        生成音频
      </button>
    </NodeShell>
  )
}
