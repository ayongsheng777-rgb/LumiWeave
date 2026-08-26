// V2.3 — 全局 Skill 快捷入口浮窗
// 点击模板一键生成一组带连线的标准工作流（工作流/无限画布双模式通用）
import { useMemo, useState } from 'react'
import { Search, ShoppingBag, Clapperboard, UserRound, Sparkles, X } from 'lucide-react'
import type { Node } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import { defaultDataFor, makeNode, useWorkflowStore } from '../store/workflowStore'
import { useUiStore } from '../store/uiStore'

interface SkillStep {
  type: string
  data?: Record<string, unknown>
}
interface SkillTemplate {
  id: string
  label: string
  desc: string
  icon: React.ReactNode
  chain: SkillStep[]
}

const TEMPLATES: SkillTemplate[] = [
  {
    id: 'full_film',
    label: '一键成片',
    desc: '故事 → 分镜 → 视频 → 字幕 → 导出',
    icon: <Clapperboard size={15} className="text-violet-400" />,
    chain: [
      { type: 'story' },
      { type: 'storyboard' },
      { type: 'video' },
      { type: 'subtitle' },
      { type: 'export', data: { format: 'mp4', include_storyboard: true, include_subtitles: true } },
    ],
  },
  {
    id: 'ecommerce',
    label: '电商商品图',
    desc: '提示词 → 生图 → 海报排版',
    icon: <ShoppingBag size={15} className="text-orange-400" />,
    chain: [
      { type: 'prompt', data: { template: '高级电商商品主图，纯色背景，柔光棚拍，突出产品质感，8k 细节' } },
      { type: 'image' },
      { type: 'layout', data: { template: 'film_poster' } },
    ],
  },
  {
    id: 'character_kit',
    label: '角色设定集',
    desc: '角色 → 场景 → 定妆照',
    icon: <UserRound size={15} className="text-rose-400" />,
    chain: [
      { type: 'character', data: { style: '电影感' } },
      { type: 'scene', data: { style: '电影感', camera: 'medium shot' } },
      { type: 'image', data: { style: '电影感' } },
    ],
  },
]

const STEP_GAP_X = 340

export function SkillFloatingWindow() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const mode = useUiStore((s) => s.mode)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return TEMPLATES
    return TEMPLATES.filter((t) => (t.label + t.desc).toLowerCase().includes(q))
  }, [query])

  const apply = (t: SkillTemplate) => {
    const created: Node[] = []
    if (mode === 'workflow') {
      const wf = useWorkflowStore.getState()
      t.chain.forEach((step, i) => {
        const defaults = defaultDataFor(step.type) || {}
        const node = makeNode(
          step.type,
          { ...defaults, ...(step.data || {}) },
          { x: 120 + i * STEP_GAP_X, y: 200 },
        )
        wf.addNode(node)
        created.push(node)
      })
      for (let i = 0; i < created.length - 1; i++) {
        useWorkflowStore.getState().onConnect({
          source: created[i].id,
          target: created[i + 1].id,
          sourceHandle: null,
          targetHandle: null,
        })
      }
    } else {
      const cs = useCanvasStore.getState()
      t.chain.forEach((step, i) => {
        const node = cs.addObject(step.type, { x: 100 + i * STEP_GAP_X, y: 200 })
        if (step.data && Object.keys(step.data).length > 0) {
          cs.updateObject(node.id, step.data)
        }
        created.push(node)
      })
      for (let i = 0; i < created.length - 1; i++) {
        cs.onConnect({
          source: created[i].id,
          target: created[i + 1].id,
          sourceHandle: null,
          targetHandle: null,
        })
      }
    }
    setOpen(false)
    setQuery('')
  }

  return (
    // 挂在节点库圆钮正下方（左侧中部），面板向下展开——远离右侧 AI 对话发送键
    <div className="pointer-events-none absolute left-3 top-[calc(50%+3.25rem)] z-20">
      <button
        className={`pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-panel text-ink-2 shadow-node-dark transition hover:text-ink ${open ? 'bg-brand-500 !text-white' : ''}`}
        onClick={() => setOpen(!open)}
        title={open ? '收起快捷技能' : '快捷技能：一键生成工作流'}
      >
        <Sparkles size={19} />
      </button>

      {open && (
        <div className="nowheel pointer-events-auto absolute left-0 top-full mt-2 max-h-[calc(50vh-5rem)] w-64 overflow-y-auto rounded-xl border border-edge bg-panel shadow-node-dark">
          <div className="flex items-center gap-2 border-b border-edge px-3 py-2.5">
            <Search size={13} className="shrink-0 text-ink-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-ink-3"
              placeholder="搜索快捷 Skill…"
            />
            <button className="shrink-0 text-ink-3 hover:text-ink" onClick={() => setOpen(false)}>
              <X size={13} />
            </button>
          </div>
          <div className="flex flex-col gap-0.5 p-1.5">
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-ink-3">没有匹配的技能</div>
            )}
            {filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => apply(t)}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-hover"
                title={`一键生成：${t.desc}`}
              >
                <span className="mt-0.5 shrink-0">{t.icon}</span>
                <span className="flex flex-col">
                  <span className="text-xs font-medium text-ink">{t.label}</span>
                  <span className="mt-0.5 text-[10px] leading-snug text-ink-3">{t.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default SkillFloatingWindow
