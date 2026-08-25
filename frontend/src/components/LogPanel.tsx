import { useState, useEffect } from 'react'
import { X, ChevronRight, ChevronDown, Clock, AlertCircle, CheckCircle2, Loader2, Pin, PinOff } from 'lucide-react'

// =====================================================================
// 任务化日志总线
// 一次生成操作 = 一个「任务」，running → completed/failed 状态在同一条目上更新，
// 点任务展开可看该任务的详细步骤（steps）。完成/失败后图标停止转圈。
// =====================================================================

export type LogStepLevel = 'info' | 'success' | 'error'

export interface LogStep {
  time: number
  message: string
  level?: LogStepLevel
}

export interface LogTask {
  taskId: string
  nodeId: string
  nodeLabel: string
  nodeType: string
  status: 'running' | 'completed' | 'failed'
  message: string
  startedAt: number
  duration?: number
  steps: LogStep[]
}

// 旧单条日志类型（向后兼容导出）
export interface LogEntry {
  id: string
  time: Date
  nodeId: string
  nodeLabel: string
  nodeType: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  message: string
  detail?: string
  duration?: number
}

type TaskListener = (tasks: LogTask[]) => void
const taskListeners = new Set<TaskListener>()
let taskBuffer: LogTask[] = []
let taskSeq = 0
// nodeId+nodeType → 当前 running 任务的 taskId（用于 running→completed 合并）
const runningByNode = new Map<string, string>()

function notify() {
  const snap = taskBuffer.slice()
  taskListeners.forEach((l) => l(snap))
}

function upsert(task: LogTask) {
  const i = taskBuffer.findIndex((t) => t.taskId === task.taskId)
  if (i >= 0) taskBuffer[i] = task
  else taskBuffer = [task, ...taskBuffer]
  taskBuffer = taskBuffer.slice(0, 200)
  notify()
}

/** 新建一个 running 任务，返回 taskId */
export function startTask(entry: { nodeId: string; nodeLabel: string; nodeType: string; message: string }): string {
  const taskId = `t${Date.now().toString(36)}_${(taskSeq++).toString(36)}`
  upsert({
    taskId,
    nodeId: entry.nodeId,
    nodeLabel: entry.nodeLabel,
    nodeType: entry.nodeType,
    status: 'running',
    message: entry.message,
    startedAt: Date.now(),
    steps: [{ time: Date.now(), message: entry.message }],
  })
  return taskId
}

/** 追加一条步骤到任务 */
export function taskStep(taskId: string, message: string, level: LogStepLevel = 'info') {
  const t = taskBuffer.find((x) => x.taskId === taskId)
  if (!t || !message) return
  t.steps = [...t.steps, { time: Date.now(), message, level }]
  upsert(t)
}

/** 批量追加后端返回的结构化 logs 到任务步骤 */
export function taskLogs(taskId: string, logs: unknown) {
  if (!Array.isArray(logs)) return
  for (const l of logs) {
    const msg = (l as { message?: string }).message
    if (!msg) continue
    const isErr = (l as { step?: string }).step === 'error'
    taskStep(taskId, msg, isErr ? 'error' : 'info')
  }
}

/** 结束任务：running → completed/failed（图标随之停止转圈） */
export function taskEnd(taskId: string, status: 'completed' | 'failed', message: string, duration?: number) {
  const t = taskBuffer.find((x) => x.taskId === taskId)
  if (!t) return
  t.status = status
  t.message = message
  if (duration != null) t.duration = duration
  const level: LogStepLevel = status === 'failed' ? 'error' : 'success'
  t.steps = [...t.steps, { time: Date.now(), message, level }]
  upsert(t)
}

/** 兼容旧调用：单条日志。running 会登记到 runningByNode，随后的 completed/failed 合并结束该任务。 */
export function emitLog(entry: { nodeId: string; nodeLabel: string; nodeType: string; status: string; message: string; detail?: string; duration?: number }) {
  const key = `${entry.nodeId}|${entry.nodeType}`
  if (entry.status === 'running') {
    const taskId = startTask({ nodeId: entry.nodeId, nodeLabel: entry.nodeLabel, nodeType: entry.nodeType, message: entry.message })
    runningByNode.set(key, taskId)
    return
  }
  // completed / failed
  const taskId = runningByNode.get(key)
  if (taskId) {
    runningByNode.delete(key)
    taskEnd(taskId, entry.status === 'failed' ? 'failed' : 'completed', entry.message, entry.duration)
    if (entry.detail) taskStep(taskId, entry.detail, entry.status === 'failed' ? 'error' : 'info')
    return
  }
  // 无前置 running：作为独立已完成任务
  const t = startTask({ nodeId: entry.nodeId, nodeLabel: entry.nodeLabel, nodeType: entry.nodeType, message: entry.message })
  runningByNode.delete(key)
  taskEnd(t, entry.status === 'failed' ? 'failed' : 'completed', entry.message, entry.duration)
  if (entry.detail) taskStep(t, entry.detail, entry.status === 'failed' ? 'error' : 'info')
}

/** 兼容旧调用：把后端 logs 数组追加到对应节点的 running 任务步骤里 */
export function emitRenderLogs(logs: unknown, nodeId: string, nodeLabel: string, nodeType: string) {
  if (!Array.isArray(logs)) return
  const key = `${nodeId}|${nodeType}`
  const taskId = runningByNode.get(key)
  for (const l of logs) {
    const msg = (l as { message?: string }).message
    if (!msg) continue
    const isErr = (l as { step?: string }).step === 'error'
    if (taskId) taskStep(taskId, msg, isErr ? 'error' : 'info')
    else emitLog({ nodeId, nodeLabel, nodeType, status: 'running', message: msg })
  }
}

export function clearLogs() {
  taskBuffer = []
  runningByNode.clear()
  notify()
}

export function getTaskBuffer(): LogTask[] {
  return taskBuffer.slice()
}

export function subscribeTasks(l: TaskListener): () => void {
  taskListeners.add(l)
  return () => {
    taskListeners.delete(l)
  }
}

// =====================================================================
// LogPanel 渲染
// =====================================================================

function StatusIcon({ status }: { status: LogTask['status'] }) {
  if (status === 'running') return <Loader2 size={12} className="shrink-0 animate-spin text-blue-400" />
  if (status === 'completed') return <CheckCircle2 size={12} className="shrink-0 text-green-400" />
  return <AlertCircle size={12} className="shrink-0 text-red-400" />
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s 前`
  if (s < 3600) return `${Math.floor(s / 60)}m 前`
  return `${Math.floor(s / 3600)}h 前`
}

const FILTERS = ['all', 'running', 'completed', 'failed'] as const
const FILTER_LABEL: Record<string, string> = { all: '全部', running: '运行', completed: '完成', failed: '失败' }

export function LogPanel() {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [tasks, setTasks] = useState<LogTask[]>(() => getTaskBuffer())
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => subscribeTasks(setTasks), [])

  // 有 running 任务时自动弹出
  useEffect(() => {
    if (pinned) return
    if (tasks.some((t) => t.status === 'running')) setOpen(true)
  }, [tasks, pinned])

  const filtered = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter)
  const failedCount = tasks.filter((t) => t.status === 'failed').length
  const runningCount = tasks.filter((t) => t.status === 'running').length

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      {/* 触发按钮 */}
      <button
        className="fixed right-0 top-1/2 z-50 flex items-center gap-1 rounded-l-full bg-brand-600 px-2 py-3 text-xs text-white shadow-lg transition hover:bg-brand-500"
        style={{ transform: `translateY(-50%)${open ? ' translateX(300px)' : ''}` }}
        onClick={() => setOpen((v) => !v)}
        title="运行日志"
      >
        {open ? <X size={13} /> : <ChevronRight size={13} />}
        <span style={{ writingMode: 'vertical-rl' }}>日志</span>
        {runningCount > 0 && (
          <span className="absolute -top-1 -left-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-bold">
            {runningCount}
          </span>
        )}
        {failedCount > 0 && (
          <span className="absolute -bottom-1 -left-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold">
            {failedCount}
          </span>
        )}
      </button>

      {/* 面板 */}
      <div
        className="fixed right-0 top-0 z-40 flex h-full flex-col border-l border-edge bg-panel-2 shadow-xl transition-transform duration-300"
        style={{ width: 340, transform: open ? 'translateX(0)' : 'translateX(100%)' }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink">运行日志</span>
            <span className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-3">{tasks.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button className={`nodrag rounded p-1 transition ${pinned ? 'text-brand-400' : 'text-ink-3 hover:text-ink'}`} onClick={() => setPinned((v) => !v)} title={pinned ? '取消固定' : '固定面板'}>
              {pinned ? <PinOff size={12} /> : <Pin size={12} />}
            </button>
            <button className="nodrag rounded p-1 text-ink-3 hover:text-ink" onClick={clearLogs} title="清空日志">
              <X size={12} />
            </button>
            <button className="nodrag rounded p-1 text-ink-3 hover:text-ink" onClick={() => setOpen(false)}>
              <ChevronRight size={12} />
            </button>
          </div>
        </div>

        {/* 过滤器 */}
        <div className="flex shrink-0 gap-1 border-b border-edge px-3 py-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`nodrag rounded px-2 py-0.5 text-[10px] transition ${filter === f ? 'bg-brand-600 text-white' : 'bg-soft text-ink-3 hover:bg-soft/80'}`}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>

        {/* 任务列表 */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-ink-3">
              <Clock size={24} className="opacity-30" />
              <p className="text-xs">暂无日志</p>
            </div>
          )}
          {filtered.map((task) => {
            const isExpanded = expanded.has(task.taskId)
            return (
              <div
                key={task.taskId}
                className={`cursor-pointer border-b border-edge/50 transition hover:bg-soft/50 ${
                  task.status === 'failed' ? 'border-l-2 border-l-red-500' : task.status === 'completed' ? 'border-l-2 border-l-green-500' : 'border-l-2 border-l-blue-500'
                }`}
                onClick={() => toggleExpand(task.taskId)}
              >
                <div className="flex items-start gap-2 px-3 py-2">
                  <StatusIcon status={task.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-[11px] font-medium text-ink">{task.nodeLabel || task.nodeType}</span>
                      <span className="shrink-0 text-[9px] text-ink-3">{timeAgo(task.startedAt)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className={`truncate text-[10px] ${task.status === 'failed' ? 'text-red-400' : 'text-ink-3'}`}>{task.message}</span>
                      <span className="shrink-0 text-[9px] text-ink-3">
                        {task.duration != null && `${task.duration}ms · `}
                        {task.steps.length} 步
                      </span>
                    </div>
                  </div>
                  <ChevronDown size={12} className={`mt-0.5 shrink-0 text-ink-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>

                {/* 展开的详细步骤 */}
                {isExpanded && (
                  <div className="space-y-0.5 border-t border-edge/50 bg-input/40 px-3 py-1.5">
                    {task.steps.map((s, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[10px] leading-relaxed">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                        <span className={`whitespace-pre-wrap break-words ${s.level === 'error' ? 'text-red-400' : s.level === 'success' ? 'text-green-400' : 'text-ink-2'}`}>
                          {s.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
