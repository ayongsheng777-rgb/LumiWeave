import { useState } from 'react'
import { X, Cpu, Coins, Wrench, Image, BookOpen, Plug, FolderOpen, Shield, Network } from 'lucide-react'
import { useUiStore } from '../store/uiStore'
import ModelPanel from './ModelPanel'
import TokenPanel from './TokenPanel'
import SkillPanel from './SkillPanel'
import RendererPanel from './RendererPanel'
import KnowledgePanel from './KnowledgePanel'
import ProviderPanel from './ProviderPanel'
import AssetPanel from './AssetPanel'
import OtpPanel from './OtpPanel'
import MCPStatus from './mcp/MCPStatus'
import ToolPanel from './mcp/ToolPanel'

type Tab = 'model' | 'token' | 'skills' | 'renderers' | 'kb' | 'providers' | 'assets' | 'security' | 'mcp'

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'model', label: '模型', icon: <Cpu size={15} /> },
  { key: 'providers', label: '接口', icon: <Plug size={15} /> },
  { key: 'renderers', label: '出图', icon: <Image size={15} /> },
  { key: 'skills', label: '技能库', icon: <Wrench size={15} /> },
  { key: 'kb', label: '知识库', icon: <BookOpen size={15} /> },
  { key: 'assets', label: '素材', icon: <FolderOpen size={15} /> },
  { key: 'token', label: '计费', icon: <Coins size={15} /> },
  { key: 'security', label: '安全', icon: <Shield size={15} /> },
  { key: 'mcp', label: 'MCP', icon: <Network size={15} /> },
]

// 设置弹窗：承载各管理面板（模型/计费/技能/出图/知识库/接口/素材）
export default function SettingsModal() {
  const close = () => useUiStore.getState().setManagementOpen(false)
  const [tab, setTab] = useState<Tab>('model')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 animate-fade-in" onClick={close}>
      <div
        className="flex h-[80vh] w-[min(94vw,64rem)] flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-node-dark"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-3">
          <div className="text-sm font-semibold text-ink">设置与管理</div>
          <button onClick={close} className="text-ink-3 transition hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左侧 tab */}
          <div className="w-36 shrink-0 border-r border-edge bg-panel-2 p-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                  tab === t.key ? 'bg-brand-500/15 text-brand-300' : 'text-ink-2 hover:bg-soft'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* 右侧内容 */}
          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            {tab === 'model' && <ModelPanel />}
            {tab === 'token' && <TokenPanel />}
            {tab === 'skills' && <SkillPanel />}
            {tab === 'renderers' && <RendererPanel />}
            {tab === 'kb' && <KnowledgePanel />}
            {tab === 'providers' && <ProviderPanel />}
            {tab === 'assets' && <AssetPanel />}
            {tab === 'security' && <OtpPanel />}
            {tab === 'mcp' && (
              <div className="space-y-6">
                <ToolPanel />
                <MCPStatus />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
