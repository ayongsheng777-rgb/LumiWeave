/**
 * 场景专业对象节点（规格书 §9 CanvasObject / §12 对象渲染）
 *
 * 一个组件覆盖全部对象类型：颜色 / 中文名 / 可编辑字段全部来自后端注册表
 * （registry.OBJECT_LIBRARY），新增对象类型无需改前端（§40 可扩展性）。
 *
 * 能力：缩放（NodeResizer）、锁定、删除、媒体预览、关键字段速览。
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Lock, LockOpen, Trash2, Play, Copy, Sparkles, Loader2, Send } from 'lucide-react'
import { useSceneStore, ACTION_LABELS } from '../store/sceneStore'
import { useUiStore } from '../store/uiStore'
import { CAMERA_ZH, cameraLabel } from '../cameraLabels'
import type { SceneTypeDef } from '../api'
import { aiChat, getProfiles } from '../api'
import SceneFieldPopover from './SceneFieldPopover'
import SceneTextWriter from './SceneTextWriter'
import SceneImageEditor from './SceneImageEditor'

/** 长文本字段 → 用 AI 对话弹窗编辑 */
const LONG_TEXT_KEYS = new Set([
  'description', 'prompt', 'text', 'summary', 'analysis', 'dialogue',
  'appearance', 'marketing_plan', 'composition',
])
/** 镜头术语字段 → 中英双文下拉 */
const CAMERA_KEYS = new Set(['camera', 'motion', 'shot_size', 'camera_motion', 'lens'])
const CAMERA_OPTIONS = Object.keys(CAMERA_ZH)

/** 该类型在当前场景下可用的场景动作（与 SceneInspector 一致） */
function sceneActionsFor(objectType: string, typeDef?: SceneTypeDef | null): string[] {
  const acts = typeDef?.actions || []
  if (objectType === 'product') return acts.filter((a) => a.includes('product') || a.includes('image') || a.includes('poster') || a === 'batch_generate' || a.includes('detail'))
  if (objectType === 'shot') return acts.filter((a) => a.includes('shot') || a === 'generate_prompt' || a === 'generate_reference' || a === 'generate_video')
  if (objectType === 'storyboard') return acts.filter((a) => a.includes('image') || a === 'generate_video')
  if (objectType === 'scene') return acts.filter((a) => a.includes('scene') || a.includes('image'))
  if (objectType === 'story') return [] // 文本生成节点走底部内置 AI 输入条，不显示动作按钮
  if (objectType === 'video') return acts.filter((a) => a.includes('video') || a.includes('shot') || a.includes('frame'))
  if (objectType === 'image') return acts.filter((a) => a === 'generate_video')
  return []
}

type Payload = Record<string, unknown>

/** 图片类字段候选（按优先级取第一个有值的） */
const IMAGE_KEYS = ['url', 'image', 'image_url', 'cover', 'thumbnail', 'main_image']
const VIDEO_KEYS = ['video', 'video_url']

function pick(payload: Payload, keys: string[]): string {
  for (const k of keys) {
    const v = payload[k]
    if (typeof v === 'string' && v.trim()) return v
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0]) return v[0] as string
  }
  return ''
}

/** 值转可读文本 */
function readable(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('、')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

type AnyProfile = { id: string; name?: string; model?: string }

// ── V2.6 节点匹配：图片(用途)/音频(类型) 连线剧情后按顺序编号（人物一/道具一/分镜N/镜头N-M/分镜N音乐/对白…）──
const MATCH_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

/** 剧本结构化数据（后端 _parse_script 产出） */
interface ParsedShot {
  no: number
  location: string
  time: string
  goal: string
  mood: string
  bgm: string
  duration: string
  shots: { no: string; desc: string }[]
  dialogue: { speaker: string; emotion: string; line: string }[]
}
interface ParsedScript {
  characters: string[]
  props: string[]
  shots: ParsedShot[]
}
const EMPTY_PARSED: ParsedScript = { characters: [], props: [], shots: [] }

/** 需按连接顺序编号的基础类；其余具体索引项（人物名/道具名/分镜N/镜头N-M/分镜N音乐/对白N）直接显示 */
const NUMBERED_KINDS = new Set(['人物', '道具', '配音', 'BGM', '音效', '对白'])

function computeMatchLabel(
  objects: { id: string; type?: string; data?: unknown }[],
  edges: { source: string; target: string }[],
  oid: string,
): string {
  const obj = objects.find((o) => o.id === oid)
  if (!obj) return ''
  const t = obj.type
  if (t !== 'image' && t !== 'audio') return ''
  const p = ((obj.data as Payload)?.payload || {}) as Payload
  const kind = t === 'audio' ? String(p.audio_type ?? '') : String(p.purpose ?? '')
  if (!kind) return ''
  // 找到它连的剧情节点
  const linked = edges
    .map((e) => (e.source === oid ? e.target : e.target === oid ? e.source : ''))
    .find((x) => !!x && objects.find((o) => o.id === x)?.type === 'story')
  if (!linked) return ''
  // 具体索引项直接显示（小偷/分镜2/镜头1-2/分镜2音乐…）
  if (!NUMBERED_KINDS.has(kind)) return kind
  // 基础类 → 同 kind 按连接顺序编号（人物一/二…、BGM一/二…）
  const order = edges
    .filter((e) => e.source === linked || e.target === linked)
    .map((e) => (e.source === linked ? e.target : e.source))
    .filter((x) => {
      const o = objects.find((o) => o.id === x)
      if (!o) return false
      if (t === 'audio') return o.type === 'audio' && String(((o.data as Payload)?.payload as Payload)?.audio_type ?? '') === kind
      return o.type === 'image' && String(((o.data as Payload)?.payload as Payload)?.purpose ?? '') === kind
    })
  const idx = order.indexOf(oid)
  if (idx < 0) return ''
  return `${kind}${MATCH_NUMS[idx] ?? idx + 1}`
}

/** 剧情/文本生成节点的系统提示词：对齐专业分镜脚本结构（参考「轻盈生活」模板） */
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

/** 节点内嵌 AI 输入条：模型(平台 · 模型名) + [总时长+分镜个数+分镜时长] + prompt + 发送。
 *  withTiming=false 用于分镜对话框（不需要时长/分镜个数）；
 *  systemPrompt 可覆盖系统提示词；getContextExtra 把镜头定义等实时参数拼进 user 提示词。 */
function InlineAiBar({
  id,
  onResult,
  disabled,
  withTiming = true,
  systemPrompt = STORY_SYSTEM_PROMPT,
  getContextExtra,
  actionRoute,
}: {
  id: string
  onResult: (text: string) => void
  disabled?: boolean
  withTiming?: boolean
  systemPrompt?: string
  getContextExtra?: () => string
  /** 若指定动作名，发送时走后端场景动作（如 generate_story，强制硅基流动 + 固定剧本格式） */
  actionRoute?: string
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
      // 剧本/规范化生成：走后端场景动作（剧本 Agent 固定输出格式，模型用前端所选）
      // runAction 完成后会自动重载场景，剧本已写回本节点的 script 字段
      await runAction(actionRoute, [id], {
        prompt: prompt.trim(),
        profile_id: profileId || undefined,
        ...(withTiming
          ? { duration: duration > 0 ? duration : undefined, shotCount: shotCount > 0 ? shotCount : undefined }
          : {}),
      })
      setRunning(false)
      const obj = useSceneStore.getState().objects.find((o) => o.id === id)
      const script = String(((obj?.data as Payload)?.payload as Payload)?.script ?? '')
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
  }, [prompt, running, disabled, profileId, onResult, withTiming, systemPrompt, getContextExtra, duration, shotCount, per, actionRoute, runAction, id])

  return (
    <div className="border-t border-edge pt-2 space-y-2">
      {/* 参数行：模型（剧本生成也由用户选模型，Agent 约束格式）+ [总时长 + 分镜个数] */}
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
      {/* 输入 + 发送：多行文本框，文字超长自动换行（不横向一条线），回车发送 / Shift+Enter 换行 */}
      <div className="flex items-end gap-1.5">
        <textarea
          className="nodrag nowheel min-h-8 max-h-32 min-w-0 flex-1 resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
          placeholder="告诉我写什么，回车发送（Shift+Enter 换行）"
          rows={Math.min(4, Math.max(1, prompt.split('\n').length))}
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

/** 文本生成节点：梗概 + 正文合并为一个编辑框，底部内嵌 AI 输入条 */
function StoryEditor({ id, payload, locked }: { id: string; payload: Payload; locked: boolean }) {
  const patchObject = useSceneStore((s) => s.patchObject)
  const combined = [String(payload.summary ?? '').trim(), String(payload.text ?? '').trim()]
    .filter(Boolean)
    .join('\n\n')
  const [value, setValue] = useState(combined)

  // 外部数据变化时同步本地输入
  useEffect(() => {
    setValue(combined)
  }, [combined])

  const onApply = useCallback(
    (text: string) => {
      // 剧本生成返回规范 Markdown 全文 → 写回 script（全文）+ text（展示）
      patchObject(id, { script: text, text })
    },
    [id, patchObject],
  )

  return (
    <div className="flex h-full min-h-[120px] flex-col gap-2">
      <textarea
        className="nodrag nowheel w-full flex-1 resize-none rounded-md border border-edge bg-input p-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
        style={{ minHeight: 90 }}
        disabled={locked}
        value={value}
        placeholder="输入或生成剧本梗概与正文..."
        onChange={(e) => {
          setValue(e.target.value)
          patchObject(id, { text: e.target.value })
        }}
      />
      <InlineAiBar id={id} onResult={onApply} disabled={locked} actionRoute="generate_story" />
    </div>
  )
}

// ── 分镜对话框：下拉定义面板选项 ──────────────────────────────────────────
const SHOT_SIZE_OPTS = ['远景', '全景', '中景', '近景', '特写', '大特写', '过肩', '俯拍', '仰拍']
const MOTION_OPTS = ['静止', '推近', '拉远', '左摇', '右摇', '上摇', '下摇', '跟拍', '环绕', '手持', '航拍']
const RATIO_OPTS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const RES_OPTS = ['720p', '1080p', '2K', '4K']
const LIGHT_OPTS = ['自然光', '暖光', '冷光', '柔光', '硬光', '逆光', '侧光', '顶光', '夜景']

// 图片「用途」/ 音频「类型」手动匹配选项（V2.6 节点匹配；分镜=原场景）
const PURPOSE_OPTS = ['人物', '道具', '分镜']
const AUDIO_TYPE_OPTS = ['配音', 'BGM', '音效', '对白']

const SHOT_DIALOG_SYSTEM_PROMPT = `你是短视频分镜提示词专家。根据用户给定的分镜提示词和镜头定义（景别/运镜/视频比例/清晰度/灯光），把分镜提示词优化成可直接用于视频生成模型的高质量中文提示词：画面具体、有镜头感、含光线与构图描述、符合所选景别与运镜。只输出优化后的提示词，不要多余解释。`

/** 分镜对话框：分镜/镜头连线过来自动带入提示词，可 AI 再加工 + 镜头定义面板（下拉选择） */
function ShotDialogEditor({ id, payload, locked }: { id: string; payload: Payload; locked: boolean }) {
  const patchObject = useSceneStore((s) => s.patchObject)

  // 发送时实时读取镜头定义，拼进提示词上下文（用 getState 读最新值，不触发重渲染）
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
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="flex h-full min-h-[160px] flex-col gap-2">
      <textarea
        className="nodrag nowheel w-full flex-1 resize-none rounded-md border border-edge bg-input p-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
        style={{ minHeight: 70 }}
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

const SceneObjectNode = memo(({ id, data, selected }: NodeProps) => {
  const objectType = String((data as Payload).objectType || 'text')
  const payload = ((data as Payload).payload || {}) as Payload
  const locked = (data as Payload).locked === true

  const meta = useSceneStore((s) => s.metaOf(objectType))
  const toggleLock = useSceneStore((s) => s.toggleLock)
  const deleteObjects = useSceneStore((s) => s.deleteObjects)
  const duplicateObjects = useSceneStore((s) => s.duplicateObjects)
  const patchObject = useSceneStore((s) => s.patchObject)
  const runAction = useSceneStore((s) => s.runAction)
  const busy = useSceneStore((s) => s.busy)
  const status = useSceneStore((s) => s.objectStatus[id])
  const typeDef = useSceneStore((s) => s.currentTypeDef())
  const openLightbox = useUiStore((s) => s.openLightbox)
  const objects = useSceneStore((s) => s.objects)
  const edges = useSceneStore((s) => s.edges)

  // ── V2.6 匹配：图片(用途)/音频(类型) 连剧情自动编号；连视频的作为参考资料 ──
  const matchLabel = computeMatchLabel(objects, edges, id)
  const linkedStory = edges
    .map((e) => (e.source === id ? e.target : e.target === id ? e.source : ''))
    .some((x) => !!x && objects.find((o) => o.id === x)?.type === 'story')
  const needPurpose = linkedStory && objectType !== 'story' && objectType !== 'video' && !matchLabel
  const videoRefs =
    objectType === 'video'
      ? edges
          .filter((e) => e.target === id)
          .map((e) => e.source)
          .filter((oid) => {
            const t = objects.find((o) => o.id === oid)?.type
            return t === 'image' || t === 'audio'
          })
      : []
  // 导演台：从连线的剧情节点读剧本 + 元素清单
  // 导演台：从连线的剧情节点读剧本 + 解析数据
  const linkedStoryParsed = (() => {
    const sid = edges
      .map((e) => (e.source === id ? e.target : e.target === id ? e.source : ''))
      .find((x) => !!x && objects.find((o) => o.id === x)?.type === 'story')
    if (!sid) return null
    const so = objects.find((o) => o.id === sid)
    return (((so?.data as Payload)?.payload as Payload)?.parsed as ParsedScript) || EMPTY_PARSED
  })()

  // 图片用途下拉动态选项：基础 + 人物名/道具名/分镜N/分镜N-镜头N-M（从剧本解析扩展）
  const purposeOpts = useMemo(() => {
    const base = [...PURPOSE_OPTS]
    if (!linkedStoryParsed) return base
    linkedStoryParsed.characters.forEach((c) => base.push(c))
    linkedStoryParsed.props.forEach((p2) => base.push(p2))
    linkedStoryParsed.shots.forEach((s) => {
      base.push(`分镜${s.no}`)
      s.shots.forEach((sh) => base.push(`分镜${s.no}-镜头${sh.no}`))
    })
    return base
  }, [linkedStoryParsed])

  // 音频类型下拉动态选项：基础 + 分镜N音乐 / 分镜N对白
  const audioOpts = useMemo(() => {
    const base = [...AUDIO_TYPE_OPTS]
    if (!linkedStoryParsed) return base
    linkedStoryParsed.shots.forEach((s) => {
      base.push(`分镜${s.no}音乐`)
      base.push(`分镜${s.no}对白`)
    })
    return base
  }, [linkedStoryParsed])

  const directorStory = objectType === 'director'
    ? (() => {
        const sid = edges
          .map((e) => (e.source === id ? e.target : e.target === id ? e.source : ''))
          .find((x) => !!x && objects.find((o) => o.id === x)?.type === 'story')
        if (!sid) return null
        const so = objects.find((o) => o.id === sid)
        const pp = ((so?.data as Payload)?.payload as Payload) || {}
        return { id: sid, script: String(pp.script ?? ''), parsed: (pp.parsed as ParsedScript) || EMPTY_PARSED }
      })()
    : null

  // 右键菜单（§18 Context Menu）
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    setCtx({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [])

  const imageUrl = pick(payload, IMAGE_KEYS)
  const videoUrl = pick(payload, VIDEO_KEYS)
  const fields = meta.fields || {}

  // 该对象类型在当前场景下可直接触发的主要动作（§19）
  const primaryAction = (() => {
    const acts = typeDef?.actions || []
    if (objectType === 'product' && acts.includes('analyze_product')) return 'analyze_product'
    if (objectType === 'shot' && acts.includes('analyze_shot')) return 'analyze_shot'
    if (objectType === 'storyboard' && acts.includes('generate_images')) return 'generate_main_image'
    if (objectType === 'scene' && acts.includes('generate_scene_image')) return 'generate_scene_image'
    return ''
  })()

  const onTitleChange = useCallback(
    (v: string) => {
      // 优先写 name，其次 title，最后 text
      const key = 'name' in payload ? 'name' : 'title' in payload ? 'title' : 'text'
      patchObject(id, { [key]: v })
    },
    [id, patchObject, payload],
  )

  const title =
    readable(payload.name) || readable(payload.title) ||
    (objectType === 'shot' ? `镜头 ${readable(payload.shot_no) || '?'}` : '') ||
    (objectType === 'storyboard' ? `${readable(payload.scene) || '?'}-${readable(payload.shot) || '?'}` : '') ||
    meta.label

  return (
    <>
      <NodeResizer
        isVisible={!!selected && !locked}
        minWidth={200}
        minHeight={140}
        lineClassName="!border-brand-500"
        handleClassName="!h-2 !w-2 !rounded-sm !border-brand-500 !bg-white"
      />

      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-brand-500" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-brand-500" />

      <div
        className={`flex h-full flex-col overflow-hidden rounded-xl border bg-panel text-[11px] shadow-node-dark transition ${
          selected ? 'border-brand-500' : 'border-edge'
        }`}
        style={{ height: '100%' }}
        onContextMenu={onContextMenu}
      >
        {/* 标题栏：色条 + 中文类型名 + 操作 */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-edge px-2 py-1.5">
          <span className="h-3 w-1 shrink-0 rounded-full" style={{ background: meta.color }} />
          <span className="shrink-0 text-[11px] font-medium" style={{ color: meta.color }}>
            {meta.label}
          </span>
          {status && status !== 'idle' && (
            <span
              className={`shrink-0 rounded-full px-1.5 text-[11px] leading-4 ${
                status === 'running'
                  ? 'animate-pulse bg-amber-400/20 text-amber-400'
                  : status === 'completed'
                    ? 'bg-emerald-400/20 text-emerald-400'
                    : status === 'failed'
                      ? 'bg-red-400/20 text-red-400'
                      : ''
              }`}
            >
              {status === 'running' ? '执行中' : status === 'completed' ? '完成' : status === 'failed' ? '失败' : status}
            </span>
          )}
          {matchLabel && (
            <span className="shrink-0 rounded-full bg-brand-500/15 px-1.5 text-[10px] font-medium text-brand-300">
              {matchLabel}
            </span>
          )}
          {needPurpose && (
            <span
              className="shrink-0 rounded-full bg-amber-400/15 px-1.5 text-[10px] text-amber-400"
              title="已连线剧情，请设置用途（图片：人物/场景/道具；音频：配音/BGM/音效）"
            >
              ⚠ 请设用途
            </span>
          )}
          <input
            className="nodrag min-w-0 flex-1 truncate bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
            value={title === meta.label ? '' : title}
            placeholder="未命名"
            onChange={(e) => onTitleChange(e.target.value)}
            disabled={locked}
          />
          {primaryAction && (
            <button
              className="nodrag shrink-0 rounded p-0.5 text-ink-3 transition hover:text-brand-500 disabled:opacity-40"
              title={`执行：${primaryAction}`}
              disabled={!!busy}
              onClick={() => void runAction(primaryAction, [id])}
            >
              <Play size={11} />
            </button>
          )}
          <button
            className="nodrag shrink-0 rounded p-0.5 text-ink-3 transition hover:text-ink"
            title={locked ? '解锁' : '锁定'}
            onClick={() => toggleLock(id)}
          >
            {locked ? <Lock size={11} /> : <LockOpen size={11} />}
          </button>
          <button
            className="nodrag shrink-0 rounded p-0.5 text-ink-3 transition hover:text-red-400"
            title="删除"
            onClick={() => void deleteObjects([id])}
          >
            <Trash2 size={11} />
          </button>
        </div>

        {/* 内容区：所有字段在节点上直接编辑；文本生成节点用合并框 + 底部 AI 输入条 */}
        <div className="nowheel flex-1 overflow-y-auto space-y-2 p-2">
          {/* 视频参考资料：连到本视频节点的已匹配图片/音频（V2.6） */}
          {objectType === 'video' && videoRefs.length > 0 && (
            <div className="rounded-lg border border-edge bg-soft px-2 py-1.5">
              <div className="mb-1 text-[10px] text-ink-3">视频参考资料（{videoRefs.length}）</div>
              <div className="flex flex-wrap gap-1">
                {videoRefs.map((oid) => {
                  const o = objects.find((x) => x.id === oid)
                  const lb = computeMatchLabel(objects, edges, oid) || (o?.type === 'audio' ? '音频' : '图片')
                  return (
                    <span key={oid} className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-ink-2">
                      {lb}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
          {/* 导演台：结构化分镜卡片（彩色关键词：分镜橙/人物紫/道具蓝/BGM绿/对白青） */}
          {objectType === 'director' && directorStory && (
            <div className="space-y-2 rounded-lg border border-brand-500/30 bg-brand-500/5 px-2 py-1.5">
              <div className="text-[10px] text-brand-300">
                🎬 剧本（来自剧情节点）
                {directorStory.parsed.shots.length > 0 && (
                  <span className="ml-1 text-ink-3">
                    · {directorStory.parsed.shots.length} 分镜 / {directorStory.parsed.characters.length} 人物 / {directorStory.parsed.props.length} 道具
                  </span>
                )}
              </div>
              {directorStory.parsed.shots.length > 0 ? (
                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-0.5">
                  {directorStory.parsed.shots.map((s) => (
                    <div key={s.no} className="rounded bg-soft px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0 rounded bg-orange-400/15 px-1 text-[10px] font-medium text-orange-400">分镜{s.no}</span>
                        {s.location && <span className="truncate text-[10px] text-ink-2">{s.location}{s.time ? `，${s.time}` : ''}</span>}
                        {s.duration && <span className="ml-auto shrink-0 text-[10px] text-ink-3">{s.duration}s</span>}
                      </div>
                      {s.goal && <div className="mt-0.5 text-[10px] text-ink-3">🎯 {s.goal}</div>}
                      {s.bgm && <div className="mt-0.5 text-[10px] text-green-400">🎵 背景音乐：{s.bgm}</div>}
                      {s.shots.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {s.shots.map((sh) => (
                            <div key={sh.no} className="text-[10px] leading-snug text-ink-2">
                              <span className="shrink-0 text-cyan-400">镜头{sh.no}</span> {sh.desc}
                            </div>
                          ))}
                        </div>
                      )}
                      {s.dialogue.length > 0 && (
                        <div className="mt-1 space-y-0.5 border-t border-edge/60 pt-1">
                          {s.dialogue.map((dl, i) => (
                            <div key={i} className="text-[10px] leading-snug text-ink-2">
                              <span className="text-purple-400">{dl.speaker}</span>
                              {dl.emotion && <span className="text-ink-3">（{dl.emotion}）</span>}
                              <span className="text-cyan-400">：{dl.line}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-soft px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
                  {directorStory.script || '（剧情节点尚未生成剧本，去剧情节点用 AI 生成）'}
                </div>
              )}
            </div>
          )}
          {videoUrl ? (
            <video
              src={videoUrl}
              controls
              className="mb-1.5 w-full rounded-lg bg-black"
              style={{ maxHeight: 200 }}
            />
          ) : imageUrl && objectType !== 'image' ? (
            <img
              src={imageUrl}
              alt={meta.label}
              className="mb-1.5 w-full cursor-zoom-in rounded-lg object-cover"
              style={{ maxHeight: 200 }}
              onClick={() => openLightbox(imageUrl)}
            />
          ) : null}

          {objectType === 'story' ? (
            <StoryEditor id={id} payload={payload} locked={locked} />
          ) : objectType === 'shot_dialog' ? (
            <ShotDialogEditor id={id} payload={payload} locked={locked} />
          ) : objectType === 'text' ? (
            <SceneTextWriter id={id} locked={locked} />
          ) : objectType === 'image' ? (
            <SceneImageEditor id={id} locked={locked} />
          ) : (
            <>
              {Object.keys(fields).length === 0 && (
                <div className="text-[11px] text-ink-3">该对象暂无可编辑字段</div>
              )}

              {Object.entries(fields).map(([key, label]) => {
                const val = payload[key]
                // 长文本 → AI 对话弹窗
                if (LONG_TEXT_KEYS.has(key)) {
                  const k = objectType === 'story' && (key === 'text' || key === 'summary') ? 'script' : 'text'
                  return (
                    <SceneFieldPopover key={key} objectId={id} fieldKey={key} label={String(label)} kind={k} />
                  )
                }
                // 数组 → 一行一项
                if (Array.isArray(val) || (val === undefined && ['selling_points', 'characters', 'images', 'sku'].includes(key))) {
                  const arr = Array.isArray(val) ? val : []
                  return (
                    <label key={key} className="block">
                      <span className="mb-1 block text-[11px] text-ink-3">{String(label)}（一行一项）</span>
                      <textarea
                        className="w-full resize-y rounded-md border border-edge bg-input px-2 py-1 text-sm text-ink outline-none focus:border-brand-500"
                        rows={2}
                        disabled={locked}
                        value={arr.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('\n')}
                        onChange={(e) =>
                          patchObject(id, { [key]: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) })
                        }
                      />
                    </label>
                  )
                }
                // 布尔
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
                // 用途 / 音频类型 → 下拉（图片：人物/道具/分镜/剧本元素；音频：配音/BGM/音效/对白/分镜音乐）
                if (key === 'purpose' || key === 'audio_type') {
                  const opts = key === 'purpose' ? purposeOpts : audioOpts
                  const cur = String(val ?? '')
                  return (
                    <label key={key} className="block">
                      <span className="mb-1 block text-[11px] text-ink-3">{String(label)}（手动匹配）</span>
                      <select
                        className="w-full rounded-md border border-edge bg-input px-2 py-1 text-sm text-ink outline-none focus:border-brand-500"
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
                // 镜头术语 → 下拉（中英双文）
                if (CAMERA_KEYS.has(key)) {
                  const cur = String(val ?? '')
                  return (
                    <label key={key} className="block">
                      <span className="mb-1 block text-[11px] text-ink-3">{String(label)}</span>
                      <select
                        className="w-full rounded-md border border-edge bg-input px-2 py-1 text-sm text-ink outline-none focus:border-brand-500"
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
                if (
                  typeof val === 'number' ||
                  ['duration', 'scene_no', 'shot_no', 'scene', 'shot', 'start', 'end'].includes(key)
                ) {
                  return (
                    <label key={key} className="block">
                      <span className="mb-1 block text-[11px] text-ink-3">{String(label)}</span>
                      <input
                        type="number"
                        className="w-full rounded-md border border-edge bg-input px-2 py-1 text-sm text-ink outline-none focus:border-brand-500"
                        disabled={locked}
                        value={val === undefined || val === null ? '' : String(val)}
                        onChange={(e) => patchObject(id, { [key]: e.target.value === '' ? '' : Number(e.target.value) })}
                      />
                    </label>
                  )
                }
                // 对象 → JSON
                if (val !== null && typeof val === 'object') {
                  return (
                    <label key={key} className="block">
                      <span className="mb-1 block text-[11px] text-ink-3">{String(label)}（JSON）</span>
                      <textarea
                        className="w-full resize-y rounded-md border border-edge bg-input px-2 py-1 font-mono text-sm text-ink outline-none focus:border-brand-500"
                        rows={2}
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
                // 单行文本
                return (
                  <label key={key} className="block">
                    <span className="mb-1 block text-[11px] text-ink-3">{String(label)}</span>
                    <input
                      className="w-full rounded-md border border-edge bg-input px-2 py-1 text-sm text-ink outline-none focus:border-brand-500"
                      disabled={locked}
                      value={String(val ?? '')}
                      onChange={(e) => patchObject(id, { [key]: e.target.value })}
                    />
                  </label>
                )
              })}

              {/* 可执行动作（从右侧面板迁移到节点上） */}
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
            </>
          )}
        </div>
      </div>

      {/* 右键菜单（§18）：复制 / 主动作 / 锁定 / 删除 */}
      {ctx && (
        <div
          className="absolute z-50 min-w-[140px] overflow-hidden rounded-lg border border-edge bg-panel py-1 shadow-node-dark"
          style={{ left: ctx.x, top: ctx.y }}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => setCtx(null)}
        >
          <button
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-ink transition hover:bg-hover"
            onClick={() => void duplicateObjects([id])}
          >
            <Copy size={11} /> 复制为新对象
          </button>
          {primaryAction && (
            <button
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-ink transition hover:bg-hover"
              onClick={() => void runAction(primaryAction, [id])}
              disabled={!!busy}
            >
              <Play size={11} /> 执行动作
            </button>
          )}
          <button
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-ink transition hover:bg-hover"
            onClick={() => toggleLock(id)}
          >
            {locked ? <LockOpen size={11} /> : <Lock size={11} />} {locked ? '解锁' : '锁定'}
          </button>
          <button
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-red-400 transition hover:bg-hover"
            onClick={() => void deleteObjects([id])}
          >
            <Trash2 size={11} /> 删除
          </button>
        </div>
      )}
    </>
  )
})

SceneObjectNode.displayName = 'SceneObjectNode'

export const sceneNodeTypes = { sceneObject: SceneObjectNode }
export default SceneObjectNode
