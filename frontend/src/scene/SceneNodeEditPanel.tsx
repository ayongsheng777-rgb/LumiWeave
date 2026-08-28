// SceneNodeEditPanel —— 场景对象编辑面板（V2.8 UI 重构）
// 节点改为「内容优先」外壳后，全部编辑能力收敛到此面板，由 SceneNodeModal 弹窗承载。
// 内容：6 个专用编辑器 + 通用字段渲染 + 场景动作按钮（从 SceneObjectNode 迁移）。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Sparkles, Send, LayoutGrid, Clock, ChevronDown, Wand2 } from 'lucide-react'
import { useSceneStore, ACTION_LABELS } from '../store/sceneStore'
import { CAMERA_ZH, cameraLabel } from '../cameraLabels'
import type { SceneTypeDef } from '../api'
import { aiChat, getProfiles, getSkills } from '../api'
import MarketingBoard from './MarketingBoard'
import SceneFieldPopover from './SceneFieldPopover'
import SceneTextWriter from './SceneTextWriter'
import SceneImageEditor from './SceneImageEditor'
import SceneVideoEditor from './SceneVideoEditor'
import SceneAudioEditor from './SceneAudioEditor'
import { type AnyObj, type ParsedScript, EMPTY_PARSED, isStoryNode, parseShotsFromScript, parseCharacters, parsePropsList } from './sceneScript'
import SkillPicker from './SkillPicker'
import { StoryboardTable } from './StoryboardView'

/** 长文本字段 → 用 AI 对话弹窗编辑 */
const LONG_TEXT_KEYS = new Set([
  'description', 'prompt', 'text', 'summary', 'analysis', 'dialogue',
  'appearance', 'marketing_plan', 'composition',
])
/** 镜头术语字段 → 中英双文下拉 */
const CAMERA_KEYS = new Set(['camera', 'motion', 'shot_size', 'camera_motion', 'lens'])
const CAMERA_OPTIONS = Object.keys(CAMERA_ZH)

/** 该类型在当前场景下可用的场景动作（V2.8 精简：只保留商品节点的场景动作；图片/视频/音频生成已在各自编辑器内） */
function sceneActionsFor(objectType: string, typeDef?: SceneTypeDef | null): string[] {
  if (objectType !== 'product') return []
  const acts = typeDef?.actions || []
  return acts.filter((a) =>
    ['analyze_product', 'generate_strategy', 'generate_main_image', 'generate_scene_image', 'generate_poster', 'generate_detail_page', 'batch_generate'].includes(a),
  )
}

type Payload = Record<string, unknown>

// ── 图片用途 / 音频类型 动态选项 ──
const PURPOSE_OPTS = ['人物', '道具', '分镜']
const AUDIO_TYPE_OPTS = ['配音', 'BGM', '音效', '对白']

// ── 剧情/文本生成：系统提示词 + 内嵌 AI 输入条（从 SceneObjectNode 迁移）──
const STORY_SYSTEM_PROMPT = `你是顶级短视频编剧与"短剧带货"文案专家。请严格按以下专业结构生成剧本，直接输出 markdown，不要开场白或多余解释：

# 项目设定
- 视频类型：（产品广告 / 剧情短剧 / 种草视频）
- 总时长：（严格对齐用户给定值）
- 目标受众：（人群画像）
- 情感基调：（轻松 / 温馨 / 悬疑 / 反转等）
- 叙事结构：（问题-解决方案 / 起承转合等）

# 出场元素
- 人物：（姓名 / 性别 / 年龄 / 性格 / 造型）
- 道具：（关键器物）
- 分镜：（地点 / 时间）

# 故事大纲
（用 1-2 句话概括全片）

# 情绪曲线
（如 平静 → 紧张 → 反转 → 温暖，并标注对应时间点）

# 分镜剧本
按用户给定的"分镜个数"拆成 N 个分镜，每个分镜可拆多个镜头，必须包含：
## 分镜X：（地点，时间）
- 分镜目标：（本分镜要达成的叙事 / 情绪目的）
- 情绪基调：
- 背景音乐：（分镜X音乐，按该分镜情绪描述 BGM）
- 关键画面（每行一个镜头，编号 镜头X-1、镜头X-2...）：
  - 镜头X-1：（镜头级视觉描述，含景别 / 动作特写）
- 对白 / 旁白：（角色台词，需标注说话人）
- 时长：约 X 秒（所有分镜时长之和 ≈ 总时长）

# 整体节奏与风格说明
（节奏快慢、转场方式、背景音乐、色调、镜头语言）

# 核心信息点对应
（将产品卖点 / 品牌主张逐一对应到具体场景）

硬性要求：
1. 总时长与分镜个数必须严格遵循用户输入；各场景时长之和 ≈ 总时长，单段 ≈（总时长 ÷ 分镜个数）秒。
2. 对白要有冲突与反转，节奏紧凑适合短剧；若为带货类，需自然植入产品卖点，不硬广。
3. 若用户未给定总时长 / 分镜个数，则按 30-60 秒、4-6 个分镜合理规划。
4. 输出为可直接用于拍摄的中文脚本，结构完整、可读性强。`

type AnyProfile = { id: string; name?: string; model?: string }

function InlineAiBar({
  id,
  onResult,
  disabled,
  withTiming = true,
  systemPrompt = STORY_SYSTEM_PROMPT,
  getContextExtra,
  actionRoute,
  skillRef,
}: {
  id: string
  onResult: (text: string) => void
  disabled?: boolean
  withTiming?: boolean
  systemPrompt?: string
  getContextExtra?: () => string
  actionRoute?: string
  skillRef?: string
}) {
  const patchObject = useSceneStore((s) => s.patchObject)
  const runAction = useSceneStore((s) => s.runAction)
  const duration = useSceneStore(
    (s) => Number((((s.objects.find((o) => o.id === id)?.data as Payload)?.payload as Payload)?.duration) || 0),
  )
  const shotCount = useSceneStore(
    (s) => Number((((s.objects.find((o) => o.id === id)?.data as Payload)?.payload as Payload)?.shotCount) || 0),
  )
  const [prompt, setPrompt] = useState('')
  const [profiles, setProfiles] = useState<AnyProfile[]>([])
  const [profileId, setProfileId] = useState('')
  const [running, setRunning] = useState(false)
  useEffect(() => {
    getProfiles().then((res) => {
      const list = (res.ok ? (res.data as { profiles?: AnyProfile[] }).profiles : []) || []
      setProfiles(list)
      if (list.length && !profileId) setProfileId(list[0].id)
    })
  }, [])
  const per = duration > 0 && shotCount > 0 ? (duration / shotCount).toFixed(1) : '—'
  const send = useCallback(async () => {
    if (!prompt.trim() || running || disabled) return
    setRunning(true)
    if (actionRoute) {
      await runAction(actionRoute, [id], {
        prompt: prompt.trim(),
        profile_id: profileId || undefined,
        skill_ref: skillRef || undefined,
        ...(withTiming
          ? { duration: duration > 0 ? duration : undefined, shotCount: shotCount > 0 ? shotCount : undefined }
          : {}),
      })
      setRunning(false)
      const obj = useSceneStore.getState().objects.find((o) => o.id === id)
      const script = String((((obj?.data as Payload)?.payload as Payload)?.script) ?? '')
      if (script) onResult(script)
      setPrompt('')
      return
    }
    const parts: string[] = []
    if (withTiming && duration > 0) parts.push(`【总时长】${duration} 秒`)
    if (withTiming && shotCount > 0) parts.push(`【分镜个数】${shotCount} 个（每段约 ${per} 秒）`)
    const extra = getContextExtra ? getContextExtra() : ''
    if (extra) parts.push(extra)
    parts.push(`【创作要求】${prompt.trim()}`)
    const res = await aiChat({
      system: systemPrompt,
      user: parts.join('\n'),
      profile_id: profileId || undefined,
      scenario: 'general',
    })
    setRunning(false)
    if (res.ok && (res.data as { result?: string } | undefined)?.result) {
      onResult(String((res.data as { result: string }).result))
      setPrompt('')
    }
  }, [prompt, running, disabled, profileId, onResult, withTiming, systemPrompt, getContextExtra, duration, shotCount, per, actionRoute, runAction, id, skillRef])

  return (
    <div className="border-t border-edge pt-2 space-y-2">
      <div className="flex items-center gap-1.5">
        <select
          className="h-8 shrink-0 rounded-md border border-edge bg-input px-1.5 text-sm text-ink outline-none focus:border-brand-500"
          style={{ minWidth: 150, maxWidth: 180 }}
          value={profileId}
          disabled={disabled || running}
          onChange={(e) => setProfileId(e.target.value)}
        >
          {profiles.length === 0 && <option value="">模型加载中...</option>}
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.id}
              {p.model ? ` · ${p.model}` : ''}
            </option>
          ))}
        </select>
        {withTiming && (
          <>
            <input
              type="number"
              className="nodrag h-8 w-16 shrink-0 rounded-md border border-edge bg-input px-1.5 text-sm text-ink outline-none focus:border-brand-500"
              placeholder="总时长s"
              value={duration || ''}
              disabled={disabled || running}
              onChange={(e) => patchObject(id, { duration: Number(e.target.value) })}
            />
            <input
              type="number"
              className="nodrag h-8 w-14 shrink-0 rounded-md border border-edge bg-input px-1.5 text-sm text-ink outline-none focus:border-brand-500"
              placeholder="分镜数"
              value={shotCount || ''}
              disabled={disabled || running}
              onChange={(e) => patchObject(id, { shotCount: Number(e.target.value) })}
            />
          </>
        )}
      </div>
      {withTiming && (
        <div className="text-[11px] text-ink-3">
          分镜时长：每段约 <b className="text-ink">{per}</b> 秒（总时长 ÷ 分镜个数）
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <textarea
          className="nodrag nowheel min-h-8 max-h-40 min-w-0 flex-1 resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
          placeholder="告诉我写什么，回车发送（Shift+Enter 换行）"
          rows={Math.min(12, Math.max(1, prompt.split('\n').length))}
          value={prompt}
          disabled={disabled || running}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button
          className="nodrag flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-500 text-white transition hover:bg-brand-600 disabled:opacity-40"
          disabled={disabled || running || !prompt.trim()}
          onClick={() => void send()}
        >
          {running ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
    </div>
  )
}

/** 剧情节点：梗概+正文合并编辑框 + AI 输入条；电商物料场景额外有「视觉规划板」视图（结构化制作板） */
function SceneStoryEditor({ id, payload, locked }: { id: string; payload: Payload; locked: boolean }) {
  const patchObject = useSceneStore((s) => s.patchObject)
  const runAction = useSceneStore((s) => s.runAction)
  const busy = useSceneStore((s) => s.busy)
  const typeDef = useSceneStore((s) => s.currentTypeDef())
  // 仅当场景动作含 generate_visual_board（电商物料）时显示制作板入口，另两个场景保持纯剧本编辑
  const canBoard = Array.isArray(typeDef?.actions) && typeDef!.actions.includes('generate_visual_board')
  // 影视拉片场景：文案驱动（文本节点 → 三幕式故事 → 全字段分镜）
  const isFilm = Array.isArray(typeDef?.actions) && typeDef!.actions.includes('generate_story_from_text')
  const structure = payload.structure as Payload | undefined
  const emotionCurve = (payload.emotion_curve as Payload[]) || []
  const storyboard = (payload.storyboard as Payload[]) || []
  const combined = [String(payload.summary ?? '').trim(), String(payload.text ?? '').trim()]
    .filter(Boolean)
    .join('\n\n')
  const [value, setValue] = useState(combined)
  const [view, setView] = useState<'edit' | 'board'>('edit')
  const board = payload.board as Payload | undefined
  // 技能库选择（V2.9l：注入技能指令提升剧本画面/提示词质量；知识库走后端自动 RAG）
  const [skills, setSkills] = useState<AnyObj[]>([])
  const [skillId, setSkillId] = useState(String(payload.skill_ref ?? ''))
  useEffect(() => {
    getSkills()
      .then((r) => {
        const d = r.data as AnyObj
        const list = Array.isArray(d) ? d : Array.isArray((d as AnyObj)?.skills) ? (d as AnyObj).skills : []
        setSkills((list as AnyObj[]) || [])
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    setValue(combined)
  }, [combined])
  return (
    <div className="flex h-full min-h-[120px] flex-col gap-2">
      {/* 工具栏：视图切换 + 生成视觉规划板（仅电商物料场景） */}
      {canBoard && (
        <div className="flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-md border border-edge">
            <button
              className={`px-2 py-1 text-[11px] transition ${view === 'edit' ? 'bg-brand-600 text-white' : 'bg-soft text-ink-2'}`}
              onClick={() => setView('edit')}
            >
              剧本编辑
            </button>
            <button
              className={`flex items-center gap-1 px-2 py-1 text-[11px] transition ${view === 'board' ? 'bg-brand-600 text-white' : 'bg-soft text-ink-2'}`}
              onClick={() => setView('board')}
              disabled={!board}
              title={board ? '查看结构化视觉规划板' : '先生成视觉规划板'}
            >
              <LayoutGrid size={11} /> 制作板
            </button>
          </div>
          <button
            className="nodrag flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-brand-600 text-[11px] text-white transition hover:bg-brand-500 disabled:opacity-50"
            disabled={locked || !!busy}
            onClick={() => void runAction('generate_visual_board', [id])}
            title="AI 生成结构化商品广告片制作板（角色/场景/镜头/灯光/情绪/音效，可被其它节点引用）"
          >
            {busy === 'generate_visual_board' ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {busy === 'generate_visual_board' ? '生成中…' : board ? '重新生成制作板' : '生成视觉规划板'}
          </button>
        </div>
      )}

      {canBoard && view === 'board' && board ? (
        <MarketingBoard board={board} />
      ) : (
        <>
          <textarea
            className="nodrag nowheel w-full flex-1 resize-y rounded-md border border-edge bg-input p-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
            style={{ minHeight: 120 }}
            disabled={locked}
            value={value}
            placeholder="输入或生成剧本梗概与正文..."
            onChange={(e) => {
              setValue(e.target.value)
              patchObject(id, { text: e.target.value })
            }}
          />
          <InlineAiBar
            id={id}
            onResult={(text) => patchObject(id, { script: text, text })}
            disabled={locked}
            actionRoute="generate_story"
            skillRef={skillId || undefined}
          />
          {/* ── 技能库选择（注入剧本生成质量；知识库后端自动 RAG） ── */}
          <SkillPicker
            value={skillId}
            skills={skills}
            disabled={locked || !!busy}
            onChange={(v) => { setSkillId(v); patchObject(id, { skill_ref: v }) }}
          />
          {/* ── 影视拉片（文案驱动）：从文本生成三幕式故事 + 全字段分镜 ── */}
          {isFilm && (
            <div className="flex items-center gap-1.5">
              <button
                className="nodrag flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-brand-600 text-[11px] text-white transition hover:bg-brand-500 disabled:opacity-50"
                disabled={locked || !!busy}
                onClick={() =>
                  void runAction('generate_story_from_text', [id], {
                    duration: Number(payload.duration) || undefined,
                    shotCount: Number(payload.shotCount) || undefined,
                    skill_ref: skillId || undefined,
                  })
                }
                title="从画布中的「文本」节点取原始故事，AI 生成三幕式结构 + 情绪曲线 + 人物/场景/道具"
              >
                {busy === 'generate_story_from_text' ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {busy === 'generate_story_from_text' ? '生成中…' : '从文本生成故事'}
              </button>
              <button
                className="nodrag flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-brand-500/40 bg-brand-500/10 text-[11px] text-brand-300 transition hover:bg-brand-500/20 disabled:opacity-50"
                disabled={locked || !!busy}
                onClick={() => void runAction('generate_storyboard', [id])}
                title="基于当前故事生成完整分镜表（景别/运镜/光影/对白/动作/提示词）"
              >
                {busy === 'generate_storyboard' ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {busy === 'generate_storyboard' ? '生成中…' : '生成分镜'}
              </button>
            </div>
          )}
          {isFilm && <FilmAnalysisPanels structure={structure} emotionCurve={emotionCurve} storyboard={storyboard} />}
        </>
      )}
    </div>
  )
}

// ── 影视拉片展示：三幕式结构 + 情绪曲线 + 全字段分镜表 ──
const EMOTION_COLORS: Record<string, string> = {
  '苍凉': '#64748b', '悲凉': '#475569', '孤独': '#7c8ba1', '压抑': '#57534e',
  '震撼': '#8b5cf6', '激动': '#ec4899', '紧张': '#ef4444', '危机': '#f97316',
  '坚定': '#10b981', '希望': '#22c55e', '温馨': '#f59e0b', '喜悦': '#eab308',
  '平静': '#3b82f6', '宁静': '#0ea5e9', '悬疑': '#14b8a6',
}
const emoColor = (e: string) => EMOTION_COLORS[String(e || '').trim()] || '#8b5cf6'

function FilmAnalysisPanels({ structure, emotionCurve, storyboard }: {
  structure?: Payload
  emotionCurve: Payload[]
  storyboard: Payload[]
}) {
  if (!structure && emotionCurve.length === 0 && storyboard.length === 0) return null
  return (
    <div className="space-y-2">
      {/* 三幕式结构 */}
      {structure && (Object.keys(structure).length > 0) && (
        <div className="rounded-lg border border-edge bg-canvas p-2">
          <div className="mb-1.5 text-[10px] font-semibold text-ink-2">三幕式结构</div>
          <div className="grid grid-cols-3 gap-1.5">
            {['act1', 'act2', 'act3'].map((k, i) => {
              const label = i === 0 ? '第一幕·铺垫' : i === 1 ? '第二幕·冲突' : '第三幕·高潮'
              const text = String((structure as Record<string, unknown>)[k] ?? '')
              if (!text) return null
              return (
                <div key={k} className="rounded-md bg-soft p-1.5">
                  <div className="mb-0.5 text-[9px] font-medium text-brand-300">{label}</div>
                  <div className="line-clamp-4 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-ink-2">{text}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 情绪曲线：横向色带 */}
      {emotionCurve.length > 0 && (
        <div className="rounded-lg border border-edge bg-canvas p-2">
          <div className="mb-1.5 text-[10px] font-semibold text-ink-2">情绪曲线</div>
          <div className="flex h-8 w-full overflow-hidden rounded-md">
            {emotionCurve.map((p, i) => (
              <div
                key={i}
                className="flex flex-1 items-center justify-center text-[9px] font-medium text-white"
                style={{ background: emoColor(String(p.emotion ?? '')) }}
                title={`${String(p.phase ?? '')}：${String(p.emotion ?? '')}${p.note ? `（${String(p.note)}）` : ''}`}
              >
                {String(p.emotion ?? '')}
              </div>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {emotionCurve.map((p, i) => (
              <span key={i} className="rounded bg-soft px-1 py-0.5 text-[9px] text-ink-3">
                {String(p.phase ?? '')} · {String(p.emotion ?? '')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 全字段分镜表 */}
      {storyboard.length > 0 && (
        <div className="rounded-lg border border-edge bg-canvas p-2">
          <div className="mb-1.5 text-[10px] font-semibold text-ink-2">分镜表（{storyboard.length}）</div>
          <div className="max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
            {storyboard.map((s, i) => {
              const sb = (s || {}) as Record<string, unknown>
              return (
                <div key={i} className="rounded-md border border-edge bg-soft/50 p-1.5">
                  <div className="flex flex-wrap items-center gap-1 text-[9px] text-ink-2">
                    <span className="rounded bg-brand-500/15 px-1 py-0.5 font-semibold text-brand-300">镜头 {String(sb.shot_no ?? i + 1)}</span>
                    {sb.duration != null && <span className="rounded bg-soft px-1 py-0.5">{String(sb.duration)}s</span>}
                    {Boolean(sb.shot_size) && <span className="rounded bg-soft px-1 py-0.5">景别 {String(sb.shot_size)}</span>}
                    {Boolean(sb.camera_motion) && <span className="rounded bg-soft px-1 py-0.5">运镜 {String(sb.camera_motion)}</span>}
                    {Boolean(sb.lighting) && <span className="rounded bg-soft px-1 py-0.5">光 {String(sb.lighting)}</span>}
                    {Boolean(sb.color) && <span className="rounded bg-soft px-1 py-0.5">调 {String(sb.color)}</span>}
                  </div>
                  {Boolean(sb.description) && (
                    <div className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-ink-2">{String(sb.description)}</div>
                  )}
                  {Boolean(sb.character) && (
                    <div className="mt-0.5 text-[9px] text-ink-3">人物：{String(sb.character)}{Boolean(sb.character_action) ? ` · ${String(sb.character_action)}` : ''}</div>
                  )}
                  {Boolean(sb.dialogue) && (
                    <div className="mt-0.5 rounded bg-soft px-1 py-0.5 text-[9px] text-ink-3">对白：{String(sb.dialogue)}</div>
                  )}
                  {Boolean(sb.prompt) && (
                    <div className="mt-0.5 line-clamp-2 break-words text-[9px] leading-relaxed text-ink-3">提示词：{String(sb.prompt)}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 分镜对话框：下拉定义面板选项 ──
const SHOT_SIZE_OPTS = ['远景', '全景', '中景', '近景', '特写', '大特写', '过肩', '俯拍', '仰拍']
const MOTION_OPTS = ['静止', '推近', '拉远', '左摇', '右摇', '上摇', '下摇', '跟拍', '环绕', '手持', '航拍']
const RATIO_OPTS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const RES_OPTS = ['720p', '1080p', '2K', '4K']
const LIGHT_OPTS = ['自然光', '暖光', '冷光', '柔光', '硬光', '逆光', '侧光', '顶光', '夜景']
const SHOT_DIALOG_SYSTEM_PROMPT = `你是短视频分镜提示词专家。根据用户给定的分镜提示词和镜头定义（景别/运镜/视频比例/清晰度/灯光），把分镜提示词优化成可直接用于视频生成模型的高质量中文提示词：画面具体、有镜头感、含光线与构图描述、符合所选景别与运镜。只输出优化后的提示词，不要多余解释。`

/** 分镜对话框：分镜/镜头连线过来自动带入提示词，可 AI 再加工 + 镜头定义面板 */
function SceneShotDialogEditor({ id, payload, locked }: { id: string; payload: Payload; locked: boolean }) {
  const patchObject = useSceneStore((s) => s.patchObject)
  const getContextExtra = useCallback(() => {
    const node = useSceneStore.getState().objects.find((o) => o.id === id)
    const pl = (((node?.data as Payload)?.payload || {}) as Payload)
    const defs = [
      `【景别】${String(pl.camera ?? '中景')}`,
      `【运镜】${String(pl.motion ?? '静止')}`,
      `【视频比例】${String(pl.aspect_ratio ?? '16:9')}`,
      `【清晰度】${String(pl.resolution ?? '1080p')}`,
      `【灯光】${String(pl.lighting ?? '自然光')}`,
    ].join(' ')
    const cur = String(pl.prompt ?? '').trim()
    return cur ? `【当前分镜提示词】${cur}\n${defs}` : defs
  }, [id])
  const dd = (key: string, label: string, opts: string[]) => (
    <label key={key} className="block">
      <span className="mb-1 block text-[11px] text-ink-3">{label}</span>
      <select
        className="nodrag nowheel w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
        disabled={locked}
        value={String(payload[key] ?? '')}
        onChange={(e) => patchObject(id, { [key]: e.target.value })}
      >
        {!String(payload[key] ?? '') && <option value="">未指定</option>}
        {opts.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
  return (
    <div className="flex h-full min-h-[160px] flex-col gap-2">
      <textarea
        className="nodrag nowheel w-full flex-1 resize-y rounded-md border border-edge bg-input p-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
        style={{ minHeight: 80 }}
        disabled={locked}
        value={String(payload.prompt ?? '')}
        placeholder="从分镜/镜头节点连线过来会自动带入提示词，也可手动编辑或让 AI 加工…"
        onChange={(e) => patchObject(id, { prompt: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-2">
        {dd('camera', '景别', SHOT_SIZE_OPTS)}
        {dd('motion', '运镜', MOTION_OPTS)}
        {dd('aspect_ratio', '视频比例', RATIO_OPTS)}
        {dd('resolution', '清晰度', RES_OPTS)}
        {dd('lighting', '灯光', LIGHT_OPTS)}
      </div>
      <InlineAiBar
        id={id}
        withTiming={false}
        systemPrompt={SHOT_DIALOG_SYSTEM_PROMPT}
        getContextExtra={getContextExtra}
        onResult={(text) => patchObject(id, { prompt: text })}
        disabled={locked}
      />
    </div>
  )
}

// ── 分镜脚本编辑器（V2.9b）：完整表格由共享组件 StoryboardView 承担（节点外壳与编辑面板共用）──
// 列：镜号 | 时长 | 画面描述 | 景别 | 角色 | 场景 | 道具 | 光影 | 音效 | 对白 | 旁白 | 分镜提示词 | 镜头控制描述

function SceneStoryboardEditor({ id, payload, locked }: { id: string; payload: Payload; locked: boolean }) {
  const patchObject = useSceneStore((s) => s.patchObject)
  const runAction = useSceneStore((s) => s.runAction)
  const pushLog = useSceneStore((s) => s.pushLog)
  const busy = useSceneStore((s) => s.busy)
  const objects = useSceneStore((s) => s.objects)
  const edges = useSceneStore((s) => s.edges)
  const shots = Array.isArray(payload.shots) ? (payload.shots as Payload[]) : []
  const history = Array.isArray(payload.storyboard_history) ? (payload.storyboard_history as Payload[]) : []
  // 生成设置：模型选择 + 技能库 + 自定义要求（V2.9j/n）
  const [profiles, setProfiles] = useState<AnyProfile[]>([])
  const [profileId, setProfileId] = useState('')
  const [skills, setSkills] = useState<AnyObj[]>([])
  const [skillId, setSkillId] = useState(String(payload.skill_ref ?? ''))
  const [extraReq, setExtraReq] = useState('')
  // 历史预览（V2.9n）：点击历史条目预览，可应用回选
  const [historyOpen, setHistoryOpen] = useState(false)
  const [preview, setPreview] = useState<Payload[] | null>(null)
  const [previewLabel, setPreviewLabel] = useState('')

  useEffect(() => {
    getProfiles().then((res) => {
      const list = (res.ok ? (res.data as { profiles?: AnyProfile[] }).profiles : []) || []
      setProfiles(list)
    })
    getSkills()
      .then((r) => {
        const d = r.data as AnyObj
        const list = Array.isArray(d) ? d : Array.isArray((d as AnyObj)?.skills) ? (d as AnyObj).skills : []
        setSkills((list as AnyObj[]) || [])
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 找剧情节点（连线优先，其次场景内第一个）→ {script, parsed} */
  const findStory = (): { script: string; parsed: ReturnType<typeof parseShotsFromScript> } | null => {
    const linked = edges
      .map((e) => (e.source === id ? e.target : e.target === id ? e.source : ''))
      .map((x) => objects.find((o) => o.id === x))
      .find((o) => o && isStoryNode(o))
    const story = linked || objects.find((o) => isStoryNode(o))
    if (!story) return null
    const script = String((((story.data as Payload)?.payload as Payload)?.script) ?? '')
    if (!script.trim()) return null
    return { script, parsed: parseShotsFromScript(script) }
  }

  /** 物理映射：剧本 → 13 列分镜（供物理引入 + AI 引入的 initial_shots） */
  const buildInitialShots = (script: string, parsed: ReturnType<typeof parseShotsFromScript>) => {
    const allChars = Object.keys(parseCharacters(script))
    const allProps = parsePropsList(script)
    return parsed.map((sh, i) => {
      const dialogs = sh.dialogue || []
      const isVo = (d: { speaker: string }) => /旁白|画外/.test(d.speaker)
      const vo = dialogs.filter(isVo).map((d) => d.line).filter(Boolean)
      const chars = dialogs.filter((d) => !isVo(d)).map((d) => d.speaker).filter(Boolean)
      const bodyText = [sh.body, ...(sh.shots || []).map((x) => x.desc)].join(' ')
      const sceneChars = allChars.filter((c) => c.length >= 2 && bodyText.includes(c))
      const character = [...new Set([...chars, ...sceneChars])].join('、')
      const frames = (sh.shots || []).map((x) => x.desc).filter(Boolean)
      const desc = [sh.body, ...frames].filter(Boolean).join('；')
      const prompt = [
        sh.location ? `场景：${sh.location}` : '',
        sh.time ? `时间：${sh.time}` : '',
        sh.goal ? `目标：${sh.goal}` : '',
        sh.mood ? `氛围：${sh.mood}` : '',
        sh.body ? `画面：${sh.body}` : '',
        frames.length ? `关键画面：${frames.join('；')}` : '',
      ].filter(Boolean).join('\n')
      const subject = (frames[0] || sh.body || sh.location || '主体').slice(0, 24)
      return {
        shot_no: i + 1,
        duration: Number(sh.duration) || 0,
        description: desc,
        shot_size: '',
        character,
        scene: sh.location || '',
        location: sh.location || '',
        props: allProps,
        lighting: '',
        sound_effect: (sh.sfx || []).join('；'),
        dialogue: dialogs.filter((d) => !isVo(d)).map((d) => d.line).join('\n'),
        voice_over: vo.join('\n'),
        prompt,
        camera_control_description: `固定机位、${sh.mood ? `氛围${sh.mood}` : '自然光'}，交代「${subject}」的景别与环境细节，运镜平稳`,
      }
    })
  }

  const saveHistory = (label: string, nextShots: Payload[]) => {
    const h = [{ ts: Date.now(), label, shots: nextShots }, ...history].slice(0, 10)
    patchObject(id, { storyboard_history: h })
  }

  /** 物理引入（不调 AI，秒级） */
  const importFromScript = () => {
    if (locked) return
    const story = findStory()
    if (!story) {
      pushLog({ ts: Date.now(), action: 'storyboard_import', ok: false, message: '没有找到剧情节点或剧本为空——请先创建剧情节点并生成剧本' })
      return
    }
    if (!story.parsed.length) {
      pushLog({ ts: Date.now(), action: 'storyboard_import', ok: false, message: '剧本中未解析到分镜/场景块' })
      return
    }
    const next = buildInitialShots(story.script, story.parsed)
    patchObject(id, { shots: next })
    saveHistory('物理引入', next)
    pushLog({ ts: Date.now(), action: 'storyboard_import', ok: true, message: `已从剧本引入 ${next.length} 个分镜（物理解析，可用 AI 引入修正实体）` })
  }

  /** AI 智能引入（依托剧本只识别修正实体，不做美化；可选模型对比效果） */
  const importFromScriptAI = async () => {
    if (locked) return
    const story = findStory()
    if (!story) {
      pushLog({ ts: Date.now(), action: 'storyboard_import_ai', ok: false, message: '没有找到剧情节点或剧本为空——请先创建剧情节点并生成剧本' })
      return
    }
    if (!story.parsed.length) {
      pushLog({ ts: Date.now(), action: 'storyboard_import_ai', ok: false, message: '剧本中未解析到分镜/场景块' })
      return
    }
    const initial = buildInitialShots(story.script, story.parsed)
    const res = (await runAction('storyboard_import_ai', [id], {
      initial_shots: initial,
      model_profile: profileId || undefined,
      skill_ref: skillId || undefined,
      prompt: extraReq.trim() || undefined,
    })) as AnyObj | undefined
    const corrected = res?.storyboard as Payload[] | undefined
    if (res?.ok === true && Array.isArray(corrected) && corrected.length) {
      saveHistory(`AI 引入${profileId ? '' : '（默认模型）'}`, corrected)
      pushLog({ ts: Date.now(), action: 'storyboard_import_ai', ok: true, message: `AI 智能引入完成 · ${corrected.length} 镜（实体识别已校正）` })
    }
  }

  /** AI 生成分镜（依托剧本 + 技能/知识库 + 自定义要求） */
  const generateByAI = async () => {
    if (locked) return
    const res = (await runAction('generate_storyboard', [id], {
      prompt: extraReq.trim() || undefined,
      model_profile: profileId || undefined,
      skill_ref: skillId || undefined,
    })) as AnyObj | undefined
    const shotsOut = res?.storyboard as Payload[] | undefined
    if (res?.ok === true && Array.isArray(shotsOut) && shotsOut.length) {
      saveHistory(`AI 生成${profileId ? '' : '（默认模型）'}`, shotsOut)
    }
  }

  const applyPreview = () => {
    if (preview) patchObject(id, { shots: preview })
    setPreview(null)
    setHistoryOpen(false)
  }

  const displayShots = preview ?? shots

  return (
    <div className="flex h-full min-h-[160px] flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-brand-300">分镜脚本</span>
          <span className="text-[11px] text-ink-3">{shots.length} 镜 · 点击单元格编辑 · Esc 取消</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className="nodrag flex h-7 items-center gap-1 rounded-md border border-edge bg-soft px-2.5 text-[11px] text-ink-2 transition hover:bg-soft-2 disabled:opacity-50"
            disabled={locked || !!busy}
            onClick={importFromScript}
            title="解析剧情节点剧本物理填入（不调 AI）；实体识别不准可用「AI 引入」修正"
          >
            <LayoutGrid size={11} />
            物理引入
          </button>
          <button
            className="nodrag flex h-7 items-center gap-1 rounded-md border border-brand-500/40 bg-brand-500/10 px-2.5 text-[11px] text-brand-300 transition hover:bg-brand-500/20 disabled:opacity-50"
            disabled={locked || !!busy}
            onClick={() => void importFromScriptAI()}
            title="AI 识别修正引入：依托剧本校正角色/道具/场景（排除环境音标签、识别关键道具与真实地点），不做美化"
          >
            {busy === 'storyboard_import_ai' ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {busy === 'storyboard_import_ai' ? 'AI 引入中…' : 'AI 引入'}
          </button>
          <button
            className="nodrag flex h-7 items-center gap-1 rounded-md bg-brand-600 px-2.5 text-[11px] text-white transition hover:bg-brand-500 disabled:opacity-50"
            disabled={locked || !!busy}
            onClick={() => void generateByAI()}
            title="依托剧情节点原始剧本 + 技能/知识库 + 自定义要求，AI 生成全字段分镜（优化画面观感与故事描述）"
          >
            {busy === 'generate_storyboard' ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
            {busy === 'generate_storyboard' ? '生成中…' : 'AI 生成分镜'}
          </button>
        </div>
      </div>
      {/* 生成设置：模型选择 + 技能库 + 自定义要求 */}
      <div className="flex items-center gap-2">
        <select
          className="nodrag nowheel h-7 w-40 shrink-0 rounded-md border border-edge bg-input px-1.5 text-[11px] text-ink outline-none focus:border-brand-500"
          value={profileId}
          disabled={locked || !!busy}
          onChange={(e) => setProfileId(e.target.value)}
          title="选择 AI 引入 / AI 生成使用的模型，留空为系统自动选择（不同模型可对比引入效果）"
        >
          <option value="">默认模型（系统自动选）</option>
          {profiles.map((p) =>
            p && p.id ? (
              <option key={p.id} value={p.id}>
                {String(p.name ?? p.id)}
                {p.model ? ` · ${p.model}` : ''}
              </option>
            ) : null,
          )}
        </select>
        <SkillPicker
          value={skillId}
          skills={skills}
          disabled={locked || !!busy}
          onChange={(v) => { setSkillId(v); patchObject(id, { skill_ref: v }) }}
          placeholder="技能库（AI 引入/生成注入）"
          className="w-44 shrink-0"
        />
        <input
          className="nodrag nowheel h-7 min-w-0 flex-1 rounded-md border border-edge bg-input px-2 text-[11px] text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
          value={extraReq}
          disabled={locked || !!busy}
          placeholder="自定义要求（可选）：如 2 秒快切、多特写、结尾留悬念…"
          onChange={(e) => setExtraReq(e.target.value)}
        />
      </div>
      {/* 历史记录：多次生成/引入回选 */}
      <div className="flex items-center gap-2">
        <button
          className="nodrag flex h-6 items-center gap-1 rounded-md border border-edge px-2 text-[10px] text-ink-3 transition hover:bg-soft disabled:opacity-50"
          disabled={locked}
          onClick={() => setHistoryOpen((v) => !v)}
          title="历史生成/引入记录，点击条目预览，可回选应用"
        >
          <Clock size={10} />
          历史 {history.length} 条
          <ChevronDown size={10} className={`transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
        </button>
        {preview && (
          <div className="flex items-center gap-1.5 text-[10px] text-brand-300">
            <span>预览：{previewLabel}</span>
            <button className="rounded border border-brand-500/40 bg-brand-500/10 px-1.5 py-0.5 hover:bg-brand-500/20" onClick={applyPreview}>
              应用此版本
            </button>
            <button className="rounded border border-edge px-1.5 py-0.5 text-ink-3 hover:bg-soft" onClick={() => setPreview(null)}>
              取消
            </button>
          </div>
        )}
      </div>
      {historyOpen && (
        <div className="nowheel max-h-32 overflow-y-auto rounded-lg border border-edge bg-panel">
          {history.length === 0 && <div className="px-2 py-2 text-[10px] text-ink-3">暂无历史——生成或引入后自动记录（最多 10 条）</div>}
          {history.map((h, i) => (
            <button
              key={i}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[10px] text-ink-2 transition hover:bg-soft"
              onClick={() => { setPreview((h.shots as Payload[]) || []); setPreviewLabel(`${String(h.label ?? '')} · ${new Date(Number(h.ts)).toLocaleTimeString('zh-CN', { hour12: false })}`); setHistoryOpen(false) }}
            >
              <span className="truncate">
                {String(h.label ?? '')} · {Array.isArray(h.shots) ? h.shots.length : 0} 镜
              </span>
              <span className="shrink-0 text-ink-3">{new Date(Number(h.ts)).toLocaleTimeString('zh-CN', { hour12: false })}</span>
            </button>
          ))}
        </div>
      )}
      <StoryboardTable
        shots={displayShots}
        locked={locked}
        onPatch={(next) => patchObject(id, { shots: next })}
      />
    </div>
  )
}

export default function SceneNodeEditPanel({ id }: { id: string }) {
  const patchObject = useSceneStore((s) => s.patchObject)
  const runAction = useSceneStore((s) => s.runAction)
  const busy = useSceneStore((s) => s.busy)
  const objects = useSceneStore((s) => s.objects)
  const edges = useSceneStore((s) => s.edges)
  const obj = useSceneStore((s) => s.objects.find((o) => o.id === id))
  const payload = ((obj?.data as Payload)?.payload || {}) as Payload
  const objectType = String(((obj?.data as Payload)?.objectType || 'text'))
  const locked = (obj?.data as Payload)?.locked === true
  const meta = useSceneStore((s) => s.metaOf(objectType))
  const typeDef = useSceneStore((s) => s.currentTypeDef())
  const fields = meta.fields || {}
  const status = useSceneStore((s) => s.objectStatus[id])

  // 图片用途 / 音频类型下拉动态选项（从剧本解析扩展）
  const linkedStoryParsed = useMemo(() => {
    const sid = edges
      .map((e) => (e.source === id ? e.target : e.target === id ? e.source : ''))
      .find((x) => !!x && isStoryNode(objects.find((o) => o.id === x)))
    if (!sid) return null
    const so = objects.find((o) => o.id === sid)
    const script = String((((so?.data as Payload)?.payload as Payload)?.script) ?? '')
    if (script) {
      // 🔴 parseShotsFromScript 返回的是分镜数组，必须包成 ParsedScript 结构，
      // 否则调用方 s.characters.forEach / s.props.forEach 拿到 undefined 直接白屏
      return {
        characters: Object.keys(parseCharacters(script)),
        props: parsePropsList(script),
        shots: parseShotsFromScript(script),
      } as ParsedScript
    }
    return ((((so?.data as Payload)?.payload as Payload)?.parsed as ParsedScript) || EMPTY_PARSED)
  }, [edges, objects, id])
  const purposeOpts = useMemo(() => {
    const base = [...PURPOSE_OPTS]
    if (!linkedStoryParsed) return base
    const s = linkedStoryParsed as ParsedScript
    s.characters.forEach((c) => base.push(c))
    s.props.forEach((p) => base.push(p))
    s.shots.forEach((sh) => {
      base.push(`分镜${sh.no}`)
      sh.shots.forEach((x) => base.push(`分镜${sh.no}-镜头${x.no}`))
    })
    return base
  }, [linkedStoryParsed])
  const audioOpts = useMemo(() => {
    const base = [...AUDIO_TYPE_OPTS]
    if (!linkedStoryParsed) return base
    ;(linkedStoryParsed as ParsedScript).shots.forEach((s) => {
      base.push(`分镜${s.no}音乐`)
      base.push(`分镜${s.no}对白`)
    })
    return base
  }, [linkedStoryParsed])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto nowheel">
      {/* 专用编辑器 */}
      {objectType === 'story' ? (
        <SceneStoryEditor id={id} payload={payload} locked={locked} />
      ) : objectType === 'storyboard' ? (
        <SceneStoryboardEditor id={id} payload={payload} locked={locked} />
      ) : objectType === 'shot_dialog' ? (
        <SceneShotDialogEditor id={id} payload={payload} locked={locked} />
      ) : objectType === 'text' ? (
        <SceneTextWriter id={id} locked={locked} />
      ) : objectType === 'image' ? (
        <SceneImageEditor id={id} locked={locked} />
      ) : objectType === 'video' ? (
        <SceneVideoEditor id={id} locked={locked} />
      ) : objectType === 'audio' ? (
        <SceneAudioEditor id={id} locked={locked} />
      ) : (
        <>
          {Object.keys(fields).length === 0 && (
            <div className="text-[11px] text-ink-3">该对象暂无可编辑字段</div>
          )}
          {Object.entries(fields).map(([key, label]) => {
            const val = payload[key]
            if (LONG_TEXT_KEYS.has(key)) {
              const k = objectType === 'story' && (key === 'text' || key === 'summary') ? 'script' : 'text'
              return (
                <SceneFieldPopover key={key} objectId={id} fieldKey={key} label={String(label)} kind={k as 'text' | 'script'} />
              )
            }
            if (Array.isArray(val) || (val === undefined && ['selling_points', 'characters', 'images', 'sku'].includes(key))) {
              const arr = Array.isArray(val) ? val : []
              return (
                <label key={key} className="block">
                  <span className="mb-1 block text-[11px] text-ink-3">{String(label)}（一行一项）</span>
                  <textarea
                    className="w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
          rows={Math.min(30, Math.max(2, String(val ?? '').split('\n').length))}
          disabled={locked}
          value={arr.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('\n')}
                    onChange={(e) =>
                      patchObject(id, { [key]: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) })
                    }
                  />
                </label>
              )
            }
            if (typeof val === 'boolean') {
              return (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-brand-500"
                    disabled={locked}
                    checked={val}
                    onChange={(e) => patchObject(id, { [key]: e.target.checked })}
                  />
                  <span className="text-[11px] text-ink-2">{String(label)}</span>
                </label>
              )
            }
            if (key === 'purpose' || key === 'audio_type') {
              const opts = key === 'purpose' ? purposeOpts : audioOpts
              const cur = String(val ?? '')
              return (
                <label key={key} className="block">
                  <span className="mb-1 block text-[11px] text-ink-3">{String(label)}（手动匹配）</span>
                  <select
                    className="w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
                    disabled={locked}
                    value={opts.includes(cur) ? cur : ''}
                    onChange={(e) => patchObject(id, { [key]: e.target.value })}
                  >
                    <option value="">{cur && !opts.includes(cur) ? cur : '未指定'}</option>
                    {opts.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </label>
              )
            }
            if (CAMERA_KEYS.has(key)) {
              const cur = String(val ?? '')
              return (
                <label key={key} className="block">
                  <span className="mb-1 block text-[11px] text-ink-3">{String(label)}</span>
                  <select
                    className="w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
                    disabled={locked}
                    value={CAMERA_OPTIONS.includes(cur) ? cur : ''}
                    onChange={(e) => patchObject(id, { [key]: e.target.value })}
                  >
                    <option value="">{cur && !CAMERA_OPTIONS.includes(cur) ? cur : '未指定'}</option>
                    {CAMERA_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {cameraLabel(c)}
                      </option>
                    ))}
                  </select>
                </label>
              )
            }
            if (typeof val === 'number' || ['duration', 'scene_no', 'shot_no', 'scene', 'shot', 'start', 'end'].includes(key)) {
              return (
                <label key={key} className="block">
                  <span className="mb-1 block text-[11px] text-ink-3">{String(label)}</span>
                  <input
                    type="number"
                    className="w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
                    disabled={locked}
                    value={val === undefined || val === null ? '' : String(val)}
                    onChange={(e) => patchObject(id, { [key]: e.target.value === '' ? '' : Number(e.target.value) })}
                  />
                </label>
              )
            }
            if (val !== null && typeof val === 'object') {
              return (
                <label key={key} className="block">
                  <span className="mb-1 block text-[11px] text-ink-3">{String(label)}（JSON）</span>
                  <textarea
                    className="w-full resize-y rounded-md border border-edge bg-input px-2 py-1 font-mono text-sm text-ink outline-none focus:border-brand-500"
                    rows={Math.min(30, Math.max(2, (JSON.stringify(val, null, 2) || '').split('\n').length))}
                    disabled={locked}
                    defaultValue={JSON.stringify(val, null, 2)}
                    onBlur={(e) => {
                      try {
                        patchObject(id, { [key]: JSON.parse(e.target.value || '{}') })
                      } catch {
                        /* JSON 非法时忽略 */
                      }
                    }}
                  />
                </label>
              )
            }
            return (
              <label key={key} className="block">
                <span className="mb-1 block text-[11px] text-ink-3">{String(label)}</span>
                <input
                  className="w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
                  disabled={locked}
                  value={String(val ?? '')}
                  onChange={(e) => patchObject(id, { [key]: e.target.value })}
                />
              </label>
            )
          })}
        </>
      )}

      {/* 场景动作按钮（原节点底部动作区） */}
      {sceneActionsFor(objectType, typeDef).length > 0 && (
        <div className="border-t border-edge pt-2">
          <div className="mb-1.5 flex items-center gap-1 text-[11px] text-ink-3">
            <Sparkles size={11} /> 动作
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sceneActionsFor(objectType, typeDef).map((a) => (
              <button
                key={a}
                className="flex items-center gap-1 rounded-lg border border-edge bg-canvas px-2 py-1 text-sm text-ink-2 transition hover:border-brand-500 hover:text-ink disabled:opacity-40"
                disabled={!!busy}
                onClick={() => void runAction(a, [id])}
              >
                {busy === a && <Loader2 size={10} className="animate-spin" />}
                {ACTION_LABELS[a] || a}
              </button>
            ))}
          </div>
        </div>
      )}

      {status && status !== 'idle' && (
        <div className="text-[11px] text-ink-3">状态：{status === 'running' ? '执行中' : status === 'completed' ? '完成' : status === 'failed' ? '失败' : status}</div>
      )}
    </div>
  )
}
