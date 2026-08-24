import { useEffect, useRef, useState } from 'react'
import { agentChatStream, getAgentHealth, getAgents, getSkills } from '../api'

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

  const send = async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
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
            if (data.content && !acc) pushAssistant(String(data.content))
          } else if (type === 'error') {
            const err = String(data.message || '出错了')
            pushAssistant(acc ? `${acc}\n\n⚠️ ${err}` : `⚠️ ${err}`)
          } else if (type === 'agent_resolved') {
            pushAssistant(acc, String(data.agent ?? ''))
          }
        },
      )
    } catch (e) {
      pushAssistant(acc ? acc : `请求失败：${(e as Error).message}`)
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="chat-layout">
      <aside className="chat-side">
        <h3>智能体</h3>
        <button
          className={`agent-item ${selected === 'auto' ? 'active' : ''}`}
          onClick={() => setSelected('auto')}
        >
          <span className="agent-dot auto" />
          <span className="agent-name">自动路由</span>
        </button>
        {agents.map((a) => (
          <button
            key={a.id}
            className={`agent-item ${selected === a.id ? 'active' : ''}`}
            onClick={() => setSelected(a.id)}
          >
            <span className={`agent-dot ${health[a.id] ? 'ok' : 'bad'}`} />
            <span className="agent-name">{a.name}</span>
            <span className="agent-id">{a.id}</span>
          </button>
        ))}
        <div className="chat-options">
          <label>挂载技能</label>
          <select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            <option value="">（不挂载）</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={learnPrompt}
              onChange={(e) => setLearnPrompt(e.target.checked)}
            />
            启用知识库注入
          </label>
        </div>
      </aside>

      <section className="chat-main">
        <div className="chat-log">
          {messages.length === 0 && (
            <div className="chat-empty">
              <p>向智能体提问，开始你的创作</p>
              <p className="chat-empty-hint">
                已接入 {agents.length} 个智能体{skills.length > 0 ? `、${skills.length} 个技能` : ''}
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <div className="chat-bubble">
                {m.role === 'assistant' && m.agent && (
                  <div className="chat-agent-tag">{m.agent}</div>
                )}
                <pre className="chat-text">{m.content}</pre>
              </div>
            </div>
          ))}
          {streaming && <div className="chat-msg assistant"><div className="chat-bubble"><span className="typing">…</span></div></div>}
          <div ref={bottomRef} />
        </div>
        <div className="chat-input-bar">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows={3}
          />
          <button onClick={send} disabled={streaming || !input.trim()}>
            {streaming ? '生成中…' : '发送'}
          </button>
        </div>
      </section>
    </div>
  )
}
