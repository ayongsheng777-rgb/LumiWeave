// DirectorPanel —— AI 导演台面板
// 一键排片：故事 → 资产 → 分镜 → 视频 → 人工审核。
// 状态机轮询 + 进度条 + 步骤日志 + 分镜/资产/视频审核区。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, Loader2, Play, RefreshCw, Film, Check } from 'lucide-react'
import { directorCreate, directorTaskGet, directorTasks, directorTaskVideo } from '../api'
import { useSceneStore } from '../store/sceneStore'
import { emitLog } from '../components/LogPanel'

const STEPS = [
  { key: 'ANALYZING', label: '分析故事' },
  { key: 'ASSET_GENERATING', label: '生成资产' },
  { key: 'SHOT_GENERATING', label: '生成分镜' },
  { key: 'VIDEO_GENERATING', label: '生成视频' },
  { key: 'REVIEWING', label: '人工审核' },
  { key: 'APPROVED', label: '已完成' },
]

interface Task {
  id: string
  status: string
  progress: number
  current_step: string
  log: { step?: string; message?: string }[]
  result: { assets?: Record<string, unknown>; shots?: Record<string, unknown>[]; videos?: unknown[] }
  created_at?: string
}

function statusIndex(status: string): number {
  if (status === 'INIT') return 0
  if (status === 'ANALYZING') return 0
  if (status === 'ASSET_GENERATING') return 1
  if (status === 'SHOT_GENERATING') return 2
  if (status === 'VIDEO_GENERATING') return 3
  if (status === 'REVIEWING') return 4
  if (status === 'APPROVED') return 5
  return 0
}

export default function DirectorPanel({ sceneId }: { sceneId: string }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskId, setTaskId] = useState('')
  const [task, setTask] = useState<Task | null>(null)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastStatusRef = useRef('')
  const storyId = useSceneStore((s) =>
    s.objects.find((o) => String((o.data as Record<string, unknown>).objectType) === 'story')?.id,
  )

  const pushRunLog = (ok: boolean, message: string) => {
    useSceneStore.getState().pushLog({ ts: Date.now(), action: 'director_start', ok, message })
    // 同步到右侧「运行日志」抽屉（两个画布共用）
    emitLog({
      nodeId: '', nodeLabel: '导演台', nodeType: 'director',
      status: ok ? 'completed' : 'failed',
      message: `导演台：${message}`,
    })
  }

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const loadTask = useCallback(async (tid: string) => {
    const res = await directorTaskGet(tid)
    if (res.ok && res.data?.task) {
      const t = res.data.task as Task
      setTask(t)
      // 状态终态变化 → 同步一条运行日志（历史页签可见）
      const terminal = ['REVIEWING', 'APPROVED', 'FAILED'].includes(t.status)
      if (terminal && lastStatusRef.current !== t.status) {
        lastStatusRef.current = t.status
        pushRunLog(
          t.status !== 'FAILED',
          t.status === 'FAILED'
            ? `导演排片失败：${String(((t.log || []).slice(-1)[0] as { message?: string } | undefined)?.message ?? t.current_step)}`
            : `导演排片${t.status === 'APPROVED' ? '完成' : '完成，待审核'}（${t.progress}%）`,
        )
      }
      return t
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = useCallback(async () => {
    const res = await directorTasks(sceneId)
    if (res.ok && Array.isArray(res.data?.tasks) && res.data.tasks.length) {
      setTasks(res.data.tasks)
      const latest = res.data.tasks[0] as Task
      setTaskId(latest.id)
      const t = await loadTask(latest.id)
      if (t && ['REVIEWING', 'APPROVED', 'FAILED'].includes(t.status)) stopPoll()
      else startPoll(latest.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId])

  const startPoll = useCallback((tid: string) => {
    stopPoll()
    pollRef.current = setInterval(async () => {
      const t = await loadTask(tid)
      if (t && ['REVIEWING', 'APPROVED', 'FAILED'].includes(t.status)) stopPoll()
    }, 2500)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void refresh()
    return stopPoll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId])

  const start = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await directorCreate({ scene_id: sceneId, story_id: storyId || '' })
      if (res.ok && res.data?.task_id) {
        lastStatusRef.current = ''
        pushRunLog(true, '导演排片已启动（故事→资产→分镜→审核）')
        setTaskId(res.data.task_id)
        await loadTask(res.data.task_id)
        startPoll(res.data.task_id)
      } else {
        pushRunLog(false, String(res.data?.error || '导演排片启动失败'))
      }
    } finally {
      setBusy(false)
    }
  }

  const genVideo = async () => {
    if (!taskId || busy) return
    setBusy(true)
    try {
      await directorTaskVideo(taskId)
      setTimeout(() => void refresh(), 1500)
    } finally {
      setBusy(false)
    }
  }

  const idx = task ? statusIndex(task.status) : -1
  const failed = task?.status === 'FAILED'
  const shots = task?.result?.shots || []
  const assets = task?.result?.assets || {}
  const videos = task?.result?.videos || []

  return (
    <div className="space-y-3">
      {/* 头部操作 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Clapperboard size={14} className="text-brand-400" />
          AI 导演台
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className="flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-1.5 text-[11px] text-white transition hover:bg-brand-600 disabled:opacity-40"
            disabled={busy}
            onClick={() => void start()}
            title="一键排片：故事→资产→分镜→(视频)→审核"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            一键排片
          </button>
          <button
            className="flex items-center gap-1 rounded-lg border border-edge bg-canvas px-2.5 py-1.5 text-[11px] text-ink-2 transition hover:text-ink disabled:opacity-40"
            disabled={busy || !taskId || !shots.length}
            onClick={() => void genVideo()}
            title="对已生成的分镜批量生成视频（需配置视频 Provider）"
          >
            <Film size={11} />
            生成视频
          </button>
          <button
            className="rounded-lg border border-edge bg-canvas p-1.5 text-ink-2 transition hover:text-ink"
            onClick={() => void refresh()}
            title="刷新任务"
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {/* 最近任务选择 */}
      {tasks.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          {tasks.map((t) => (
            <button
              key={t.id}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                t.id === taskId ? 'border-brand-500 text-brand-300' : 'border-edge text-ink-3 hover:text-ink'
              }`}
              onClick={() => { setTaskId(t.id); void loadTask(t.id) }}
            >
              {t.status} · {t.progress}%
            </button>
          ))}
        </div>
      )}

      {!task ? (
        <div className="py-6 text-center text-[11px] text-ink-3">
          还没有导演任务。点「一键排片」：AI 自动从故事生成资产、分镜、（可选）视频，最后人工审核。
          {!storyId && '（场景里还没有剧情节点，请先放一个剧情节点并生成故事）'}
        </div>
      ) : (
        <>
          {/* 状态机步骤条 */}
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => {
              const done = i < idx || task.status === 'APPROVED'
              const active = i === idx && !failed
              return (
                <div key={s.key} className="flex flex-1 flex-col items-center gap-0.5">
                  <div
                    className={`flex h-5 w-full items-center justify-center rounded-full text-[9px] font-medium transition ${
                      failed && i === idx ? 'bg-red-500/20 text-red-400'
                      : done ? 'bg-emerald-500/20 text-emerald-400'
                      : active ? 'bg-brand-500/25 text-brand-300'
                      : 'bg-soft text-ink-3'
                    }`}
                    title={s.key}
                  >
                    {done ? <Check size={9} /> : active ? <Loader2 size={9} className="animate-spin" /> : i + 1}
                  </div>
                  <span className="text-[9px] text-ink-3">{s.label}</span>
                </div>
              )
            })}
          </div>

          {/* 进度条 */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-soft">
            <div
              className={`h-full rounded-full transition-all ${failed ? 'bg-red-500' : 'bg-brand-500'}`}
              style={{ width: `${task.progress || 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-ink-3">
            <span>{task.current_step || task.status}</span>
            <span>{failed ? '失败' : `${task.progress || 0}%`}</span>
          </div>

          {/* 步骤日志 */}
          {(task.log || []).length > 0 && (
            <div className="max-h-28 space-y-0.5 overflow-y-auto rounded-lg border border-edge bg-canvas p-2">
              {(task.log || []).map((l, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10px]">
                  <span className={`mt-0.5 h-1 w-1 shrink-0 rounded-full ${l.message?.includes('失败') ? 'bg-red-400' : 'bg-emerald-400'}`} />
                  <span className="min-w-0 break-words text-ink-2">{l.message || ''}</span>
                </div>
              ))}
            </div>
          )}

          {/* 审核区：资产 */}
          {Object.keys(assets).length > 0 && (
            <div className="rounded-lg border border-edge bg-canvas p-2">
              <div className="mb-1 text-[10px] font-semibold text-ink-2">资产（已同步到画布）</div>
              <div className="flex flex-wrap gap-1.5">
                {(['characters', 'scenes', 'props'] as const).map((k) => (
                  <span key={k} className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-2">
                    {k === 'characters' ? '角色' : k === 'scenes' ? '场景' : '道具'} {Array.isArray(assets[k]) ? assets[k]!.length : 0}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 审核区：分镜表 */}
          {shots.length > 0 && (
            <div className="rounded-lg border border-edge bg-canvas p-2">
              <div className="mb-1.5 text-[10px] font-semibold text-ink-2">分镜审核（{shots.length}）</div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
                {shots.map((s, i) => {
                  const sb = (s || {}) as Record<string, unknown>
                  return (
                    <div key={i} className="rounded-md border border-edge bg-soft/50 p-1.5">
                      <div className="flex flex-wrap items-center gap-1 text-[9px] text-ink-2">
                        <span className="rounded bg-brand-500/15 px-1 py-0.5 font-semibold text-brand-300">镜头 {String(sb.shot_no ?? i + 1)}</span>
                        {Boolean(sb.duration) && <span className="rounded bg-soft px-1 py-0.5">{String(sb.duration)}s</span>}
                        {Boolean(sb.shot_size) && <span className="rounded bg-soft px-1 py-0.5">景别 {String(sb.shot_size)}</span>}
                        {Boolean(sb.camera_motion) && <span className="rounded bg-soft px-1 py-0.5">运镜 {String(sb.camera_motion)}</span>}
                        {Boolean(sb.lighting) && <span className="rounded bg-soft px-1 py-0.5">光 {String(sb.lighting)}</span>}
                      </div>
                      {Boolean(sb.description) && (
                        <div className="mt-1 break-words text-[10px] leading-relaxed text-ink-2">{String(sb.description)}</div>
                      )}
                      {Boolean(sb.dialogue) && (
                        <div className="mt-0.5 rounded bg-soft px-1 py-0.5 text-[9px] text-ink-3">对白：{String(sb.dialogue)}</div>
                      )}
                      {Boolean(sb.prompt) && (
                        <div className="mt-0.5 line-clamp-2 break-words text-[9px] text-ink-3">提示词：{String(sb.prompt)}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 审核区：视频 */}
          {videos.length > 0 && (
            <div className="rounded-lg border border-edge bg-canvas p-2">
              <div className="mb-1 text-[10px] font-semibold text-ink-2">视频（{videos.length} 条，已同步到画布）</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
