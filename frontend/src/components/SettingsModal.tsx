import { useState } from 'react'
import { X, Cpu, Coins, Wrench, Image, BookOpen, FolderOpen, Shield, Network, Layers } from 'lucide-react'
import { useUiStore } from '../store/uiStore'
import ModelPanel from './ModelPanel'
import TokenPanel from './TokenPanel'
import SkillPanel from './SkillPanel'
import RendererPanel from './RendererPanel'
import KnowledgePanel from './KnowledgePanel'
import AssetPanel from './AssetPanel'
import OtpPanel from './OtpPanel'
import CanvasModelPanel from './CanvasModelPanel'
import MCPStatus from './mcp/MCPStatus'
import ToolPanel from './mcp/ToolPanel'

type Tab = 'model' | 'canvas' | 'token' | 'skills' | 'renderers' | 'kb' | 'assets' | 'security' | 'mcp'

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'model', label: '模型', icon: <Cpu size={15} /> },
  { key: 'canvas', label: '画布', icon: <Layers size={15} /> },
  { key: 'renderers', label: '出图', icon: <Image size={15} /> },
  { key: 'skills', label: '技能库', icon: <Wrench size={15} /> },
  { key: 'kb', label: '知识库', icon: <BookOpen size={15} /> },
  { key: 'assets', label: '素材', icon: <FolderOpen size={15} /> },
  { key: 'token', label: '计费', icon: <Coins size={15} /> },
  { key: 'security', label: '安全', icon: <Shield size={15} /> },
  { key: 'mcp', label: 'MCP', icon: <Network size={15} /> },
]

// 设置弹窗：承载各管理面板（模型/计费/技能/出图/知识库/素材）
export default function SettingsModal() {
  const close = () => useUiStore.getState().setManagementOpen(false)
  // 支持从其它入口直达指定 tab（如节点里「配置」直达模型页）；旧 'providers' 入口重定向到 'model'
  const tab0 = useUiStore((s) => s.managementTab)
  const directTab = (tab0 === 'providers' ? 'model' : tab0) as Tab
  const [tab, setTab] = useState<Tab>(directTab || 'model')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-6 animate-fade-in" onClick={close}>
      <div
        // 亮色毛玻璃主壳：半透明白 + 高斯模糊 + 精细阴影（V2.4 规范）
        className="flex h-[80vh] w-[min(94vw,64rem)] flex-col overflow-hidden rounded-3xl border border-[var(--lw-glass-edge)] bg-[var(--lw-glass-bg)] backdrop-blur-2xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.15)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：细微底边替代生硬 border */}
        <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-6 py-4 bg-white/40">
          <div className="text-base font-semibold text-slate-800">设置与管理</div>
          <button onClick={close} className="p-1.5 rounded-full text-slate-400 hover:bg-black/5 hover:text-slate-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左侧 tab：柔和选中态（紫色实底） */}
          <div className="w-40 shrink-0 border-r border-black/5 bg-white/30 p-3">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`mb-1.5 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  tab === t.key
                    ? 'bg-violet-500 text-white shadow-md shadow-violet-500/20'
                    : 'text-slate-500 hover:bg-black/5 hover:text-slate-800'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* 右侧内容区 */}
          <div className="min-w-0 flex-1 overflow-y-auto p-6 bg-transparent">
            {tab === 'model' && <ModelPanel />}
            {tab === 'canvas' && <CanvasModelPanel />}
            {tab === 'token' && <TokenPanel />}
            {tab === 'skills' && <SkillPanel />}
            {tab === 'renderers' && <RendererPanel />}
            {tab === 'kb' && <KnowledgePanel />}
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
