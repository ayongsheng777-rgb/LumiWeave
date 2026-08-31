import { useEffect, useRef, useState } from 'react'
import { Sun, Moon, Network, LogOut, Settings, Clapperboard, Sparkles, Wand2, X, Crown, Check, Loader2, Film, Camera, ShoppingBag } from 'lucide-react'
import { useUiStore } from '../store/uiStore'
import { logout, sceneTemplates, scenePlans, sceneSetPlan, type Plan } from '../api'
import { useSceneStore } from '../store/sceneStore'

/** §75：与后端 /api/scenes/templates 返回结构对齐（routes.py 74-87） */
type SceneTemplateLite = {
  id: string
  name: string
  category?: string
  objects?: string[]
  actions?: string[]
  timeline?: boolean
}

/** §75 顶层产品菜单：三个 P0 场景一键创建并跳转。 */
const SCENE_META: Record<
  string,
  { label: string; desc: string; icon: 'shopping' | 'drama' | 'film'; tone: string }
> = {
  'ecommerce-material': {
    label: '电商物料',
    desc: '商品广告图 · 主图/详情图/营销 banner，AI 一键成片',
    icon: 'shopping',
    tone: 'from-pink-500/15 to-amber-400/15',
  },
  'ecommerce-drama': {
    label: '电商短剧',
    desc: '15-60s 带货短视频 · 剧情分镜 + 配音字幕 + 成片导出',
    icon: 'drama',
    tone: 'from-violet-500/15 to-cyan-400/15',
  },
  'film-analysis': {
    label: '影视拉片',
    desc: '上传参考视频 · AI 自动拆镜（景别/运镜/构图/光影）',
    icon: 'film',
    tone: 'from-emerald-500/15 to-sky-400/15',
  },
}

function SceneIcon({ kind, className }: { kind: 'shopping' | 'drama' | 'film'; className?: string }) {
  if (kind === 'shopping') return <ShoppingBag size={18} className={className} />
  if (kind === 'drama') return <Film size={18} className={className} />
  return <Camera size={18} className={className} />
}

export default function TopHeader() {
  const projectName = useUiStore((s) => s.projectName)
  const setProjectName = useUiStore((s) => s.setProjectName)
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const mode = useUiStore((s) => s.mode)
  const setMode = useUiStore((s) => s.setMode)
  const setManagementOpen = useUiStore((s) => s.setManagementOpen)
  const chatOpen = useUiStore((s) => s.chatOpen)
  const toggleChat = useUiStore((s) => s.toggleChat)

  // §75 快速创作
  const [quickOpen, setQuickOpen] = useState(false)
  const [templates, setTemplates] = useState<SceneTemplateLite[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [currentPlanId, setCurrentPlanId] = useState('free')
  const [creating, setCreating] = useState<string | null>(null)
  const [quickErr, setQuickErr] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  // §75 拉取模板与套餐（首次打开下拉时触发，关闭清除缓存避免重复请求）
  useEffect(() => {
    if (!quickOpen) return
    let alive = true
    Promise.all([sceneTemplates(), scenePlans()])
      .then(([tplRes, planRes]) => {
        if (!alive) return
        if (tplRes.ok) setTemplates(((tplRes.data?.templates || []) as SceneTemplateLite[]))
        if (planRes.ok) {
          const ps = ((planRes.data?.plans || []) as Plan[])
          setPlans(ps)
          const cur = String(planRes.data?.current?.id || 'free')
          setCurrentPlanId(cur)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [quickOpen])

  // §75 点外部关下拉
  useEffect(() => {
    if (!quickOpen) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setQuickOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [quickOpen])

  const onQuickCreate = async (sceneType: string, name: string) => {
    if (creating) return
    setQuickErr('')
    setCreating(sceneType)
    try {
      const created = await useSceneStore.getState().createScene(sceneType, name)
      if (!created) {
        setQuickErr('建场景失败，请检查后端日志')
        return
      }
      await useSceneStore.getState().openScene(created)
      setMode('scene')
      setQuickOpen(false)
    } catch (err) {
      setQuickErr(String(err))
    } finally {
      setCreating(null)
    }
  }

  const onSwitchPlan = async (planId: string) => {
    if (planId === currentPlanId) return
    const res = await sceneSetPlan(planId)
    if (res.ok) setCurrentPlanId(planId)
  }

  const onLogout = async () => {
    await logout()
    window.location.reload()
  }

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between border-b border-white/40 bg-white/70 px-4 backdrop-blur-lg dark:border-white/10 dark:bg-slate-900/70">
      <div className="flex items-center gap-3">
        <img src="/logo.jpg" alt="绵绣" className="h-8 w-8 rounded-lg" />
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          className="w-48 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-ink outline-none transition hover:border-edge focus:border-brand-500"
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-xl border border-edge bg-soft p-0.5 text-xs">
          <button
            onClick={() => setMode('canvas')}
            title="PixVerse 风格通用画布：素材节点 + 生成节点，连线即输入"
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
              mode === 'canvas' ? 'bg-brand-600 text-white' : 'text-ink-2 hover:text-ink'
            }`}
          >
            <Network size={14} /> 通用画布
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

        {/* §75 快速创作入口 */}
        <div ref={wrapRef} className="relative">
          <button
            onClick={() => setQuickOpen((v) => !v)}
            title="快速创建场景"
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition ${
              quickOpen
                ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-md'
                : 'bg-gradient-to-r from-brand-500/10 to-brand-600/10 text-brand-600 hover:from-brand-500/20 hover:to-brand-600/20 dark:text-brand-300'
            }`}
          >
            <Wand2 size={14} /> 快速创作
          </button>
          {quickOpen && (
            <div className="absolute left-1/2 top-full z-50 mt-2 w-[min(94vw,640px)] -translate-x-1/2">
              <div className="lw-glass-strong rounded-2xl border border-white/40 p-4 shadow-2xl backdrop-blur-xl dark:border-white/10">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-ink">选一个场景开始</div>
                    <div className="mt-0.5 text-[11px] text-ink-3">
                      点击卡片 → 自动建场景并跳到画布，模板套件自动就位
                    </div>
                  </div>
                  <button
                    onClick={() => setQuickOpen(false)}
                    className="rounded p-1 text-ink-3 transition hover:bg-soft hover:text-ink"
                    title="关闭"
                  >
                    <X size={14} />
                  </button>
                </div>

                {quickErr && (
                  <div className="mb-2 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-400">
                    {quickErr}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {templates.length === 0
                    ? // 后端还没回：拿本地元数据兜底（不阻塞 UI）
                      (Object.entries(SCENE_META) as [string, (typeof SCENE_META)[keyof typeof SCENE_META]][]).map(
                        ([k, meta]) => (
                          <button
                            key={k}
                            disabled={!!creating}
                            onClick={() => void onQuickCreate(k, meta.label)}
                            className={`group relative flex flex-col items-start gap-2 rounded-xl border border-white/40 bg-gradient-to-br ${meta.tone} p-3 text-left transition hover:border-brand-500/60 hover:shadow-lg disabled:opacity-50 dark:border-white/10`}
                          >
                            <div className="flex items-center gap-1.5">
                              <SceneIcon kind={meta.icon} className="text-brand-500" />
                              <span className="text-sm font-medium text-ink">{meta.label}</span>
                            </div>
                            <span className="text-[11px] leading-relaxed text-ink-2">{meta.desc}</span>
                            {creating === k && (
                              <Loader2 size={12} className="absolute right-2 top-2 animate-spin text-brand-500" />
                            )}
                          </button>
                        ),
                      )
                    : templates.map((t) => {
                        const meta = SCENE_META[t.id] || {
                          label: t.name,
                          desc: `${t.objects?.length || 0} 种对象 · ${t.actions?.length || 0} 个动作${t.timeline ? ' · 时间轴' : ''}`,
                          icon: 'shopping' as const,
                          tone: 'from-slate-500/10 to-slate-400/10',
                        }
                        return (
                          <button
                            key={t.id}
                            disabled={!!creating}
                            onClick={() => void onQuickCreate(t.id, t.name)}
                            className={`group relative flex flex-col items-start gap-2 rounded-xl border border-white/40 bg-gradient-to-br ${meta.tone} p-3 text-left transition hover:border-brand-500/60 hover:shadow-lg disabled:opacity-50 dark:border-white/10`}
                          >
                            <div className="flex items-center gap-1.5">
                              <SceneIcon kind={meta.icon} className="text-brand-500" />
                              <span className="text-sm font-medium text-ink">{meta.label}</span>
                              {t.timeline && (
                                <span className="rounded bg-brand-500/15 px-1 text-[10px] text-brand-500">
                                  时间轴
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] leading-relaxed text-ink-2">{meta.desc}</span>
                            {creating === t.id && (
                              <Loader2 size={12} className="absolute right-2 top-2 animate-spin text-brand-500" />
                            )}
                          </button>
                        )
                      })}
                </div>

                {/* 套餐选择（§73） */}
                {plans.length > 0 && (
                  <div className="mt-3 border-t border-white/30 pt-3 dark:border-white/10">
                    <div className="mb-1.5 flex items-center gap-1 text-[11px] text-ink-2">
                      <Crown size={12} className="text-amber-400" /> 当前套餐
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {plans.map((p) => {
                        const active = p.id === currentPlanId
                        return (
                          <button
                            key={p.id}
                            disabled={active}
                            onClick={() => void onSwitchPlan(p.id)}
                            className={`flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left text-[11px] transition ${
                              active
                                ? 'border-brand-500/60 bg-brand-500/10 text-ink'
                                : 'border-edge bg-soft text-ink-2 hover:border-brand-500/40 hover:text-ink'
                            }`}
                            title={p.features?.join(' / ')}
                          >
                            <span className="flex items-center gap-1 font-medium">
                              {active && <Check size={10} className="text-brand-500" />}
                              {p.name}
                            </span>
                            <span className="text-[10px] text-ink-3">
                              {p.price > 0 ? `¥${p.price}/月` : p.price === 0 && p.id === 'enterprise' ? '商务洽谈' : '免费'}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="relative flex items-center gap-2">
        {/* AI 助手开关：关闭面板后也能重新打开 */}
        <button
          onClick={toggleChat}
          title={chatOpen ? '关闭 AI 助手' : '打开 AI 助手'}
          className={`rounded-lg p-2 transition hover:bg-soft ${chatOpen ? 'bg-brand-600/15 text-brand-600' : 'text-ink-2'}`}
        >
          <Sparkles size={16} />
        </button>

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
