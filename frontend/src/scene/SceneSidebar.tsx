/**
 * 场景侧边栏（规格书 §6 / §39 场景模板）
 *
 * 上半：三大专业场景模板（点击新建实例）
 * 下半：当前项目已有场景实例列表（点击切换 / 悬停删除）
 */
import { useEffect, useState } from 'react'
import { ShoppingBag, Clapperboard, Film, Plus, Trash2, ChevronLeft, ChevronRight, Save, History, RotateCcw } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { useResponsiveLayout } from '../hooks/useResponsiveLayout'

const SCENE_ICONS: Record<string, React.ReactNode> = {
  'ecommerce-material': <ShoppingBag size={16} />,
  'ecommerce-drama': <Clapperboard size={16} />,
  'film-analysis': <Film size={16} />,
}

const SCENE_ACCENT: Record<string, string> = {
  'ecommerce-material': 'text-red-400',
  'ecommerce-drama': 'text-fuchsia-400',
  'film-analysis': 'text-cyan-400',
}

export default function SceneSidebar() {
  // §49 响应式（替代旧实现 window.innerWidth < 1100 一次判定）：
  //   < 1024px（desktop 阈值）默认收起为浮动汉堡；用户可手动展开。
  // 用 hook 拿 SSR 安全初值 + 实时 resize 监听。
  const responsive = useResponsiveLayout()
  const [collapsed, setCollapsed] = useState(true)
  useEffect(() => {
    // 仅在窄屏/平板默认收起；桌面端保持展开
    setCollapsed(!responsive.isDesktop)
  }, [responsive.isDesktop])
  const types = useSceneStore((s) => s.types)
  const scenes = useSceneStore((s) => s.scenes)
  const currentSceneId = useSceneStore((s) => s.currentSceneId)
  const init = useSceneStore((s) => s.init)
  const createScene = useSceneStore((s) => s.createScene)
  const openScene = useSceneStore((s) => s.openScene)
  const removeScene = useSceneStore((s) => s.removeScene)
  const loading = useSceneStore((s) => s.loading)
  const versions = useSceneStore((s) => s.versions)
  const saveVersion = useSceneStore((s) => s.saveVersion)
  const restoreVersion = useSceneStore((s) => s.restoreVersion)

  useEffect(() => {
    void init()
  }, [init])

  if (collapsed) {
    return (
      <button
        className="absolute left-2 top-2 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--lw-glass-edge)] bg-[var(--lw-glass-bg)] text-ink-2 shadow-node-dark backdrop-blur-md transition hover:text-ink"
        onClick={() => setCollapsed(false)}
        title="展开场景面板"
      >
        <ChevronRight size={16} />
      </button>
    )
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--lw-glass-edge)] bg-[var(--lw-glass-bg)] backdrop-blur-lg">
      {/* 标题 */}
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-xs font-medium text-ink">专业场景</span>
        <button
          className="rounded p-0.5 text-ink-3 transition hover:text-ink"
          onClick={() => setCollapsed(true)}
          title="收起"
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      {/* 场景模板：点击新建 */}
      <div className="border-b border-edge px-2 py-2">
        <div className="mb-1 px-1 text-[10px] text-ink-3">新建场景</div>
        <div className="space-y-1">
          {types.map((t) => (
            <button
              key={t.id}
              className="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-hover"
              title={t.description}
              onClick={() => void createScene(t.id)}
            >
              <span className={`mt-0.5 shrink-0 ${SCENE_ACCENT[t.id] || 'text-ink-2'}`}>
                {SCENE_ICONS[t.id] || <Film size={16} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] text-ink">{t.name}</span>
                <span className="block truncate text-[10px] text-ink-3">
                  {t.object_types.length} 类对象 · {t.actions.length} 个动作
                </span>
              </span>
              <Plus size={12} className="mt-0.5 shrink-0 text-ink-3 opacity-0 transition group-hover:opacity-100" />
            </button>
          ))}
          {!types.length && (
            <div className="px-2 py-3 text-center text-[10px] text-ink-3">
              {loading ? '加载中…' : '未获取到场景注册表'}
            </div>
          )}
        </div>
      </div>

      {/* 已有场景实例 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="mb-1 px-1 text-[10px] text-ink-3">我的场景（{scenes.length}）</div>
        <div className="space-y-0.5">
          {scenes.map((s) => {
            const active = s.id === currentSceneId
            return (
              <div
                key={s.id}
                className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition ${
                  active ? 'bg-brand-500/15' : 'hover:bg-hover'
                }`}
              >
                <span className={`shrink-0 ${SCENE_ACCENT[s.scene_type] || 'text-ink-2'}`}>
                  {SCENE_ICONS[s.scene_type] || <Film size={14} />}
                </span>
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => void openScene(s.id)}
                  title={s.name}
                >
                  <span className={`block truncate text-[11px] ${active ? 'text-ink' : 'text-ink-2'}`}>
                    {s.name}
                  </span>
                </button>
                <button
                  className="shrink-0 rounded p-0.5 text-ink-3 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                  title="删除场景"
                  onClick={() => {
                    if (confirm(`删除场景「${s.name}」？该场景内的对象与连线将一并删除。`)) {
                      void removeScene(s.id)
                    }
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
          {!scenes.length && (
            <div className="px-2 py-3 text-center text-[10px] text-ink-3">
              还没有场景，点上方模板新建
            </div>
          )}
        </div>
      </div>

      {/* 版本管理（§35：快照 / 恢复） */}
      {currentSceneId && (
        <div className="border-t border-edge px-2 py-2">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[10px] text-ink-3">版本管理</span>
            <button
              className="flex items-center gap-1 rounded-md border border-brand-500/40 px-1.5 py-0.5 text-[10px] text-brand-500 transition hover:bg-brand-500/10"
              onClick={() => {
                // 重新保存时带出上次使用的版本说明，不用重新输入
                const lastLabel = versions.find((v) => v.label)?.label ?? ''
                const label = prompt('版本说明（可选）', lastLabel)
                if (label !== null) void saveVersion(label || '')
              }}
              title="把当前画布快照存为一个版本"
            >
              <Save size={10} /> 保存版本
            </button>
          </div>
          <div className="max-h-40 space-y-0.5 overflow-y-auto">
            {versions.map((v) => (
              <div key={v.id} className="group flex items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-hover">
                <History size={11} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate text-[10px] text-ink-2">
                  v{v.version}
                  {v.label ? ` · ${v.label}` : ''}
                </span>
                <span className="shrink-0 text-[9px] text-ink-3">
                  {new Date(v.created_at).toLocaleDateString('zh-CN')}
                </span>
                <button
                  className="shrink-0 rounded p-0.5 text-ink-3 transition hover:text-brand-500"
                  title="恢复到该版本"
                  onClick={() => {
                    if (confirm(`恢复到 v${v.version}？当前画布内容将被覆盖。`)) {
                      void restoreVersion(v.id)
                    }
                  }}
                >
                  <RotateCcw size={11} />
                </button>
              </div>
            ))}
            {!versions.length && (
              <div className="px-1 py-2 text-center text-[10px] text-ink-3">
                还没有版本，点「保存版本」备份当前画布
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
