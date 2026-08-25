import { useState } from 'react'
import { Wand2, Check, X } from 'lucide-react'
import { promptOptimize } from '../../api'
import { emitLog } from '../LogPanel'

// 提示词优化按钮：先检索知识库/技能库，命中则参考优化，无匹配 AI 自行理解生成。
// 优化结果先展示，用户点「采用」才回写提示词字段，不改变原文语种引用。
export function PromptOptimize({
  prompt,
  kind = 'image',
  model = '',
  nodeLabel = '',
  onApply,
}: {
  prompt: string
  kind?: string
  model?: string
  nodeLabel?: string
  onApply: (optimized: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ optimized: string; source: string } | null>(null)
  const [error, setError] = useState('')

  const run = async () => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError('')
    setResult(null)
    emitLog({ nodeId: '', nodeLabel: nodeLabel || '提示词优化', nodeType: 'prompt', status: 'running', message: '提示词优化中（先查知识库/技能库，无匹配再 AI）…' })
    try {
      const res = await promptOptimize({ prompt, kind, model })
      const data = res.data as Record<string, unknown> | undefined
      if (res.ok && data?.ok) {
        const optimized = String(data.optimized || '')
        const source = String(data.source || 'ai')
        setResult({ optimized, source })
        emitLog({ nodeId: '', nodeLabel: nodeLabel || '提示词优化', nodeType: 'prompt', status: 'completed', message: `优化完成 · 来源 ${source}` })
      } else {
        const err = String(data?.error || '优化失败')
        setError(err)
        emitLog({ nodeId: '', nodeLabel: nodeLabel || '提示词优化', nodeType: 'prompt', status: 'failed', message: `优化失败 · ${err.slice(0, 60)}` })
      }
    } catch (e) {
      setError(String(e))
      emitLog({ nodeId: '', nodeLabel: nodeLabel || '提示词优化', nodeType: 'prompt', status: 'failed', message: `优化失败 · ${String(e).slice(0, 60)}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        className="nodrag flex items-center gap-1.5 rounded-lg border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-[11px] text-brand-400 transition hover:bg-brand-500/20 disabled:opacity-40"
        onClick={run}
        disabled={busy || !prompt.trim()}
        title="基于技能库/知识库优化提示词"
      >
        <Wand2 size={12} />
        {busy ? '优化中…' : '提示词优化'}
      </button>

      {error && <div className="mt-1.5 rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-400">{error}</div>}

      {result && (
        <div className="mt-1.5 rounded border border-brand-500/25 bg-brand-500/10 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-ink-3">
              优化结果（{result.source === 'kb' ? '知识库' : result.source === 'skill' ? '技能库' : 'AI 理解'}）
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className="nodrag flex items-center gap-0.5 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] text-white transition hover:bg-brand-500"
                onClick={() => { onApply(result.optimized); setResult(null) }}
              >
                <Check size={10} /> 采用
              </button>
              <button
                type="button"
                className="nodrag rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-2 transition hover:bg-soft/80"
                onClick={() => setResult(null)}
              >
                <X size={10} />
              </button>
            </div>
          </div>
          <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed text-ink-2">
            {result.optimized}
          </div>
        </div>
      )}
    </div>
  )
}
