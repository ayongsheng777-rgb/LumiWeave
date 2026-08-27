// =====================================================================
// SceneFieldPopover —— 专业场景对象「文本类字段」内嵌 AI 对话弹窗（仿京东云灵镜）
// 交互：点节点上该字段的文本框本身 → 在框体正下方弹出独立 AI 对话窗
//       （portal 到 body，绝对定位，不被节点 overflow 裁剪）
// 能力：AI 模型下拉（已配置平台）、总时长/分镜个数/分镜时长(自动算)、
//       多轮对话（前端拼接历史）、结果写回 sceneStore 对应字段
// 说明：后端 /ai/chat 为单轮，多轮靠前端维护 messages 并拼入 user 文本，不改动后端。
// =====================================================================
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X, Send } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { aiChat, getProfiles } from '../api'

type AnyObj = Record<string, unknown>
interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

/** 不同字段类型的系统提示词 */
const SYSTEM: Record<string, string> = {
  text: '你是内容生成助手，按要求生成内容，直接输出结果，不要多余解释。',
  script: '你是专业编剧。按用户要求创作：三幕结构、出场元素、分场景大纲、情绪曲线，输出结构清晰的内容。',
}

/**
 * @param objectId  专业场景对象 id（node.id）
 * @param fieldKey  要编辑的字段名（payload 内的键，如 text / prompt / description）
 * @param label     字段中文标签（用于占位提示）
 * @param kind      决定系统提示词：text=通用内容，script=剧本类
 */
export default function SceneFieldPopover({
  objectId,
  fieldKey,
  label,
  kind = 'text',
}: {
  objectId: string
  fieldKey: string
  label: string
  kind?: 'text' | 'script'
}) {
  const patchObject = useSceneStore((s) => s.patchObject)
  const obj = useSceneStore((s) => s.objects.find((o) => o.id === objectId))
  const payload = ((obj?.data as AnyObj)?.payload || {}) as AnyObj

  const value = String(payload[fieldKey] ?? '')
  const profileId = String(payload.profile_id ?? '')
  const duration = Number(payload.duration) || 0
  const shotCount = Number(payload.shotCount) || 0
  const chatHistory: ChatMsg[] = Array.isArray(payload.chatHistory)
    ? (payload.chatHistory as ChatMsg[])
    : []

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [profiles, setProfiles] = useState<{ id: string; name?: string; model?: string }[]>([])
  const [msgs, setMsgs] = useState<ChatMsg[]>(chatHistory)
  const [input, setInput] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const anchorRef = useRef<HTMLTextAreaElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getProfiles()
      .then((r) => {
        if (r.ok)
          setProfiles(((r.data as AnyObj)?.profiles as { id: string; name?: string; model?: string }[]) || [])
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

  /** 拼接多轮上下文：已有内容/要求 + 参数 + 历史对话 + 本轮补充 */
  const buildUser = (extra: string) => {
    const parts: string[] = []
    if (value) parts.push(`【已有内容 / 要求】${value}`)
    if (duration > 0) parts.push(`总时长约 ${duration} 秒`)
    if (shotCount > 0)
      parts.push(
        `分镜个数 ${shotCount} 个${duration > 0 ? `（每段约 ${(duration / shotCount).toFixed(1)} 秒）` : ''}`,
      )
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
        profile_id: profileId,
        scenario: 'general',
      })
      const out = res.ok
        ? String((res.data as AnyObj)?.result ?? '')
        : `生成失败：${JSON.stringify((res.data as AnyObj)?.error ?? '未知错误')}`
      const after = [...next, { role: 'assistant' as const, content: out }]
      setMsgs(after)
      // 写回该字段 + 持久化对话历史
      patchObject(objectId, { [fieldKey]: out, chatHistory: after })
    } catch (e) {
      const after = [...next, { role: 'assistant' as const, content: `请求失败：${String(e)}` }]
      setMsgs(after)
    } finally {
      setBusy(false)
    }
  }

  const per = duration > 0 && shotCount > 0 ? (duration / shotCount).toFixed(1) : '—'

  return (
    <>
      {/* 文本框本体：点它展开下方 AI 对话窗 */}
      <textarea
        ref={anchorRef}
        className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
        rows={3}
        placeholder={`${label}（点击用 AI 对话生成）`}
        value={value}
        onChange={(e) => patchObject(objectId, { [fieldKey]: e.target.value })}
        onClick={() => {
          if (!open) openChat()
        }}
      />

      {open && pos
        ? createPortal(
            <div
              ref={boxRef}
              className="fixed z-[9999] flex w-[360px] flex-col overflow-hidden rounded-xl border border-edge bg-panel-2 text-[11px] shadow-2xl"
              style={{ top: pos.top, left: pos.left, maxHeight: '72vh' }}
            >
              {/* 头部 */}
              <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
                <span className="text-sm font-medium text-ink">✨ AI 助手</span>
                <span className="text-[11px] text-ink-3">多轮对话 · 仿灵镜</span>
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
                  <div className="mb-1 text-[11px] text-ink-3">AI 模型</div>
                  <select
                    className="nodrag nowheel w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
                    value={profileId}
                    onChange={(e) => patchObject(objectId, { profile_id: e.target.value })}
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
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-ink-3">总时长（秒）</span>
                    <input
                      type="number"
                      className="nodrag nowheel w-full rounded-md border border-edge bg-input px-2 py-1 text-sm text-ink outline-none focus:border-brand-500"
                      value={duration || ''}
                      onChange={(e) => patchObject(objectId, { duration: Number(e.target.value) })}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-ink-3">分镜个数</span>
                    <input
                      type="number"
                      className="nodrag nowheel w-full rounded-md border border-edge bg-input px-2 py-1 text-sm text-ink outline-none focus:border-brand-500"
                      value={shotCount || ''}
                      onChange={(e) => patchObject(objectId, { shotCount: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <div className="text-[11px] text-ink-3">
                  分镜时长：每段约 <b className="text-ink">{per}</b> 秒（总时长 ÷ 分镜个数）
                </div>
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
                      className={`max-w-[90%] rounded-lg px-2 py-1.5 text-sm leading-relaxed ${
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
                  className="nodrag nowheel flex-1 resize-none rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
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
                  className="nodrag shrink-0 rounded-md bg-brand-600 px-3 py-2 text-sm text-white transition hover:bg-brand-500 disabled:opacity-50"
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
