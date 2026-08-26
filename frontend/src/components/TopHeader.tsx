import { useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { useSceneStore } from '../store/sceneStore'
import { logout } from '../api'
import { Sun, Moon, Network, LayoutGrid, LogOut, Settings, Clapperboard, Menu, ShoppingBag, Film } from 'lucide-react'

const CREATE_ENTRIES = [
  { id: 'ecommerce-material', name: '电商商品营销物料', icon: <ShoppingBag size={14} /> },
  { id: 'ecommerce-drama', name: '电商短剧带货', icon: <Clapperboard size={14} /> },
  { id: 'film-analysis', name: '影视拉片', icon: <Film size={14} /> },
]

export default function TopHeader() {
  const projectName = useUiStore((s) => s.projectName)
  const setProjectName = useUiStore((s) => s.setProjectName)
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const mode = useUiStore((s) => s.mode)
  const setMode = useUiStore((s) => s.setMode)
  const setManagementOpen = useUiStore((s) => s.setManagementOpen)
  const createScene = useSceneStore((s) => s.createScene)
  const plans = useSceneStore((s) => s.plans)
  const currentPlan = useSceneStore((s) => s.currentPlan)
  const loadPlans = useSceneStore((s) => s.loadPlans)
  const setPlan = useSceneStore((s) => s.setPlan)

  const [menuOpen, setMenuOpen] = useState(false)

  const onLogout = async () => {
    await logout()
    window.location.reload()
  }

  const onCreate = (sceneType: string) => {
    setMode('scene')
    void createScene(sceneType)
    setMenuOpen(false)
  }

  const onMenuToggle = () => {
    const next = !menuOpen
    setMenuOpen(next)
    if (next) void loadPlans()
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

      <div className="relative flex items-center gap-2">
        {/* 顶层菜单（§75 / P2-04）：创作入口 + 系统套餐 */}
        <div className="relative">
          <button
            onClick={onMenuToggle}
            title="菜单"
            className={`rounded-lg p-2 transition hover:bg-soft ${menuOpen ? 'bg-soft text-ink' : 'text-ink-2'}`}
          >
            <Menu size={16} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-10 z-50 w-64 overflow-hidden rounded-xl border border-edge bg-panel/95 shadow-node-dark backdrop-blur-md">
              <div className="border-b border-edge px-3 py-1.5 text-[10px] text-ink-3">快速创作</div>
              <div className="p-1">
                {CREATE_ENTRIES.map((e) => (
                  <button
                    key={e.id}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-ink-2 transition hover:bg-hover hover:text-ink"
                    onClick={() => onCreate(e.id)}
                  >
                    {e.icon}
                    {e.name}
                  </button>
                ))}
              </div>
              <div className="border-t border-edge px-3 py-1.5 text-[10px] text-ink-3">系统 · 套餐</div>
              <div className="p-1">
                <div className="rounded-lg bg-hover/50 px-2.5 py-1.5 text-[10px] text-ink-2">
                  当前：<span className="font-medium text-brand-500">{currentPlan?.name || '免费版'}</span>
                  {currentPlan?.limits?.scenes != null && (
                    <span className="ml-2 text-ink-3">场景上限 {currentPlan.limits.scenes}</span>
                  )}
                </div>
                {plans.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-2.5 py-1 text-[10px] text-ink-3">
                    <span>{p.name}</span>
                    <span className="flex items-center gap-2">
                      <span>{p.price > 0 ? `¥${p.price}/月` : p.id === 'free' ? '免费' : '洽谈'}</span>
                      <button
                        className={`rounded px-1.5 py-0.5 transition ${
                          currentPlan?.id === p.id
                            ? 'bg-brand-500 text-white'
                            : 'border border-edge text-ink-2 hover:text-ink'
                        }`}
                        onClick={() => void setPlan(p.id)}
                      >
                        {currentPlan?.id === p.id ? '当前' : '启用'}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

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
