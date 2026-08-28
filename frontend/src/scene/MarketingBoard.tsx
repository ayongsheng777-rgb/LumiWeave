// MarketingBoard —— 结构化商品广告片制作板渲染（V2.8 电商物料）
// 消费 story 节点 payload.board（结构化 JSON，由 generate_visual_board 动作生成），
// 按专业 Production Board 版式渲染：顶部 campaign / 左栏卖点利益点 / 角色与场景 / 8镜头故事板 / 底部灯光情绪音频。
// 图片只是视觉参考，所有内容来自 JSON（可被其它节点按字段 ID/关键词检索引用）。
import type { AnyObj } from './sceneScript'

const SHOT_KEYS: Record<string, string> = {
  shot_size: '景别', camera_angle: '机位', camera_movement: '运镜',
  lighting: '灯光', color: '色调', mood: '情绪', duration: '时长',
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-edge">
      <div className="border-b border-edge px-2 py-1 text-[10px] font-medium tracking-wide" style={{ color, background: 'var(--lw-soft)' }}>
        {title}
      </div>
      <div className="p-1.5">{children}</div>
    </div>
  )
}

function Chip({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="inline-block rounded-full px-1.5 py-0.5 text-[10px]"
      style={{ background: 'var(--lw-soft)', color: color || 'var(--lw-ink-2)' }}
    >
      {children}
    </span>
  )
}

export default function MarketingBoard({ board }: { board: AnyObj }) {
  const innerBoard = (board.board as AnyObj | undefined) || {}
  const campaign = (innerBoard.campaign as AnyObj | undefined) || (board.campaign as AnyObj | undefined) || {}
  const product = (board.product as AnyObj) || {}
  const characters = Array.isArray(board.characters) ? (board.characters as AnyObj[]) : []
  const scenes = Array.isArray(board.scenes) ? (board.scenes as AnyObj[]) : []
  const shots = Array.isArray(board.shots) ? (board.shots as AnyObj[]) : []
  const lighting = Array.isArray(board.lighting) ? (board.lighting as AnyObj[]) : []
  const moods = Array.isArray(board.moods) ? (board.moods as AnyObj[]) : []
  const audio = Array.isArray(board.audio) ? (board.audio as AnyObj[]) : []
  const keywords = (board.keywords as AnyObj) || {}
  const keyFeatures = Array.isArray(innerBoard.key_features) ? (innerBoard.key_features as string[]) : []
  const benefits = Array.isArray(innerBoard.benefits) ? (innerBoard.benefits as string[]) : []

  return (
    <div className="space-y-1.5">
      {/* 顶部：Campaign */}
      <div className="rounded-lg border border-brand-500/30 bg-brand-500/5 px-2 py-1.5">
        <div className="text-[11px] font-medium text-ink">
          {String(campaign.brand || '')} {String(campaign.product || '')}
          {campaign.theme ? ` · ${String(campaign.theme)}` : ''}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-ink-2">
          {campaign.visual_direction ? <Chip>视觉方向：{String(campaign.visual_direction)}</Chip> : null}
          {campaign.aspect_ratio ? <Chip>比例：{String(campaign.aspect_ratio)}</Chip> : null}
          {campaign.platform ? <Chip>平台：{String(campaign.platform)}</Chip> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {/* 左：卖点 / 利益点 */}
        <Section title="KEY FEATURES · 产品卖点" color="#f59e0b">
          {(keyFeatures.length ? keyFeatures : (product.features as string[] | undefined) || []).map((f, i) => (
            <div key={i} className="border-b border-edge/60 py-0.5 text-[10px] text-ink-2 last:border-0">• {String(f)}</div>
          ))}
          {!keyFeatures.length && !Array.isArray(product.features) && <div className="text-[10px] text-ink-3">暂无卖点</div>}
        </Section>
        <Section title="BENEFITS · 利益点" color="#10b981">
          {benefits.map((b, i) => (
            <div key={i} className="border-b border-edge/60 py-0.5 text-[10px] text-ink-2 last:border-0">• {String(b)}</div>
          ))}
          {!benefits.length && <div className="text-[10px] text-ink-3">暂无利益点</div>}
        </Section>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {/* 角色 / 场景 */}
        <Section title={`TALENT · 角色（${characters.length}）`} color="#ec4899">
          {characters.map((c) => (
            <div key={String(c.character_id || c.name)} className="mb-1 rounded bg-soft px-1.5 py-1">
              <div className="text-[10px] font-medium text-ink">{String(c.name || '')}</div>
              <div className="text-[9px] text-ink-3">{String(c.type || '')} · {String(c.age_range || '')} · {String(c.hair || '')} · {String(c.outfit || '')}</div>
              <div className="mt-0.5 flex flex-wrap gap-0.5">
                {(c.keywords as string[] | undefined)?.slice(0, 4).map((k, i) => <Chip key={i}>{String(k)}</Chip>)}
              </div>
            </div>
          ))}
          {!characters.length && <div className="text-[10px] text-ink-3">暂无角色</div>}
        </Section>
        <Section title={`SCENE · 场景（${scenes.length}）`} color="#06b6d4">
          {scenes.map((s) => (
            <div key={String(s.scene_id || s.name)} className="mb-1 rounded bg-soft px-1.5 py-1">
              <div className="text-[10px] font-medium text-ink">{String(s.name || '')}</div>
              <div className="text-[9px] text-ink-3">{String(s.time || '')} · {String(s.weather || '')} · {String(s.lighting || '')}</div>
              <div className="mt-0.5 flex flex-wrap gap-0.5">
                {(s.environment as string[] | undefined)?.slice(0, 3).map((k, i) => <Chip key={i}>{String(k)}</Chip>)}
              </div>
            </div>
          ))}
          {!scenes.length && <div className="text-[10px] text-ink-3">暂无场景</div>}
        </Section>
      </div>

      {/* 故事板：镜头卡片 */}
      <Section title={`STORYBOARD · 镜头故事板（${shots.length}）`} color="#8b5cf6">
        {shots.length ? (
          <div className="grid grid-cols-2 gap-1">
            {shots.map((sh, i) => (
              <div key={String(sh.shot_id || i)} className="rounded bg-soft px-1.5 py-1">
                <div className="flex items-center gap-1">
                  <span className="rounded bg-brand-500/15 px-1 text-[9px] font-medium text-brand-300">
                    {String(sh.shot_number || i + 1).padStart(2, '0')}
                  </span>
                  <span className="truncate text-[10px] font-medium text-ink">{String(sh.title || sh.story_role || '')}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {Object.entries(SHOT_KEYS).map(([k, label]) =>
                    sh[k] ? <Chip key={k}>{label}:{String(sh[k])}</Chip> : null,
                  )}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[9px] leading-snug text-ink-3">{String(sh.action || sh.image_prompt || '')}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-ink-3">暂无镜头（在编辑面板用 AI 生成视觉规划板）</div>
        )}
      </Section>

      {/* 底部：灯光 / 情绪 / 音频 */}
      <div className="grid grid-cols-3 gap-1.5">
        <Section title="LIGHTING" color="#f97316">
          {lighting.map((l, i) => (
            <div key={i} className="py-0.5 text-[9px] text-ink-2">{String(l.lighting_type || '')} · {String(l.key_light || '')}</div>
          ))}
          {!lighting.length && <div className="text-[9px] text-ink-3">—</div>}
        </Section>
        <Section title="MOOD" color="#14b8a6">
          {moods.map((m, i) => (
            <div key={i} className="py-0.5 text-[9px] text-ink-2">
              {String(m.name || '')} {(m.emotion as string[] | undefined)?.slice(0, 3).join('/')}
            </div>
          ))}
          {!moods.length && <div className="text-[9px] text-ink-3">—</div>}
        </Section>
        <Section title="AUDIO" color="#a855f7">
          {audio.map((a, i) => (
            <div key={i} className="py-0.5 text-[9px] text-ink-2">
              {String(a.music_style || '')} · {String(a.music_tempo || '')}
            </div>
          ))}
          {!audio.length && <div className="text-[9px] text-ink-3">—</div>}
        </Section>
      </div>

      {/* 关键词云 */}
      {Object.keys(keywords).length > 0 && (
        <div className="rounded-lg border border-edge px-2 py-1.5">
          <div className="mb-1 text-[9px] text-ink-3">KEYWORDS</div>
          <div className="flex flex-wrap gap-0.5">
            {Object.entries(keywords).flatMap(([cat, list]) =>
              (list as string[]).map((k, i) => <Chip key={`${cat}-${i}`}>{String(cat)}:{String(k)}</Chip>),
            )}
          </div>
        </div>
      )}
    </div>
  )
}
