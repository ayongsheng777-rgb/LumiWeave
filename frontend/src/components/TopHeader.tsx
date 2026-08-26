import { useUiStore } from '../store/uiStore'
import { logout } from '../api'
import { Sun, Moon, Network, LayoutGrid, LogOut, Settings, Clapperboard } from 'lucide-react'

export default function TopHeader() {
  const projectName = useUiStore((s) => s.projectName)
  const setProjectName = useUiStore((s) => s.setProjectName)
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const mode = useUiStore((s) => s.mode)
  const setMode = useUiStore((s) => s.setMode)
  const setManagementOpen = useUiStore((s) => s.setManagementOpen)

  const onLogout = async () => {
    await logout()
    window.location.reload()
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-edge bg-panel/80 px-4 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <img src="/logo.jpg" alt="绵绣" className="h-8 w-8 rounded-lg" />
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          className="w-48 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-ink outline-none transition hover:border-edge focus:border-brand-500"
        />
      </div>

      <div className="flex items-center rounded-xl border border-edge bg-soft p-0.5 text-xs">
        <button
          onClick={() => setMode('workflow')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
            mode === 'workflow' ? 'bg-brand-600 text-white' : 'text-ink-2 hover:text-ink'
          }`}
        >
          <Network size={14} /> 工作流
        </button>
        <button
          onClick={() => setMode('infinite')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
            mode === 'infinite' ? 'bg-brand-600 text-white' : 'text-ink-2 hover:text-ink'
          }`}
        >
          <LayoutGrid size={14} /> 无限画布
        </button>
        <button
          onClick={() => setMode('scene')}
          title="V2.5 专业场景画布：电商物料 / 电商短剧 / 影视拉片"
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
            mode === 'scene' ? 'bg-brand-600 text-white' : 'text-ink-2 hover:text-ink'
          }`}
        >
          <Clapperboard size={14} /> 专业场景
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setManagementOpen(true)}
          title="设置与管理"
          className="rounded-lg p-2 text-ink-2 transition hover:bg-soft"
        >
          <Settings size={16} />
        </button>
        <button
          onClick={toggleTheme}
          title="切换主题"
          className="rounded-lg p-2 text-ink-2 transition hover:bg-soft"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          onClick={onLogout}
          title="退出登录"
          className="rounded-lg p-2 text-ink-2 transition hover:bg-soft"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  )
}
