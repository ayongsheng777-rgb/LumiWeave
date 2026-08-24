import { useEffect, useState } from 'react'
import { getKbList, kbAdd, kbAddSource, kbSearch, kbSync } from '../api'

interface Knowledge {
  id: string
  source: string
  title: string
  content: string
  created_at: string
}

interface Source {
  id: string
  kind: string
  uri: string
  status: string
  last_sync: string
}

interface SearchResult {
  title: string
  content: string
  score: number
}

export default function KnowledgePanel() {
  const [knowledge, setKnowledge] = useState<Knowledge[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [count, setCount] = useState(0)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)

  const load = async () => {
    const res = await getKbList()
    if (res.ok) {
      setKnowledge(res.data.knowledge || [])
      setSources(res.data.sources || [])
      setCount(res.data.count || 0)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setMessage('')
    const fd = new FormData(e.currentTarget)
    const title = String(fd.get('title') || '')
    const content = String(fd.get('content') || '')
    const res = await kbAdd(title, content)
    if (res.ok) {
      setMessage(`已添加知识条目 #${res.data.id}`)
      e.currentTarget.reset()
      await load()
    } else {
      setMessage(res.data.error || '添加失败')
    }
  }

  const handleAddSource = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setMessage('')
    const fd = new FormData(e.currentTarget)
    const kind = String(fd.get('kind') || 'markdown')
    const uri = String(fd.get('uri') || '')
    const res = await kbAddSource(kind, uri)
    if (res.ok) {
      setMessage(`来源已添加，同步 ${res.data.blocks} 个知识块`)
      e.currentTarget.reset()
      await load()
    } else {
      setMessage(res.data.error || '添加来源失败')
    }
  }

  const handleSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    const res = await kbSearch(query)
    setSearching(false)
    if (res.ok) setResults(res.data.results || [])
  }

  const handleSync = async () => {
    setMessage('')
    const res = await kbSync()
    if (res.ok) {
      setMessage(`同步完成，共 ${res.data.synced_blocks} 个知识块`)
      await load()
    } else {
      setMessage('同步失败')
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>知识库（Prompt RAG）</h2>
        <span className="muted">共 {count} 条知识 · {sources.length} 个来源</span>
      </div>
      {message && <div className="message">{message}</div>}

      <div className="kb-search">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="语义检索知识库，回车搜索"
        />
        <button onClick={handleSearch} disabled={searching}>
          {searching ? '检索中…' : '搜索'}
        </button>
      </div>

      {results.length > 0 && (
        <div className="kb-results">
          <h4>检索结果</h4>
          {results.map((r, i) => (
            <div key={i} className="kb-result-item">
              <div className="kb-result-head">
                <b>{r.title}</b>
                <span className="tag">相似度 {r.score.toFixed(3)}</span>
              </div>
              <p className="muted">{r.content}</p>
            </div>
          ))}
        </div>
      )}

      <div className="kb-grid">
        <section className="kb-col">
          <h3>知识条目</h3>
          <form onSubmit={handleAdd} className="kb-form">
            <input name="title" placeholder="标题" required />
            <textarea name="content" placeholder="知识内容（会被向量化，供对话检索注入）" rows={4} required />
            <button type="submit">添加知识</button>
          </form>
          <div className="kb-list">
            {knowledge.map((k) => (
              <div key={k.id} className="kb-item">
                <div className="kb-item-head">
                  <b>{k.title}</b>
                  <span className="badge">{k.source}</span>
                </div>
                <p className="muted">{k.content.length > 120 ? k.content.slice(0, 120) + '…' : k.content}</p>
              </div>
            ))}
            {knowledge.length === 0 && <div className="empty-box">暂无知识条目</div>}
          </div>
        </section>

        <section className="kb-col">
          <h3>知识来源</h3>
          <form onSubmit={handleAddSource} className="kb-form">
            <select name="kind" defaultValue="markdown">
              <option value="markdown">Markdown 文件/URL</option>
              <option value="github">GitHub 仓库</option>
              <option value="manual">手动</option>
            </select>
            <input name="uri" placeholder="路径或 URL" required />
            <button type="submit">添加来源</button>
          </form>
          <button onClick={handleSync} className="ghost">全量同步</button>
          <div className="kb-list">
            {sources.map((s) => (
              <div key={s.id} className="kb-item">
                <div className="kb-item-head">
                  <b>{s.kind}</b>
                  <span className="badge">{s.status}</span>
                </div>
                <p className="muted">{s.uri}</p>
              </div>
            ))}
            {sources.length === 0 && <div className="empty-box">暂无来源</div>}
          </div>
        </section>
      </div>
    </div>
  )
}
