/**
 * 场景底部工作栏（规格书 §14 六大页签）
 *
 * 对象 / AI / 工作流 / 时间线 / 素材 / 历史
 * 默认收起为一条细栏，点击页签展开（不抢占画布高度）。
 */
import { useState } from 'react'
import {
  Boxes, Sparkles, Workflow, Clock, Image as ImageIcon, History,
  ChevronDown, ChevronUp, Loader2, Play, Lock, Eye, Plus,
} from 'lucide-react'
import { useSceneStore, ACTION_LABELS } from '../store/sceneStore'
import { useUiStore } from '../store/uiStore'
import SceneTimeline from './SceneTimeline'

type Tab = 'object' | 'ai' | 'workflow' | 'timeline' | 'assets' | 'history'

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'object', label: '对象', icon: <Boxes size={13} /> },
  { key: 'ai', label: 'AI', icon: <Sparkles size={13} /> },
  { key: 'workflow', label: '工作流', icon: <Workflow size={13} /> },
  { key: 'timeline', label: '时间线', icon: <Clock size={13} /> },
  { key: 'assets', label: '素材', icon: <ImageIcon size={13} /> },
  { key: 'history', label: '历史', icon: <History size={13} /> },
]

export default function SceneBottomBar() {
  const [tab, setTab] = useState<Tab>('object')
  const [open, setOpen] = useState(false)

  const objects = useSceneStore((s) => s.objects)
  const selectedIds = useSceneStore((s) => s.selectedIds)
  const setSelected = useSceneStore((s) => s.setSelected)
  const metaOf = useSceneStore((s) => s.metaOf)
  const typeDef = useSceneStore((s) => s.currentTypeDef())
  const runAction = useSceneStore((s) => s.runAction)
  const busy = useSceneStore((s) => s.busy)
  const runLog = useSceneStore((s) => s.runLog)
  const toggleLock = useSceneStore((s) => s.toggleLock)
  const currentSceneId = useSceneStore((s) => s.currentSceneId)
  const openLightbox = useUiStore((s) => s.openLightbox)
  const assetLib = useSceneStore((s) => s.assets)
  const loadAssets = useSceneStore((s) => s.loadAssets)
  const addAssetToCanvas = useSceneStore((s) => s.addAssetToCanvas)

  const [aiPrompt, setAiPrompt] = useState('')

  const timelineEnabled = typeDef?.timeline_enabled

  if (!currentSceneId) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center">
      {/* 展开的内容面板 */}
      {open && (
        <div className="nowheel pointer-events-auto mb-1 w-[min(96%,1100px)] overflow-hidden rounded-2xl border border-edge bg-panel/95 shadow-node-dark backdrop-blur-md">
          <div className="max-h-56 overflow-y-auto p-3">
            {/* ── 对象页签 ── */}
            {tab === 'object' && (
              <div className="space-y-0.5">
                {objects.map((o) => {
                  const meta = metaOf(String(o.data.objectType))
                  const p = (o.data.payload || {}) as Record<string, unknown>
                  const name = String(p.name || p.title || '') || meta.label
                  const active = selectedIds.includes(o.id)
                  return (
                    <div
                      key={o.id}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1 transition ${
                        active ? 'bg-brand-500/15' : 'hover:bg-hover'
                      }`}
                    >
                      <span className="h-2.5 w-1 shrink-0 rounded-full" style={{ background: meta.color }} />
                      <span className="shrink-0 text-[10px]" style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                      <button
                        className="min-w-0 flex-1 truncate text-left text-[11px] text-ink-2"
                        onClick={() => setSelected([o.id])}
                      >
                        {name}
                      </button>
                      <button
                        className="shrink-0 text-ink-3 transition hover:text-ink"
                        title={o.data.locked ? '解锁' : '锁定'}
                        onClick={() => toggleLock(o.id)}
                      >
                        {o.data.locked ? <Lock size={11} /> : <Eye size={11} />}
                      </button>
                    </div>
                  )
                })}
                {!objects.length && (
                  <div className="py-4 text-center text-[10px] text-ink-3">
                    画布还没有对象，从左上工具条添加
                  </div>
                )}
              </div>
            )}

            {/* ── AI 页签 ── */}
            {tab === 'ai' && (
              <div className="space-y-2">
                <textarea
                  className="w-full resize-y rounded-lg border border-edge bg-canvas px-2 py-1.5 text-[11px] text-ink outline-none focus:border-brand-500"
                  rows={2}
                  placeholder="用一句话描述你要的东西，例如：给这个商品生成 3 张主图 / 按剧情拆 5 个分镜"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                />
                <div className="flex flex-wrap gap-1.5">
                  {(typeDef?.actions || []).map((a) => (
                    <button
                      key={a}
                      className="flex items-center gap-1 rounded-lg border border-edge bg-canvas px-2 py-1 text-[10px] text-ink-2 transition hover:border-brand-500 hover:text-ink disabled:opacity-40"
                      disabled={!!busy}
                      onClick={() => void runAction(a, selectedIds, { prompt: aiPrompt })}
                    >
                      {busy === a ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                      {ACTION_LABELS[a] || a}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-ink-3">
                  未选中对象时，动作作用于整个场景的相关对象。
                </div>
              </div>
            )}

            {/* ── 工作流页签：按场景动作顺序串跑 ── */}
            {tab === 'workflow' && (
              <div className="space-y-2">
                <div className="text-[10px] text-ink-3">
                  该场景的标准生产链路，点「按顺序全跑」逐步执行：
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {(typeDef?.actions || []).map((a, i) => (
                    <span key={a} className="flex items-center gap-1">
                      {i > 0 && <span className="text-ink-3">→</span>}
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[10px] ${
                          busy === a
                            ? 'border-brand-500 text-brand-500'
                            : 'border-edge text-ink-2'
                        }`}
                      >
                        {ACTION_LABELS[a] || a}
                      </span>
                    </span>
                  ))}
                </div>
                <button
                  className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-[11px] text-white transition hover:opacity-90 disabled:opacity-40"
                  disabled={!!busy}
                  onClick={async () => {
                    for (const a of typeDef?.actions || []) {
                      await runAction(a, [], { prompt: aiPrompt })
                    }
                  }}
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  按顺序全跑
                </button>
              </div>
            )}

            {/* ── 时间线页签 ── */}
            {tab === 'timeline' &&
              (timelineEnabled ? (
                <SceneTimeline />
              ) : (
                <div className="py-4 text-center text-[10px] text-ink-3">
                  当前场景（{typeDef?.name}）不含时间线
                </div>
              ))}

            {/* ── 素材页签（§38：独立素材库，非画布对象） ── */}
            {tab === 'assets' && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] text-ink-3">
                    AI 生成结果自动存入素材库；点「+」把素材放回画布复用
                  </span>
                  <button
                    className="rounded-md border border-edge px-2 py-0.5 text-[10px] text-ink-2 transition hover:text-ink"
                    onClick={() => void loadAssets()}
                  >
                    刷新
                  </button>
                </div>
                <div className="grid grid-cols-8 gap-1.5">
                  {assetLib.map((a) => (
                    <div
                      key={a.id}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-edge"
                    >
                      <button
                        className="h-full w-full"
                        onClick={() => openLightbox(a.url)}
                        title={a.name || a.type}
                      >
                        {a.type === 'video' ? (
                          <video src={a.url} className="h-full w-full object-cover" muted />
                        ) : (
                          <img src={a.url} alt={a.name || ''} className="h-full w-full object-cover" />
                        )}
                      </button>
                      <button
                        className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
                        title="放入画布"
                        onClick={() => void addAssetToCanvas(a)}
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                  ))}
                  {!assetLib.length && (
                    <div className="col-span-8 py-4 text-center text-[10px] text-ink-3">
                      素材库为空：AI 生成结果会自动存入，点「刷新」查看
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── 历史页签 ── */}
            {tab === 'history' && (
              <div className="space-y-1">
                {runLog.map((l) => (
                  <div key={l.ts} className="flex items-start gap-2 text-[10px]">
                    <span className="shrink-0 text-ink-3">
                      {new Date(l.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                    <span className={`shrink-0 ${l.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {l.ok ? '成功' : '失败'}
                    </span>
                    <span className="shrink-0 text-ink-2">{ACTION_LABELS[l.action] || l.action}</span>
                    <span className="min-w-0 flex-1 break-words text-ink-3">{l.message}</span>
                  </div>
                ))}
                {!runLog.length && (
                  <div className="py-4 text-center text-[10px] text-ink-3">本次会话还没有执行记录</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 页签细栏 */}
      <div className="pointer-events-auto mb-2 flex items-center gap-0.5 rounded-full border border-edge bg-panel/90 px-1.5 py-1 shadow-node-dark backdrop-blur-md">
        {TABS.map((t) => {
          const active = open && tab === t.key
          return (
            <button
              key={t.key}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] transition ${
                active ? 'bg-brand-500 text-white' : 'text-ink-2 hover:bg-hover hover:text-ink'
              }`}
              onClick={() => {
                if (open && tab === t.key) setOpen(false)
                else {
                  setTab(t.key)
                  setOpen(true)
                }
              }}
            >
              {t.icon}
              {t.label}
            </button>
          )
        })}
        <button
          className="ml-0.5 rounded-full p-1 text-ink-3 transition hover:text-ink"
          onClick={() => setOpen(!open)}
          title={open ? '收起' : '展开'}
        >
          {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
      </div>
    </div>
  )
}
