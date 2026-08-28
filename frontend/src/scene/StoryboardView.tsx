// StoryboardView —— 分镜脚本完整表格共享组件（V2.9b）
// 两处使用：①节点外壳（SceneObjectNode）= 节点自动加宽到完整 13 列，节点上直接查看/编辑
//           ②编辑面板（SceneNodeEditPanel）= 同一表格组件
// 交互：阅读态高亮渲染，点击单元格进入编辑态（textarea），失焦保存、Esc 取消；锁定只读。
import { useEffect, useMemo, useState, type ReactNode } from 'react'

export type AnySb = Record<string, unknown>

export interface TbEntities { chars: string[]; scenes: string[]; props: string[] }

/** 从全部分镜收集 角色/场景/道具 词库（用于彩色高亮） */
export function collectStoryEntities(shots: unknown[]): TbEntities {
  const chars = new Set<string>()
  const scenes = new Set<string>()
  const props = new Set<string>()
  for (const s of shots) {
    const sb = ((s || {}) as AnySb) as Record<string, unknown>
    const c = String(sb.character ?? '').trim()
    if (c && c !== '-') chars.add(c)
    const sc = String(sb.scene ?? sb.location ?? '').trim()
    if (sc && sc !== '-') scenes.add(sc)
    const ps = Array.isArray(sb.props)
      ? (sb.props as unknown[]).map((x) => String(x).trim())
      : String(sb.props ?? '').split(/[、,，]/).map((x) => x.trim()).filter(Boolean)
    ps.forEach((p) => { if (p && p !== '-') props.add(p) })
  }
  return { chars: [...chars], scenes: [...scenes], props: [...props] }
}

/** 实体词高亮渲染：角色=琥珀、场景=青、道具=黄绿（长词优先匹配，避免短词截断） */
export function HiText({ text, entities }: { text: string; entities: TbEntities }) {
  const t = String(text ?? '').trim()
  if (!t || t === '-') return <span className="text-ink-3">-</span>
  const pool: { word: string; cls: string }[] = [
    ...entities.chars.map((w) => ({ word: w, cls: 'font-medium text-amber-600 dark:text-amber-400' })),
    ...entities.scenes.map((w) => ({ word: w, cls: 'font-medium text-cyan-600 dark:text-cyan-400' })),
    ...entities.props.map((w) => ({ word: w, cls: 'font-medium text-lime-600 dark:text-lime-400' })),
  ]
    .filter((e) => e.word && e.word.length >= 2)
    .sort((a, b) => b.word.length - a.word.length)
  if (!pool.length) return <>{t}</>
  const out: ReactNode[] = []
  let rest = t
  let guard = 0
  while (rest && guard++ < 200) {
    let hitPos = -1
    let hitWord = ''
    let hitCls = ''
    for (const e of pool) {
      const p = rest.indexOf(e.word)
      if (p >= 0 && (hitPos < 0 || p < hitPos)) {
        hitPos = p
        hitWord = e.word
        hitCls = e.cls
      }
    }
    if (hitPos < 0) {
      out.push(rest)
      break
    }
    if (hitPos > 0) out.push(rest.slice(0, hitPos))
    out.push(<span key={out.length} className={hitCls}>{hitWord}</span>)
    rest = rest.slice(hitPos + hitWord.length)
  }
  return <>{out}</>
}

export const cellVal = (sb: Record<string, unknown>, k: string): string =>
  k === 'props'
    ? Array.isArray(sb[k]) ? (sb[k] as unknown[]).join('、') : String(sb[k] ?? '')
    : String(sb[k] ?? '')

export const shotNoLabel = (sb: Record<string, unknown>, idx: number): string =>
  `#01_${String(sb.shot_no ?? idx + 1).padStart(2, '0')}`

/** 完整表格宽度（13 列），节点自动加宽到此值 */
export const STORYBOARD_TABLE_W = 1480

// ─────────────────────────────────────────────────────────────────────────────
// 完整表格：13 列横向，点击单元格编辑
// ─────────────────────────────────────────────────────────────────────────────
type TbCol = { key: string; label: string; cls: string }
const TB_COLS: TbCol[] = [
  { key: 'duration', label: '时长(秒)', cls: 'w-14 shrink-0' },
  { key: 'description', label: '画面描述', cls: 'min-w-[220px] flex-1' },
  { key: 'shot_size', label: '景别', cls: 'w-14 shrink-0' },
  { key: 'character', label: '角色', cls: 'w-20 shrink-0' },
  { key: 'scene', label: '场景', cls: 'w-20 shrink-0' },
  { key: 'props', label: '道具', cls: 'w-20 shrink-0' },
  { key: 'lighting', label: '光影', cls: 'min-w-[130px] flex-1' },
  { key: 'sound_effect', label: '音效', cls: 'min-w-[120px] flex-1' },
  { key: 'dialogue', label: '对白', cls: 'min-w-[120px] flex-1' },
  { key: 'voice_over', label: '旁白', cls: 'min-w-[120px] flex-1' },
  { key: 'prompt', label: '分镜提示词', cls: 'min-w-[200px] flex-1' },
  { key: 'camera_control_description', label: '镜头控制描述', cls: 'min-w-[140px] flex-1' },
]

/** 表格单元格：阅读态（高亮渲染）→ 点击进入编辑态（textarea），失焦保存 */
function TbCell({
  value,
  entities,
  locked,
  onSave,
}: {
  value: string
  entities: TbEntities
  locked: boolean
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  if (locked || !editing) {
    return (
      <div
        className={`h-full w-full whitespace-pre-wrap break-words px-2 py-2 leading-relaxed ${
          locked ? 'cursor-default' : 'cursor-text hover:bg-[var(--lw-hover)]'
        }`}
        onClick={() => { if (!locked) setEditing(true) }}
        title={locked ? undefined : '点击编辑'}
      >
        <HiText text={value} entities={entities} />
      </div>
    )
  }
  return (
    <textarea
      autoFocus
      className="nodrag nowheel h-full min-h-[56px] w-full resize-y bg-[var(--lw-input-bg)] px-2 py-2 text-[10px] leading-relaxed text-ink outline-none focus:ring-1 focus:ring-brand-500"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { onSave(draft); setEditing(false) }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { setDraft(value); setEditing(false) }
      }}
    />
  )
}

/**
 * 完整 13 列分镜表格（节点外壳 + 编辑面板共用）
 * @param shots   分镜数组（payload.shots）
 * @param locked  锁定只读
 * @param onPatch 编辑回写（更新后的 shots 数组）
 */
export function StoryboardTable({
  shots,
  locked,
  onPatch,
}: {
  shots: unknown[]
  locked: boolean
  onPatch: (nextShots: unknown[]) => void
}) {
  const entities = useMemo(() => collectStoryEntities(shots), [shots])
  const setShot = (i: number, k: string, v: string) => {
    const next = shots.map((s, j) => {
      if (j !== i) return s
      const sb = (s || {}) as AnySb
      if (k === 'props') {
        return { ...sb, props: v.split(/[、,，]/).map((x) => x.trim()).filter(Boolean) }
      }
      return { ...sb, [k]: v }
    })
    onPatch(next)
  }
  if (!shots.length) {
    return (
      <div className="flex min-h-[46px] items-center justify-center rounded-lg border border-dashed border-edge px-2 py-2 text-[11px] text-ink-3">
        暂无分镜——双击打开编辑面板用 AI 生成
      </div>
    )
  }
  return (
    <div className="max-h-[70vh] overflow-auto nowheel rounded-lg border border-edge">
      <div className="min-w-[1480px]">
        {/* 表头（固定，滚动不跟随） */}
        <div className="sticky top-0 z-10 flex items-stretch border-b border-white/10 bg-slate-800 text-[10px] font-semibold text-white dark:bg-slate-800">
          <div className="w-16 shrink-0 px-2 py-1.5 text-violet-300">镜号</div>
          {TB_COLS.map((c) => (
            <div key={c.key} className={`${c.cls} px-2 py-1.5`}>{c.label}</div>
          ))}
        </div>
        {/* 数据行 */}
        {shots.map((s, i) => {
          const sb = ((s || {}) as AnySb) as Record<string, unknown>
          return (
            <div
              key={i}
              className="flex items-stretch border-b border-[var(--lw-edge)] last:border-b-0 hover:bg-[var(--lw-hover)]"
            >
              <div className="w-16 shrink-0 px-2 py-2 font-mono text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                {shotNoLabel(sb, i)}
              </div>
              {TB_COLS.map((c) => (
                <div key={c.key} className={`${c.cls} min-h-[56px]`}>
                  <TbCell
                    value={cellVal(sb, c.key)}
                    entities={entities}
                    locked={locked}
                    onSave={(v) => setShot(i, c.key, v)}
                  />
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
