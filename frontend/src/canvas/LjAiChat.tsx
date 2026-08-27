// =====================================================================
// LjAiChat —— 灵境节点内嵌 AI 对话弹窗（仿京东云灵镜平台）
// 交互：点节点上的「内容要求」文本框本身 → 在框体正下方弹出独立 AI 对话窗
//       （portal 到 body，绝对定位，不被节点 overflow 裁剪）
// 能力：AI 模型下拉（已配置平台）、按 kind 可配置参数字段、
//       分镜时长自动算（总时长÷分镜个数）、多轮对话（前端拼接历史）
// 说明：后端 /ai/chat 为单轮，多轮靠前端维护 messages 并拼入 user 文本，不改动后端。
// =====================================================================
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X, Send } from 'lucide-react'
import { useCanvasStore } from '../store/canvasStore'
import { aiChat, getProfiles } from '../api'

type AnyObj = Record<string, unknown>
interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}
interface ParamDef {
  key: string
  label: string
}

/** 不同节点类型的参数字段（图片/视频/分镜后续按此结构扩展即可复用） */
const PARAM_DEFS: Record<string, ParamDef[]> = {
  text: [
    { key: 'duration', label: '总时长（秒）' },
    { key: 'shotCount', label: '分镜个数' },
  ],
  script: [
    { key: 'duration', label: '总时长（秒）' },
    { key: 'shotCount', label: '分镜个数' },
  ],
}

/** 不同节点类型的系统提示词 */
const SYSTEM: Record<string, string> = {
  text: '你是内容生成助手，按要求生成内容，直接输出结果，不要多余解释。',
  script: '你是专业编剧。按用户要求创作剧本：三幕结构、出场元素、分场景大纲、情绪曲线，输出结构清晰的内容。',
}

export default function LjAiChat({ nodeId, kind }: { nodeId: string; kind: 'text' | 'script' | string }) {
  const update = useCanvasStore((s) => s.updateObject)
  const data = useCanvasStore((s) => (s.objects.find((o) => o.id === nodeId)?.data ?? {}) as AnyObj)

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [profiles, setProfiles] = useState<{ id: string; name?: string; model?: string }[]>([])
  const [msgs, setMsgs] = useState<ChatMsg[]>(() =>
    Array.isArray(data.chatHistory) ? (data.chatHistory as ChatMsg[]) : [],
  )
  const [input, setInput] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const anchorRef = useRef<HTMLTextAreaElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const prompt = String(data.prompt ?? '')
  const params = PARAM_DEFS[kind] ?? []
  const hasShot = params.some((p) => p.key === 'duration') && params.some((p) => p.key === 'shotCount')

  useEffect(() => {
    getProfiles()
      .then((r) => {
        if (r.ok) setProfiles(((r.data as AnyObj)?.profiles as { id: string; name?: string; model?: string }[]) || [])
      })
      .catch(() => {})
  }, [])

  // 关闭逻辑：点弹窗外 / Esc / 页面滚动
  useEffect(() => {
    if (!open) return
    const onScroll = () => setOpen(false)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (boxRef.current && boxRef.current.contains(t)) return
      if (anchorRef.current && anchorRef.current.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 对话历史自动滚到底
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [msgs, busy])

  const openChat = () => {
    const el = anchorRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      setPos({ top: r.bottom + 8, left: r.left })
    }
    setOpen(true)
  }

  /** 拼接多轮上下文：内容要求 + 参数 + 历史对话 + 本轮补充 */
  const buildUser = (extra: string) => {
    const dur = Number(data.duration) || 0
    const sc = Number(data.shotCount) || 0
    const parts: string[] = []
    if (prompt) parts.push(`【内容要求】${prompt}`)
    if (dur > 0) parts.push(`总时长约 ${dur} 秒`)
    if (sc > 0) parts.push(`分镜个数 ${sc} 个${dur > 0 ? `（每段约 ${(dur / sc).toFixed(1)} 秒）` : ''}`)
    msgs.forEach((m) => parts.push(`${m.role === 'user' ? '用户' : 'AI'}：${m.content}`))
    if (extra) parts.push(`【本轮补充】${extra}`)
    return parts.join('\n')
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    const next = [...msgs, { role: 'user' as const, content: text }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    try {
      const res = await aiChat({
        system: SYSTEM[kind] ?? SYSTEM.text,
        user: buildUser(text),
        profile_id: String(data.profile_id ?? ''),
        scenario: 'general',
      })
      const out = res.ok
        ? String((res.data as AnyObj)?.result ?? '')
        : `生成失败：${JSON.stringify((res.data as AnyObj)?.error ?? '未知错误')}`
      const after = [...next, { role: 'assistant' as const, content: out }]
      setMsgs(after)
      update(nodeId, { text: out, chatHistory: after })
    } catch (e) {
      const after = [...next, { role: 'assistant' as const, content: `请求失败：${String(e)}` }]
      setMsgs(after)
    } finally {
      setBusy(false)
    }
  }

  const dur = Number(data.duration) || 0
  const sc = Number(data.shotCount) || 0
  const per = dur > 0 && sc > 0 ? (dur / sc).toFixed(1) : '—'

  return (
    <>
      {/* 文本框本体：点它展开下方 AI 对话窗 */}
      <textarea
        ref={anchorRef}
        className="nodrag nowheel w-full rounded-md border border-edge bg-input px-2 py-1.5 text-[11px] leading-relaxed text-ink outline-none focus:border-brand-500"
        rows={3}
        placeholder={
          kind === 'script'
            ? '剧本 brief，如：末日荒原科幻短片，45s，史诗感'
            : '内容要求，如：运动水杯短剧带货，突出防漏耐摔、单手开盖'
        }
        value={prompt}
        onChange={(e) => update(nodeId, { prompt: e.target.value })}
        onClick={() => {
          if (!open) openChat()
        }}
      />

      {open && pos
        ? createPortal(
            <div
              ref={boxRef}
              className="fixed z-[9999] flex w-[360px] flex-col overflow-hidden rounded-xl border border-edge bg-panel-2 shadow-2xl"
              style={{ top: pos.top, left: pos.left, maxHeight: '72vh' }}
            >
              {/* 头部 */}
              <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
                <span className="text-xs font-medium text-ink">✨ AI 助手</span>
                <span className="text-[10px] text-ink-3">多轮对话 · 仿灵镜</span>
                <button
                  className="nodrag ml-auto rounded p-1 text-ink-3 transition hover:text-ink"
                  onClick={() => setOpen(false)}
                >
                  <X size={14} />
                </button>
              </div>

              {/* 模型 + 参数 */}
              <div className="space-y-2 border-b border-edge px-3 py-2">
                <div>
                  <div className="mb-1 text-[10px] text-ink-3">AI 模型</div>
                  <select
                    className="nodrag nowheel w-full rounded-md border border-edge bg-input px-2 py-1.5 text-[11px] text-ink outline-none focus:border-brand-500"
                    value={String(data.profile_id ?? '')}
                    onChange={(e) => update(nodeId, { profile_id: e.target.value })}
                  >
                    <option value="">默认模型（系统自动选）</option>
                    {profiles.map((p) =>
                      p && p.id ? (
                        <option key={p.id} value={p.id}>
                          {String(p.name ?? p.id)}
                          {p.model ? ` · ${p.model}` : ''}
                        </option>
                      ) : null,
                    )}
                  </select>
                </div>
                {params.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {params.map((p) => (
                      <label key={p.key} className="block">
                        <span className="mb-1 block text-[10px] text-ink-3">{p.label}</span>
                        <input
                          type="number"
                          className="nodrag nowheel w-full rounded-md border border-edge bg-input px-2 py-1 text-[11px] text-ink outline-none focus:border-brand-500"
                          value={Number(data[p.key] ?? 0) || ''}
                          onChange={(e) => update(nodeId, { [p.key]: Number(e.target.value) })}
                        />
                      </label>
                    ))}
                  </div>
                )}
                {hasShot && (
                  <div className="text-[10px] text-ink-3">
                    分镜时长：每段约 <b className="text-ink">{per}</b> 秒（总时长 ÷ 分镜个数）
                  </div>
                )}
              </div>

              {/* 对话历史 */}
              <div ref={scrollRef} className="min-h-[90px] flex-1 space-y-2 overflow-y-auto px-3 py-2">
                {msgs.length === 0 ? (
                  <p className="text-[11px] text-ink-3">
                    在下方输入要求，与 AI 多轮对话生成内容。生成结果会自动填回节点。
                  </p>
                ) : (
                  msgs.map((m, i) => (
                    <div
                      key={i}
                      className={`max-w-[90%] rounded-lg px-2 py-1.5 text-[11px] leading-relaxed ${
                        m.role === 'user' ? 'ml-auto bg-brand-600 text-white' : 'bg-soft text-ink-2'
                      }`}
                    >
                      {m.content}
                    </div>
                  ))
                )}
                {busy && <div className="text-[11px] text-ink-3">生成中…</div>}
              </div>

              {/* 输入 */}
              <div className="flex items-end gap-2 border-t border-edge px-3 py-2">
                <textarea
                  className="nodrag nowheel flex-1 resize-none rounded-md border border-edge bg-input px-2 py-1.5 text-[11px] text-ink outline-none focus:border-brand-500"
                  rows={2}
                  placeholder="输入要求，回车发送（Shift+Enter 换行）"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                />
                <button
                  className="nodrag shrink-0 rounded-md bg-brand-600 px-3 py-2 text-xs text-white transition hover:bg-brand-500 disabled:opacity-50"
                  onClick={() => void send()}
                  disabled={busy}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
