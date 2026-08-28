// SceneTemplateMarket —— 营销模板市场（V2.8 电商物料）
// 按平台分类（淘宝/抖音/小红书/通用）浏览 12 类电商营销模板，一键铺入当前场景画布。
import { useEffect, useState } from 'react'
import { X, LayoutGrid, Loader2, Check } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'

const PLATFORMS = ['全部', '淘宝', '抖音', '小红书', '通用']
const PLATFORM_COLORS: Record<string, string> = {
  淘宝: '#ff6a00', 抖音: '#07b5b5', 小红书: '#ff4d6d', 通用: '#8b5cf6',
}

export default function SceneTemplateMarket() {
  const [open, setOpen] = useState(false)
  const templates = useSceneStore((s) => s.marketingTemplates)
  const loadMarketingTemplates = useSceneStore((s) => s.loadMarketingTemplates)
  const applyMarketingTemplate = useSceneStore((s) => s.applyMarketingTemplate)
  const currentSceneId = useSceneStore((s) => s.currentSceneId)
  const [tab, setTab] = useState('全部')
  const [applying, setApplying] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    if (open) void loadMarketingTemplates('')
  }, [open, loadMarketingTemplates])

  if (!currentSceneId) return null
  const list = tab === '全部' ? templates : templates.filter((t) => String(t.platform || '通用') === tab)

  const apply = async (tid: string, name: string) => {
    if (applying) return
    setApplying(tid)
    await applyMarketingTemplate(tid)
    setApplying('')
    setDone(name)
    setTimeout(() => setDone(''), 2500)
  }

  return (
    <>
      <button
        className="flex h-9 items-center gap-1.5 rounded-lg border border-brand-500/40 bg-panel/90 px-3 text-[11px] text-brand-500 shadow-node-dark backdrop-blur-md transition hover:bg-panel"
        onClick={() => setOpen(true)}
        title="营销模板市场：按平台分类的电商营销模板，一键铺入画布"
      >
        <LayoutGrid size={13} /> 模板
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30"
          style={{ paddingTop: '10vh' }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div className="flex max-h-[72vh] w-[580px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-edge bg-panel-2 shadow-2xl">
            {/* 头部 */}
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
              <LayoutGrid size={14} className="text-brand-500" />
              <span className="text-sm font-medium text-ink">营销模板市场</span>
              <span className="text-[10px] text-ink-3">按平台分类 · 一键铺入当前场景</span>
              <button className="ml-auto rounded p-1 text-ink-3 transition hover:text-ink" onClick={() => setOpen(false)}>
                <X size={14} />
              </button>
            </div>

            {/* 平台分类 tab */}
            <div className="flex shrink-0 items-center gap-1 border-b border-edge px-3 py-1.5">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  className={`rounded-full px-2.5 py-1 text-[11px] transition ${tab === p ? 'bg-brand-600 text-white' : 'bg-soft text-ink-2 hover:text-ink'}`}
                  onClick={() => setTab(p)}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* 模板卡片网格 */}
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {list.length === 0 && (
                <div className="py-8 text-center text-[11px] text-ink-3">该分类暂无模板</div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                {list.map((t) => {
                  const tid = String(t.id || '')
                  const name = String(t.name || tid)
                  const plat = String(t.platform || '通用')
                  const desc = String(t.description || '')
                  const ots = Array.isArray(t.object_types) ? (t.object_types as string[]) : []
                  return (
                    <div key={tid} className="flex flex-col rounded-lg border border-edge bg-canvas p-2">
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">{name}</span>
                        <span
                          className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] text-white"
                          style={{ background: PLATFORM_COLORS[plat] || '#8b5cf6' }}
                        >
                          {plat}
                        </span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 min-h-[26px] text-[10px] leading-snug text-ink-2">{desc}</div>
                      <div className="mt-1 flex flex-wrap gap-0.5">
                        {ots.map((o, i) => (
                          <span key={i} className="rounded bg-soft px-1 py-0.5 text-[9px] text-ink-3">{o}</span>
                        ))}
                      </div>
                      <button
                        className="mt-auto flex h-7 items-center justify-center gap-1 rounded-md bg-brand-600 text-[11px] text-white transition hover:bg-brand-500 disabled:opacity-50"
                        disabled={!!applying}
                        onClick={() => void apply(tid, name)}
                      >
                        {applying === tid ? <Loader2 size={11} className="animate-spin" /> : done === name ? <Check size={11} /> : <LayoutGrid size={11} />}
                        {applying === tid ? '铺入中…' : done === name ? '已铺入' : '一键应用'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
