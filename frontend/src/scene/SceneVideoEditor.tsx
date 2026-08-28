// SceneVideoEditor —— 视频节点全面板（V2.7）
// 连线剧情后：识别分镜 → 选序号自动带出分镜内容并关联人物/道具/背景音频素材
// + 悬浮素材库（连线关联素材一览）+ 画面比例/运镜/清晰度/风格配置 + 提示词 AI 优化
// + 分镜音频（对白/画内画外音/特效音效，不含 BGM）+ 字幕开关 + 云端生成视频
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Loader2, Wand2, Send, Layers, Download, AudioLines, Captions,
} from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { useUiStore } from '../store/uiStore'
import { aiChat, getProfiles, getSkills, promptLearningList, renderMedia } from '../api'
import {
  type AnyObj, type ParsedShot,
  isStoryNode, parseShotsFromScript, shotDesc,
  fitsCapability,
} from './sceneScript'
import ErrorBanner from '../components/ErrorBanner'
import AiOptimizeBar from './AiOptimizeBar'

// ── 配置选项（用户定稿）────────────────────────────────────────────
const RATIO_OPTS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const CAMERA_MOTION_OPTS = [
  '固定镜头', '跟随拍摄', '盘旋抬升', '盘旋下降', '镜头上摇', '镜头下摇',
  '镜头左摇', '镜头右摇', '镜头上升', '镜头下', '镜头左移', '镜头右移',
  '镜头前推', '镜头后移', '变焦推进', '变焦拉远', '柯克变焦', '环绕拍摄',
  '滚筒旋转', '第一视角', '无人机', '高空航拍', '手持拍',
]
const RES_OPTS = ['480P', '720p', '1080p', '2K', '4K']
const STYLE_OPTS = [
  '吉卜力', '赛璐璐', '新海诚', '皮克斯', '赛博朋克', 'Q版2D', '美式漫画',
  '波普艺术', '像素风', '游戏CG', '国漫3D', '国漫2D', '中式水墨', '武侠写实',
  '宫斗权谋', '古偶唯美', '短剧', '邵氏电影', '港风霓虹', '日式青春胶片',
  '黑白胶片', '时尚大片', '粘土动画', '毛绒玩具', '西部电影', '末世废土',
  '蒸汽朋克', '史诗奇幻',
]

/** 模型库「适用场景」匹配（V2.8.2：只列具备生视频能力的模型） */

type MaterialNode = {
  id: string
  objectType: string
  label: string
  url: string
  thumb: string
  kind: 'image' | 'audio'
}

export default function SceneVideoEditor({ id, locked }: { id: string; locked: boolean }) {
  const patchObject = useSceneStore((s) => s.patchObject)
  const objects = useSceneStore((s) => s.objects)
  const edges = useSceneStore((s) => s.edges)
  const openLightbox = useUiStore((s) => s.openLightbox)
  const obj = useSceneStore((s) => s.objects.find((o) => o.id === id))
  const payload = ((obj?.data as AnyObj)?.payload || {}) as AnyObj
  const videoUrl = String(payload.url ?? '')

  // ── 连线剧情节点：读剧本 + 解析分镜 ──
  const storyObj = useMemo(() => {
    const sid = edges
      .map((e) => (e.source === id ? e.target : e.target === id ? e.source : ''))
      .find((x) => !!x && isStoryNode(objects.find((o) => o.id === x)))
    return sid ? objects.find((o) => o.id === sid) : null
  }, [edges, objects, id])
  const script = String(((storyObj?.data as AnyObj)?.payload as AnyObj)?.script ?? '')
  const mergedShots = useMemo(() => (script ? parseShotsFromScript(script) : []), [script])

  // ── 选中的分镜 ──
  const shotNo = Number(payload.shot_no) || 0
  const currentShot: ParsedShot | undefined = mergedShots.find((s) => s.no === shotNo)
  const pickShot = (no: number) => {
    const s = mergedShots.find((x) => x.no === no)
    patchObject(id, { shot_no: no ? String(no) : '', desc: s ? shotDesc(s) : '' })
  }

  // ── 关联素材：连线指向本节点的图片（人物/道具）与音频（BGM/对白）──
  const materials: MaterialNode[] = useMemo(() => {
    const out: MaterialNode[] = []
    const linkedIds = edges
      .filter((e) => e.target === id)
      .map((e) => e.source)
    for (const oid of linkedIds) {
      const o = objects.find((x) => x.id === oid)
      if (!o) continue
      // 🔴 场景对象节点 type 恒为 sceneObject，真实类型在 data.objectType
      const t = String(((o.data as AnyObj)?.objectType) ?? '')
      const p = ((o.data as AnyObj)?.payload as AnyObj) || {}
      if (t === 'image') {
        const purpose = String(p.purpose ?? '')
        const name = String(p.title || p.selected || purpose || '图片')
        const url = String(p.url ?? p.main_image ?? '')
        out.push({ id: oid, objectType: 'image', label: `${purpose ? purpose + '·' : ''}${name}`, url, thumb: url, kind: 'image' })
      } else if (t === 'audio') {
        const at = String(p.audio_type ?? '')
        out.push({ id: oid, objectType: 'audio', label: `${at ? at + '·' : ''}${String(p.text || p.title || '音频')}`, url: String(p.url ?? ''), thumb: '', kind: 'audio' })
      }
    }
    return out
  }, [edges, objects, id])

  // ── 悬浮素材库 ──
  const [libOpen, setLibOpen] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const [errDetail, setErrDetail] = useState('')

  // ── 生成配置（持久化到节点）──
  const [aspectRatio, setAspectRatio] = useState(String(payload.aspect_ratio || '16:9'))
  const [motion, setMotion] = useState(String(payload.camera_motion || '固定镜头'))
  const [resolution, setResolution] = useState(String(payload.resolution || '1080p'))
  const [style, setStyle] = useState(String(payload.style || ''))
  const [subtitleOn, setSubtitleOn] = useState(!!payload.subtitle_enabled)
  // 分镜音频：对白 + 画内画外音/特效音效
  const [dialogue, setDialogue] = useState(() =>
    Array.isArray(payload.dialogue_script) ? payload.dialogue_script : [],
  )
  const [sfx, setSfx] = useState(() =>
    Array.isArray(payload.sfx_desc) ? payload.sfx_desc : [],
  )
  // 生成模型 / 状态
  const [profiles, setProfiles] = useState<{ id: string; name?: string; model?: string; scenes?: string[] }[]>([])
  const [cloudModelId, setCloudModelId] = useState(String(payload.gen_profile_id ?? payload.profile_id ?? ''))
  const [generating, setGenerating] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  // 技能库 / 知识库参考（V2.8：注入 AI 优化/配音稿/音效 三个操作）
  const [skills, setSkills] = useState<AnyObj[]>([])
  const [kbs, setKbs] = useState<AnyObj[]>([])
  const [skillId, setSkillId] = useState(String(payload.skill_ref ?? ''))
  const [kbId, setKbId] = useState(String(payload.kb_ref ?? ''))
  // AI 配音稿 / AI 音效 自定义要求
  const [dialogueReq, setDialogueReq] = useState(String(payload.dialogue_req ?? ''))
  const [sfxReq, setSfxReq] = useState(String(payload.sfx_req ?? ''))

  useEffect(() => {
    getProfiles()
      .then((r) => {
        const list = ((r.data as AnyObj)?.profiles as { id: string; name?: string; model?: string; scenes?: string[] }[]) || []
        setProfiles(list)
        if (list.length && !cloudModelId) setCloudModelId(list[0].id)
      })
      .catch(() => {})
    getSkills()
      .then((r) => {
        const d = r.data as AnyObj
        const list = Array.isArray(d) ? d : Array.isArray((d as AnyObj)?.skills) ? (d as AnyObj).skills : []
        setSkills((list as AnyObj[]) || [])
      })
      .catch(() => {})
    promptLearningList()
      .then((r) => {
        const k = ((r.data as AnyObj)?.knowledge as AnyObj[]) || []
        setKbs(k)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 技能库/知识库参考内容（注入 AI 优化/配音稿/音效） */
  const buildRefContext = () => {
    const parts: string[] = []
    if (skillId) {
      const s = skills.find((x) => String(x.id) === skillId)
      const content = String(s?.content || s?.description || s?.prompt || '')
      if (content) parts.push(`【技能参考】\n${content}`)
    }
    if (kbId) {
      const k = kbs.find((x) => String(x.id) === kbId)
      const content = String(k?.content || '')
      if (content) parts.push(`【知识库参考】\n${content}`)
    }
    return parts.join('\n\n')
  }

  // 选择分镜 → 自动带出对白 / 画内画外音 / 特效音效
  const applyShot = (no: number) => {
    pickShot(no)
    const s = mergedShots.find((x) => x.no === no)
    if (!s) return
    if (s.dialogue.length) setDialogue(s.dialogue.map((d) => `${d.speaker}${d.emotion ? `（${d.emotion}）` : ''}：${d.line}`))
    if (s.sfx.length) setSfx(s.sfx)
  }

  // ── 提示词 AI 优化（V2.8.1：已迁移到通用 AiOptimizeBar —— 独立模型选择 + 用户要求输入框）
  // 原 optimizePrompt 函数移除，由 AiOptimizeBar 承担（含【用户要求】注入）

  // ── 分镜音频：AI 生成配音稿（对白/画内画外音，支持技能/知识库参考 + 自定义要求）──
  const genDialogue = async () => {
    if (!currentShot || rewriting) return
    setRewriting(true)
    try {
      const lines = dialogue.length ? dialogue.join('\n') : ''
      const res = await aiChat({
        system: '你是短剧配音导演。把分镜对白/旁白整理成可直接配音的配音稿（含说话人、情绪、画内画外音标注），中文口语化，直接输出文本。',
        user: [
          `【分镜】分镜${currentShot.no}：${currentShot.location || ''} ${currentShot.goal || ''}`,
          `【对白/旁白】\n${lines || '（无，请按分镜内容补合理对白）'}`,
          dialogueReq.trim() ? `【自定义要求】${dialogueReq.trim()}` : '',
          buildRefContext(),
        ].filter(Boolean).join('\n'),
        profile_id: cloudModelId || undefined,
        scenario: 'general',
      })
      const out = res.ok ? String((res.data as AnyObj)?.result ?? '') : ''
      if (out) {
        setDialogue([out])
        patchObject(id, { dialogue_script: [out] })
      }
    } finally {
      setRewriting(false)
    }
  }

  // ── 分镜音频：AI 生成特效音效描述（支持技能/知识库参考 + 自定义要求）──
  const genSfx = async () => {
    if (!currentShot || rewriting) return
    setRewriting(true)
    try {
      const lines = sfx.length ? sfx.join('、') : ''
      const res = await aiChat({
        system: '你是影视拟音师。根据分镜内容生成特效音效清单（环境音/动作音效/拟音），每行一条，中文描述具体（如"玻璃碎裂声+低沉混响"），直接输出清单。',
        user: [
          `【分镜】分镜${currentShot.no}：${currentShot.location || ''} ${currentShot.goal || ''}`,
          `【画面】${shotDesc(currentShot)}`,
          `【已有音效】${lines || '（无，请按画面生成 3-5 条）'}`,
          sfxReq.trim() ? `【自定义要求】${sfxReq.trim()}` : '',
          buildRefContext(),
        ].filter(Boolean).join('\n'),
        profile_id: cloudModelId || undefined,
        scenario: 'general',
      })
      const out = res.ok ? String((res.data as AnyObj)?.result ?? '') : ''
      if (out) {
        const arr = out.split('\n').map((l) => l.trim().replace(/^[-*•\d.、)\s]+/, '')).filter(Boolean)
        setSfx(arr)
        patchObject(id, { sfx_desc: arr })
      }
    } finally {
      setRewriting(false)
    }
  }

  // ── 生成视频（云端，结果写回当前节点）──
  const generate = async () => {
    const prompt = String(payload.prompt ?? '').trim()
    if (!prompt || generating) return
    setGenerating(true)
    setErrMsg('')
    try {
      const native: AnyObj = {}
      if (motion && motion !== '固定镜头') native.camera_movement = motion
      // 角色锁定参考源（V2.8）：收集场景内 locked_ref 图片作为参考图（I2V 首帧/参考），跨分镜保持一致
      const refs = objects
        .filter((o) => {
          const p = (o?.data as AnyObj)?.payload as AnyObj | undefined
          return !!p && p.locked_ref === true && String(p.url || p.main_image || '').trim()
        })
        .map((o) => {
          const p = (o?.data as AnyObj)?.payload as AnyObj
          return String(p.url || p.main_image || '')
        })
        .filter(Boolean)
      const res = await renderMedia({
        kind: 'video',
        render_mode: 'cloud',
        profile_id: cloudModelId || undefined,
        params: {
          prompt,
          ratio: aspectRatio,
          duration: Number(payload.duration) || 6,
          native,
          ...(refs.length ? { reference_images: refs } : {}),
        },
      })
      const d = res.data as AnyObj
      const vids = (d?.videos as { url?: string }[] | undefined) || []
      const url = String(vids?.[0]?.url || d?.url || d?.result || '')
      if (res.ok && url) {
        patchObject(id, {
          url,
          prompt,
          aspect_ratio: aspectRatio,
          camera_motion: motion,
          resolution,
          style,
          gen_profile_id: cloudModelId,
          subtitle_enabled: subtitleOn,
        })
        return
      }
      setErrMsg('视频生成失败，请检查所选模型/网络配置后重试')
      setErrDetail(String(d?.error || d?.message || '未知错误'))
    } catch (e) {
      setErrMsg('视频生成异常，请稍后重试')
      setErrDetail(String(e))
    } finally {
      setGenerating(false)
    }
  }

  const download = () => {
    if (!videoUrl) return
    const a = document.createElement('a')
    a.href = videoUrl
    a.download = 'lumiweave-video.mp4'
    a.target = '_blank'
    a.click()
  }

  const dd = (key: string, label: string, opts: string[], value: string, onChange: (v: string) => void) => (
    <label key={key} className="block">
      <span className="mb-1 block text-[11px] text-ink-3">{label}</span>
      <select
        className="nodrag nowheel w-full rounded-md border border-edge bg-input px-1.5 py-1 text-sm text-ink outline-none focus:border-brand-500"
        disabled={locked}
        value={opts.includes(value) ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{value && !opts.includes(value) ? value : `未指定${label}`}</option>
        {opts.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto nowheel">
      {/* 视频预览 + 操作 */}
      {videoUrl && (
        <div className="relative overflow-hidden rounded-lg border border-edge bg-black/30">
          <video src={videoUrl} controls className="max-h-44 w-full object-contain" />
          <div className="absolute right-1 top-1 flex gap-1">
            <button className="nodrag rounded bg-black/60 p-1 text-white hover:bg-black/80" title="下载" onClick={download}>
              <Download size={13} />
            </button>
          </div>
        </div>
      )}

      {/* 连线剧情节点状态提示（V2.8.1 对齐图片/音频编辑器） */}
      {storyObj ? (
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/5 px-2 py-1.5 text-[11px] leading-snug text-brand-300">
          已连线剧情节点：自动识别 {mergedShots.length} 个分镜，选中分镜后自动带入画面内容 / 对白 / 音效
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-edge px-2 py-1.5 text-[11px] leading-snug text-ink-3">
          未连线剧情节点：可手动填写提示词直接生成；连线剧情后自动识别分镜内容 / 人物 / 道具 / 音频素材
        </div>
      )}

      {/* 分镜选择 + 素材库入口 */}
      <div className="flex items-center gap-1.5">
        <select
          className="nodrag h-8 min-w-0 flex-1 rounded-md border border-edge bg-input px-1.5 text-sm text-ink outline-none focus:border-brand-500"
          value={shotNo ? String(shotNo) : ''}
          disabled={locked}
          onChange={(e) => applyShot(Number(e.target.value))}
        >
          <option value="">选择分镜（生成分镜视频）</option>
          {mergedShots.map((s) => (
            <option key={s.no} value={s.no}>分镜{s.no}：{s.location || ''}{s.time ? `（${s.time}）` : ''}</option>
          ))}
        </select>
        <button
          className="nodrag flex h-8 shrink-0 items-center gap-1 rounded-md border border-edge bg-soft px-2 text-sm text-ink-2 transition hover:border-brand-500 hover:text-ink"
          disabled={locked}
          onClick={() => setLibOpen(true)}
          title="悬浮素材库：连线关联的人物/道具/背景音频素材"
        >
          <Layers size={13} />
          素材库{materials.length > 0 ? `(${materials.length})` : ''}
        </button>
      </div>

      {/* 当前分镜内容（自动带入，可手改） */}
      {shotNo > 0 && (
        <textarea
          className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
          rows={Math.min(5, Math.max(2, String(payload.desc ?? '').split('\n').length))}
          value={String(payload.desc ?? '')}
          disabled={locked}
          placeholder="选中分镜后自动带入分镜内容，可手改…"
          onChange={(e) => patchObject(id, { desc: e.target.value })}
        />
      )}

      {/* 生成配置：画面比例 / 运镜 / 清晰度 / 风格 */}
      <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-edge p-1.5">
        {dd('ratio', '画面比例', RATIO_OPTS, aspectRatio, (v) => { setAspectRatio(v); patchObject(id, { aspect_ratio: v }) })}
        {dd('motion', '运镜', CAMERA_MOTION_OPTS, motion, (v) => { setMotion(v); patchObject(id, { camera_motion: v }) })}
        {dd('res', '清晰度', RES_OPTS, resolution, (v) => { setResolution(v); patchObject(id, { resolution: v }) })}
        {dd('style', '风格', STYLE_OPTS, style, (v) => { setStyle(v); patchObject(id, { style: v }) })}
      </div>

      {/* 技能库 / 知识库参考（注入 AI 优化/配音稿/音效） */}
      <div className="grid grid-cols-2 gap-1.5">
        <select
          className="nodrag h-8 min-w-0 rounded-md border border-edge bg-input px-1 text-sm text-ink outline-none focus:border-brand-500"
          value={skillId}
          disabled={locked}
          onChange={(e) => { setSkillId(e.target.value); patchObject(id, { skill_ref: e.target.value }) }}
          title="技能库：选中后内容注入 AI 提示词优化/配音稿/音效"
        >
          <option value="">技能库</option>
          {skills.map((s) => (
            <option key={String(s.id)} value={String(s.id)}>{String(s.name || s.id)}</option>
          ))}
        </select>
        <select
          className="nodrag h-8 min-w-0 rounded-md border border-edge bg-input px-1 text-sm text-ink outline-none focus:border-brand-500"
          value={kbId}
          disabled={locked}
          onChange={(e) => { setKbId(e.target.value); patchObject(id, { kb_ref: e.target.value }) }}
          title="知识库：选中后内容注入 AI 提示词优化/配音稿/音效"
        >
          <option value="">知识库</option>
          {kbs.map((k) => (
            <option key={String(k.id)} value={String(k.id)}>{String(k.title || k.id)}</option>
          ))}
        </select>
      </div>

      {/* 提示词 + AI 优化（V2.8.1：独立模型选择 + 用户要求输入框） */}
      <div className="space-y-1.5 rounded-lg border border-edge p-1.5">
        <span className="text-[11px] text-ink-3">生成提示词（AI 优化可带要求，如：强调产品特写、节奏加快）</span>
        <textarea
          className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
          rows={3}
          value={String(payload.prompt ?? '')}
          disabled={locked}
          placeholder="选择分镜后自动带入，或手动编写视频提示词…"
          onChange={(e) => patchObject(id, { prompt: e.target.value })}
        />
        <AiOptimizeBar
          id={id}
          target="prompt"
          label="AI 优化"
          disabled={locked}
          system={
            '你是短视频分镜视频提示词专家。把提示词优化成可直接用于视频生成模型的高质量中文提示词：画面具体、有镜头感、含光线构图与运镜描述、符合所选风格/运镜/清晰度。只输出优化后的提示词，不要多余解释。'
          }
          getContext={() =>
            [
              style ? `【画面风格】${style}` : '',
              motion && motion !== '固定镜头' ? `【运镜】${motion}` : '',
              resolution ? `【清晰度】${resolution}` : '',
              aspectRatio ? `【画面比例】${aspectRatio}` : '',
              buildRefContext(),
            ].filter(Boolean).join('\n')
          }
        />
        {/* 生成视频模型（独立于 AI 优化模型） */}
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-[11px] text-ink-3">生成模型</span>
          <select
            className="nodrag h-7 min-w-0 flex-1 rounded-md border border-edge bg-input px-1 text-[11px] text-ink outline-none focus:border-brand-500"
            value={cloudModelId}
            disabled={locked}
            onChange={(e) => { setCloudModelId(e.target.value); patchObject(id, { gen_profile_id: e.target.value }) }}
            title="选择模型库中的视频模型"
          >
            <option value="">默认模型（系统自动选）</option>
            {profiles.filter((p) => fitsCapability(p, 'video')).map((p) =>
              p && p.id ? (
                <option key={p.id} value={p.id}>
                  {String(p.name ?? p.id)}
                  {p.model ? ` · ${p.model}` : ''}
                </option>
              ) : null,
            )}
          </select>
        </div>
      </div>

      {/* 分镜音频：对白 / 画内画外音 / 特效音效（不含 BGM，BGM 归音频节点） */}
      <div className="space-y-1.5 rounded-lg border border-edge p-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-ink-3">🎙 分镜音频（对白 · 画内画外音 · 特效音效）</span>
          <button
            className="nodrag flex items-center gap-1 rounded bg-soft px-2 py-1 text-[11px] text-ink-2 transition hover:text-ink disabled:opacity-50"
            disabled={locked || rewriting || !currentShot}
            onClick={() => void genDialogue()}
          >
            {rewriting ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
            AI 配音稿
          </button>
        </div>
        <textarea
          className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
          rows={2}
          value={dialogue.join('\n')}
          disabled={locked}
          placeholder="选择分镜自动带入对白/旁白，可编辑，或用 AI 生成配音稿…"
          onChange={(e) => { setDialogue(e.target.value.split('\n')); patchObject(id, { dialogue_script: e.target.value.split('\n') }) }}
        />
        <input
          className="nodrag h-7 w-full rounded-md border border-edge bg-input px-2 text-[11px] text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
          value={dialogueReq}
          disabled={locked}
          placeholder="AI 配音稿自定义要求（可选），如：加入产品卖点、语速偏快、结尾引导下单…"
          onChange={(e) => { setDialogueReq(e.target.value); patchObject(id, { dialogue_req: e.target.value }) }}
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-ink-3">💥 特效音效（画内画外音）</span>
          <button
            className="nodrag flex items-center gap-1 rounded bg-soft px-2 py-1 text-[11px] text-ink-2 transition hover:text-ink disabled:opacity-50"
            disabled={locked || rewriting || !currentShot}
            onClick={() => void genSfx()}
          >
            {rewriting ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
            AI 音效
          </button>
        </div>
        <textarea
          className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
          rows={2}
          value={sfx.join('\n')}
          disabled={locked}
          placeholder="选择分镜自动带入环境音/音效标注，可编辑，或用 AI 生成…"
          onChange={(e) => { setSfx(e.target.value.split('\n')); patchObject(id, { sfx_desc: e.target.value.split('\n') }) }}
        />
        <input
          className="nodrag h-7 w-full rounded-md border border-edge bg-input px-2 text-[11px] text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
          value={sfxReq}
          disabled={locked}
          placeholder="AI 音效自定义要求（可选），如：全部 5.1 声道、加入脚步声特写…"
          onChange={(e) => { setSfxReq(e.target.value); patchObject(id, { sfx_req: e.target.value }) }}
        />
      </div>

      {/* 字幕开关 + 生成按钮 */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 rounded-lg border border-edge px-2 py-1.5">
          <input
            type="checkbox"
            className="nodrag accent-brand-500"
            disabled={locked}
            checked={subtitleOn}
            onChange={(e) => { setSubtitleOn(e.target.checked); patchObject(id, { subtitle_enabled: e.target.checked }) }}
          />
          <Captions size={13} className="text-ink-3" />
          <span className="text-[11px] text-ink-2">生成字幕（按分镜对白自动生成，需先有对白/配音稿）</span>
        </label>
        <button
          className="nodrag flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 text-sm text-white transition hover:bg-brand-500 disabled:opacity-50"
          disabled={locked || generating || !String(payload.prompt ?? '').trim()}
          onClick={() => void generate()}
        >
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {generating ? '生成中…' : '生成视频'}
        </button>
        {errMsg && <ErrorBanner message={errMsg} detail={errDetail || undefined} />}
      </div>

      {/* 悬浮素材库浮层 */}
      {libOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
            onClick={() => setLibOpen(false)}
          >
            <div
              className="max-h-[70vh] w-[440px] overflow-y-auto rounded-xl border border-edge bg-panel-2 p-3 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-ink">素材库（{materials.length}）</span>
                <span className="text-[11px] text-ink-3">连线关联的人物 / 道具 / 背景音频</span>
              </div>
              {materials.length === 0 ? (
                <div className="rounded-lg border border-dashed border-edge px-3 py-4 text-center text-[11px] text-ink-3">
                  暂无关联素材。把图片节点（设用途=人物/道具）或音频节点（设类型=BGM/对白）连线到本视频节点即可在此引用。
                </div>
              ) : (
                <div className="space-y-1.5">
                  {materials.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 rounded-lg border border-edge bg-soft px-2 py-1.5">
                      {m.kind === 'image' ? (
                        m.thumb ? (
                          <img
                            src={m.thumb}
                            alt={m.label}
                            className="h-9 w-9 shrink-0 cursor-zoom-in rounded object-cover"
                            onClick={() => openLightbox(m.thumb)}
                          />
                        ) : (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-brand-500/15 text-[10px] text-brand-300">🖼</span>
                        )
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-amber-400/15 text-[10px] text-amber-400">
                          <AudioLines size={14} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] text-ink">{m.label}</div>
                        <div className="text-[10px] text-ink-3">{m.objectType === 'image' ? '图片素材' : '音频素材'}</div>
                      </div>
                      {m.kind === 'audio' && m.url && <audio src={m.url} controls className="h-6 w-24 shrink-0" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}



