import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bot, Send, X } from 'lucide-react'
import { aiChat } from '../api'
import { useUiStore } from '../store/uiStore'
import { usePvStore } from '../pv/store'
import { PV_NODE_TEMPLATES } from '../pv/registry'
import type { PvNodeData } from '../pv/types'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const setChatOpen = useUiStore((s) => s.setChatOpen)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const nextCanvasPos = () => {
    const n = usePvStore.getState().nodes.length
    return { x: 80 + (n % 5) * 40, y: 80 + (n % 6) * 40 }
  }

  /** 往通用画布丢一个文本便签（AI 回答落盘，方便用户拖去当提示词） */
  const addTextNode = (text: string) => {
    const tpl = PV_NODE_TEMPLATES.find((t) => t.kind === 'text')
    if (!tpl) return
    const id = usePvStore.getState().addFromTemplate(tpl, nextCanvasPos())
    usePvStore.getState().updateNodeData(id, { text } as Partial<PvNodeData>)
  }

  const dropToCanvas = (text: string) => {
    addTextNode(text)
  }

  const ejectToCanvas = (text: string) => {
    addTextNode(text)
  }

  const send = async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    setStreaming(true)
    setMessages((prev) => [...prev, { role: 'user', content: text }])

    try {
      // 带上最近几轮对话，让 AI 能多轮追问关键配置（而不是直接假设）
      const history = messages.slice(-6).map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`).join('\n')
      const fullUser = history ? `${history}\n用户：${text}` : text
      const res = await aiChat({
        system: '你是绵绣 LumiWeave 平台的 AI 创作助手，帮用户完成文案、提示词、创意构思等创作任务。'
          + '重要：当用户要「生成视频」时，先询问并确认三件事——①生视频模式（文生视频 / 首帧生视频 / 多参考生视频）；②首帧图或多参考图用哪些（角色图/场景图/道具图）。'
          + '当用户要「生成图片/角色/道具/场景」时，先询问是否需要「无背景」和「多视角（三视图/四视图）」。'
          + '拿到用户明确答复后再给出配置建议，不要擅自假设参数。回答简洁实用。',
        user: fullUser,
        scenario: 'chat',
      })
      if (res.ok) {
        const content = String(res.data.result ?? '')
        setMessages((prev) => [...prev, { role: 'assistant', content }])
        if (content) dropToCanvas(content)
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${res.data.error || '调用失败'}` }])
      }
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `请求失败：${(e as Error).message}` }])
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 面板头部：标题 + 隐藏按钮 */}
      <div className="flex shrink-0 items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-sm font-medium text-ink">AI 助手</span>
        <button
          onClick={() => setChatOpen(false)}
          title="隐藏面板"
          className="rounded p-1 text-ink-3 transition hover:bg-hover hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
      {/* 对话主区 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {messages.length === 0 && (
            <div className="mt-10 text-center text-sm text-ink-3">
              <Bot size={28} className="mx-auto mb-2 text-ink-3" />
              <p>向 AI 提问，开启你的创作</p>
              <p className="mt-1 text-[11px] text-ink-3">回答会自动落到画布，也可手动「展开到画布」</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === 'user'
                    ? 'bg-brand-600 text-white'
                    : 'border border-edge bg-soft text-ink'
                }`}
              >
                {m.role === 'assistant' ? (
                  <div className="md-body leading-relaxed">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-sans">{m.content}</pre>
                )}
                {m.role === 'user' && (
                  <button onClick={() => ejectToCanvas(m.content)} className="mt-1 text-[11px] text-brand-200 underline">
                    → 展开到画布
                  </button>
                )}
              </div>
            </div>
          ))}
          {streaming && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-edge bg-soft px-3 py-2 text-sm text-ink-2">
                生成中…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-edge p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 220) + 'px'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                  if (inputRef.current) inputRef.current.style.height = 'auto'
                }
              }}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              rows={4}
              className="flex-1 resize-none overflow-y-auto rounded-xl border border-edge bg-input px-3 py-2.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
            />
            <button
              onClick={send}
              disabled={streaming || !input.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white transition hover:bg-brand-500 disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
