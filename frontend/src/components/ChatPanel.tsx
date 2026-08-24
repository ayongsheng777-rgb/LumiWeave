import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bot, Send } from 'lucide-react'
import { agentChatStream, getAgentHealth, getAgents, getSkills } from '../api'
import { useCanvasStore } from '../store/canvasStore'
import { useLayoutStore } from '../store/layoutStore'

interface Agent {
  id: string
  name: string
}
interface Skill {
  id: string
  name: string
  description: string
}
interface Msg {
  role: 'user' | 'assistant'
  content: string
  agent?: string
}

export default function ChatPanel() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [health, setHealth] = useState<Record<string, boolean | null>>({})
  const [selected, setSelected] = useState('auto')
  const [skillId, setSkillId] = useState('')
  const [learnPrompt, setLearnPrompt] = useState(true)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const load = async () => {
    const [aRes, sRes] = await Promise.all([getAgents(), getSkills()])
    if (aRes.ok) {
      setAgents(aRes.data.agents || [])
      aRes.data.agents?.forEach(async (a: Agent) => {
        const hRes = await getAgentHealth(a.id)
        if (hRes.ok) setHealth((prev) => ({ ...prev, [a.id]: hRes.data.healthy }))
      })
    }
    if (sRes.ok) setSkills(sRes.data.skills || [])
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const nextCanvasPos = () => {
    const n = useCanvasStore.getState().objects.length
    return { x: 80 + (n % 5) * 40, y: 80 + (n % 6) * 40 }
  }

  const dropToCanvas = (text: string) => {
    const store = useCanvasStore.getState()
    const node = store.addObject('ai_result', nextCanvasPos())
    store.updateObject(node.id, { text, kind: 'text' })
  }

  const ejectToCanvas = (text: string) => {
    const store = useCanvasStore.getState()
    const node = store.addObject('prompt', nextCanvasPos())
    store.updateObject(node.id, { text })
    useLayoutStore.getState().setCanvasOpen(true)
  }

  const send = async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    setStreaming(true)
    setMessages((prev) => [...prev, { role: 'user', content: text }])

    let acc = ''
    const pushAssistant = (content: string, agent?: string) => {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.role === 'assistant') {
          last.content = content
          if (agent) last.agent = agent
        } else {
          next.push({ role: 'assistant', content, agent })
        }
        return next
      })
    }

    try {
      await agentChatStream(
        { message: text, agent_id: selected, skill_id: skillId || undefined, learn_prompt: learnPrompt },
        (type, data) => {
          if (type === 'token') {
            acc += String(data.text ?? '')
            pushAssistant(acc)
          } else if (type === 'done') {
            const finalContent = String(data.content ?? '')
            if (finalContent) {
              acc = finalContent
              pushAssistant(acc)
            }
          } else if (type === 'error') {
            const err = String(data.message || '出错了')
            pushAssistant(acc ? `${acc}\n\n⚠️ ${err}` : `⚠️ ${err}`)
          } else if (type === 'agent_resolved') {
            pushAssistant(acc, String(data.agent ?? ''))
          }
        },
      )
      const finalText = acc.trim()
      if (finalText) dropToCanvas(finalText)
    } catch (e) {
      pushAssistant(acc ? acc : `请求失败：${(e as Error).message}`)
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部：智能体 + 技能 + 知识库（紧凑横条，不占对话宽度） */}
      <div className="shrink-0 space-y-2 border-b border-edge bg-panel-2 p-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-ink-3">智能体</span>
          <div className="flex flex-1 flex-wrap gap-1">
            <button
              onClick={() => setSelected('auto')}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition ${
                selected === 'auto' ? 'bg-brand-500/20 text-brand-200' : 'text-ink-2 hover:bg-soft'
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
              自动路由
            </button>
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelected(a.id)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition ${
                  selected === a.id ? 'bg-brand-500/20 text-brand-200' : 'text-ink-2 hover:bg-soft'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${health[a.id] ? 'bg-status-completed' : 'bg-status-failed'}`} />
                {a.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-ink-3">技能</span>
          <select
            value={skillId}
            onChange={(e) => setSkillId(e.target.value)}
            className="flex-1 rounded-lg border border-edge bg-input px-2 py-1 text-xs text-ink outline-none focus:border-brand-500"
          >
            <option value="">（不挂载技能）</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-2">
            <input
              type="checkbox"
              checked={learnPrompt}
              onChange={(e) => setLearnPrompt(e.target.checked)}
              className="accent-brand-500"
            />
            知识库
          </label>
        </div>
      </div>

      {/* 对话主区 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {messages.length === 0 && (
            <div className="mt-10 text-center text-sm text-ink-3">
              <Bot size={28} className="mx-auto mb-2 text-ink-3" />
              <p>向智能体提问，开启你的创作</p>
              <p className="mt-1 text-[11px] text-ink-3">
                已接入 {agents.length} 个智能体{skills.length > 0 ? `、${skills.length} 个技能` : ''}
              </p>
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
                {m.role === 'assistant' && m.agent && (
                  <div className="mb-1 text-[11px] text-brand-300">@{m.agent}</div>
                )}
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
                // 多行自动撑开：先归位再按内容高度重设（封顶 ~220px）
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
