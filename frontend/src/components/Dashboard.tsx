import { useState } from 'react'
import { logout } from '../api'
import ChatWorkspace from './ChatWorkspace'
import KnowledgePanel from './KnowledgePanel'
import ModelPanel from './ModelPanel'
import AssetPanel from './AssetPanel'
import RendererPanel from './RendererPanel'
import SkillPanel from './SkillPanel'
import TokenPanel from './TokenPanel'

interface DashboardProps {
  onLogout: () => void
}

type Tab = 'chat' | 'skills' | 'renderers' | 'kb' | 'model' | 'token' | 'assets'

const TABS: { key: Tab; label: string }[] = [
  { key: 'chat', label: '画布' },
  { key: 'skills', label: '技能库' },
  { key: 'renderers', label: '出图' },
  { key: 'kb', label: '知识库' },
  { key: 'model', label: '模型' },
  { key: 'assets', label: '素材' },
  { key: 'token', label: '计费' },
]

export default function Dashboard({ onLogout }: DashboardProps) {
  const [tab, setTab] = useState<Tab>('chat')

  const handleLogout = async () => {
    await logout()
    onLogout()
  }

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand">
          <img src="/logo.jpg" alt="logo" />
          <span>绵绣 LumiWeave</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'active' : ''}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
          <button className="logout" onClick={handleLogout}>
            退出
          </button>
        </nav>
      </header>
      <main className={tab === 'chat' ? 'content content-full' : 'content'}>
        {tab === 'chat' && <ChatWorkspace />}
        {tab === 'skills' && <SkillPanel />}
        {tab === 'renderers' && <RendererPanel />}
        {tab === 'kb' && <KnowledgePanel />}
        {tab === 'model' && <ModelPanel />}
        {tab === 'assets' && <AssetPanel />}
        {tab === 'token' && <TokenPanel />}
      </main>
    </div>
  )
}
