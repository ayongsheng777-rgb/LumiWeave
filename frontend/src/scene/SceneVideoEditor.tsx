// SceneVideoEditor —— 视频节点全面板（V2.7 → 界面重构 V2.9g：与图片节点同款图标化布局）
// 主界面：结果区 + 图标工具栏 + 常显文本框①描述/内容 + 常显文本框②提示词 + 🚀 生成视频大按钮
// 图标抽屉：🎬分镜 / 📐画面配置 / 🎙分镜音频 / 💬字幕 / ⚙️模型 / 📚技能库 / ✨润色 / 🧩素材库
// 防误触锁定 + 空值校验，功能属性不变、零删减。
import { useEffect, useMemo, useState } from 'react'
import {
  Loader2, Wand2, Send, Layers, Download, AudioLines, Captions,
  Settings2, Frame, Library, Sparkles, Clapperboard,
} from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { useUiStore } from '../store/uiStore'
import { aiChat, getProfiles, getSkills, promptLearningList, renderMedia } from '../api'
import {
  type AnyObj, type ParsedShot,
  isStoryNode, parseShotsFromScript, shotDesc, isImageUrl,
  fitsCapability,
} from './sceneScript'
import ErrorBanner from '../components/ErrorBanner'
import AiOptimizeBar from './AiOptimizeBar'
import { LockedDrawer, LockedModal } from './LockedOverlays'

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

  const shotNo = Number(payload.shot_no) || 0
  const currentShot: ParsedShot | undefined = mergedShots.find((s) => s.no === shotNo)
  const pickShot = (no: number) => {
    const s = mergedShots.find((x) => x.no === no)
    // 🔴 必须同时写 prompt：生成按钮只读 payload.prompt，此前只写 desc 导致按钮永远灰
    const d = s ? shotDesc(s) : ''
    patchObject(id, { shot_no: no ? String(no) : '', desc: d, prompt: d })
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

  // ── 面板状态 ─────────────────────────────────────────────
  const [drawer, setDrawer] = useState<'shot' | 'config' | 'audio' | 'subtitle' | 'model' | 'skill' | 'polish' | 'lib' | null>(null)
  const closeDrawer = () => setDrawer(null)
  const [errMsg, setErrMsg] = useState('')
  const [errDetail, setErrDetail] = useState('')

  const [aspectRatio, setAspectRatio] = useState(String(payload.aspect_ratio || '16:9'))
  const [motion, setMotion] = useState(String(payload.camera_motion || '固定镜头'))
  const [resolution, setResolution] = useState(String(payload.resolution || '1080p'))
  const [style, setStyle] = useState(String(payload.style || ''))
  const [subtitleOn, setSubtitleOn] = useState(!!payload.subtitle_enabled)
  const [dialogue, setDialogue] = useState(() =>
    Array.isArray(payload.dialogue_script) ? payload.dialogue_script : [],
  )
  const [sfx, setSfx] = useState(() =>
    Array.isArray(payload.sfx_desc) ? payload.sfx_desc : [],
  )
  const [profiles, setProfiles] = useState<{ id: string; name?: string; model?: string; scenes?: string[] }[]>([])
  const [cloudModelId, setCloudModelId] = useState(String(payload.gen_profile_id ?? payload.profile_id ?? ''))
  const [generating, setGenerating] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [skills, setSkills] = useState<AnyObj[]>([])
  const [kbs, setKbs] = useState<AnyObj[]>([])
  const [skillId, setSkillId] = useState(String(payload.skill_ref ?? ''))
  const [kbId, setKbId] = useState(String(payload.kb_ref ?? ''))
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

  // ── 分镜音频：AI 生成配音稿 ──
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

  // ── 分镜音频：AI 生成特效音效描述 ──
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
    const basePrompt = String(payload.prompt ?? '').trim()
    if (!basePrompt || generating) return
    setGenerating(true)
    setErrMsg('')
    try {
      const native: AnyObj = {}
      if (motion && motion !== '固定镜头') native.camera_movement = motion
      // 参考图 = 角色锁定图 + 连线进本节点的图片素材（此前只收 locked_ref，素材库连线图被漏掉，与节点卡片按钮行为相反）
      const lockedRefs = objects
        .filter((o) => {
          const p = (o?.data as AnyObj)?.payload as AnyObj | undefined
          return !!p && p.locked_ref === true && String(p.url || p.main_image || '').trim()
        })
        .map((o) => {
          const p = (o?.data as AnyObj)?.payload as AnyObj
          return String(p.url || p.main_image || '')
        })
      const linkedRefs = materials.filter((m) => m.kind === 'image' && m.url).map((m) => m.url)
      const refs = Array.from(new Set([...lockedRefs, ...linkedRefs])).filter(Boolean)
      // 提示词拼全字段（与后端 generate_node_video 一致）：风格/运镜/清晰度/对白/音效
      const extra: string[] = []
      if (style) extra.push(`【画面风格】${style}`)
      if (motion && motion !== '固定镜头') extra.push(`【运镜】${motion}`)
      if (resolution) extra.push(`【清晰度】${resolution}`)
      if (dialogue.length) extra.push(`【对白】${dialogue.filter(Boolean).join('；')}`)
      if (sfx.length) extra.push(`【音效】${sfx.filter(Boolean).join('、')}`)
      const prompt = extra.length ? `${basePrompt}\n${extra.join('\n')}` : basePrompt
      const negative = String(payload.negative_prompt ?? '').trim()
      const res = await renderMedia({
        kind: 'video',
        render_mode: 'cloud',
        profile_id: cloudModelId || undefined,
        params: {
          prompt,
          ratio: aspectRatio,
          duration: Number(payload.duration) || 5,
          negative,
          generate_audio: payload.generate_audio !== false,
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
          prompt: basePrompt, // 回写原始提示词（拼接串只用于本次请求，避免二次生成时重复拼接）
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

  const toolBtn = (active: boolean) =>
    `nodrag flex h-8 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] transition ${
      active ? 'bg-brand-600 text-white' : 'bg-soft text-ink-2 hover:bg-hover hover:text-ink'
    }`
  const tools: { key: typeof drawer; icon: React.ReactNode; label: string; title: string }[] = [
    { key: 'shot', icon: <Clapperboard size={14} />, label: '分镜', title: '选择分镜（自动带入内容/对白/音效）' },
    { key: 'config', icon: <Frame size={14} />, label: '画面配置', title: '画面比例 / 运镜 / 清晰度 / 风格' },
    { key: 'audio', icon: <AudioLines size={14} />, label: '分镜音频', title: '对白 / 画内画外音 / 特效音效' },
    { key: 'subtitle', icon: <Captions size={14} />, label: '字幕', title: '生成字幕开关' },
    { key: 'model', icon: <Settings2 size={14} />, label: '模型', title: '生成视频模型选择' },
    { key: 'skill', icon: <Library size={14} />, label: '技能库', title: '技能 / 知识库参考' },
    { key: 'polish', icon: <Sparkles size={14} />, label: '润色', title: 'AI 优化提示词' },
    { key: 'lib', icon: <Layers size={14} />, label: '素材库', title: '连线关联的人物/道具/背景音频素材' },
  ]

  const inputCls = 'nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500'

  return (
    <div className="flex flex-col gap-2 nowheel">
      {/* 视频预览 + 操作（图片 URL 按图片展示，不渲染无效播放器） */}
      {videoUrl && (
        <div className="relative overflow-hidden rounded-lg border border-edge bg-black/30">
          {isImageUrl(videoUrl) ? (
            <img src={videoUrl} alt="生成结果（图片）" className="max-h-44 w-full cursor-zoom-in object-contain" onClick={() => openLightbox(videoUrl)} />
          ) : (
            <video src={videoUrl} controls className="max-h-44 w-full object-contain" />
          )}
          <div className="absolute right-1 top-1 flex gap-1">
            <button className="nodrag rounded bg-black/60 p-1 text-white hover:bg-black/80" title="下载" onClick={download}>
              <Download size={13} />
            </button>
          </div>
        </div>
      )}

      {/* 顶部快捷图标工具栏（全面图标化） */}
      <div className="grid grid-cols-4 gap-1">
        {tools.map((t) => (
          <button
            key={t.key}
            className={toolBtn(drawer === t.key)}
            disabled={locked}
            title={t.title}
            onClick={() => setDrawer((cur) => (cur === t.key ? null : t.key))}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* 常显文本框 1：描述 / 内容（选中分镜自动带入） */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-ink-3">描述 / 内容{shotNo > 0 ? ` · 分镜${shotNo}` : ''}</span>
          {storyObj && <span className="text-[10px] text-brand-300">已识别 {mergedShots.length} 个分镜</span>}
        </div>
        <textarea
          className={inputCls}
          rows={Math.min(30, Math.max(3, String(payload.desc ?? '').split('\n').length))}
          value={String(payload.desc ?? '')}
          disabled={locked}
          placeholder="选择分镜自动带入画面内容，可手改…"
          onChange={(e) => patchObject(id, { desc: e.target.value })}
        />
      </div>

      {/* 常显文本框 2：提示词（AI 出视频用，可校对修改） */}
      <div className="space-y-1">
        <span className="text-[11px] text-ink-3">提示词（AI 出视频用，可校对修改）</span>
        <textarea
          className={inputCls}
          rows={Math.min(30, Math.max(2, String(payload.prompt ?? '').split('\n').length))}
          value={String(payload.prompt ?? '')}
          disabled={locked}
          placeholder="选择分镜自动带入或手写视频提示词…"
          onChange={(e) => patchObject(id, { prompt: e.target.value })}
        />
      </div>

      {/* 负面提示词（不希望出现的元素，对齐灵境负面提示词节点） */}
      <div className="space-y-1">
        <span className="text-[11px] text-ink-3">负面提示词（不希望出现的元素，可选）</span>
        <input
          className={inputCls}
          value={String(payload.negative_prompt ?? '')}
          disabled={locked}
          placeholder="如：低清晰度、水印、字幕、变形、多余手指…"
          onChange={(e) => patchObject(id, { negative_prompt: e.target.value })}
        />
      </div>

      {errMsg && <ErrorBanner message={errMsg} detail={errDetail || undefined} />}

      {/* 底部 🚀 激活生成视频 大按钮 */}
      <button
        className="nodrag flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
        disabled={locked || generating || !String(payload.prompt ?? '').trim()}
        onClick={() => void generate()}
      >
        {generating ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        {generating ? '生成中…' : '🚀 激活生成视频'}
      </button>

      {/* ── 🎬 分镜选择（底部抽屉）── */}
      <LockedDrawer
        open={drawer === 'shot'}
        onClose={closeDrawer}
        title="🎬 分镜选择"
        side="bottom"
        footer={
          <button className="nodrag flex h-9 w-full items-center justify-center rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500" onClick={closeDrawer}>
            完成
          </button>
        }
      >
        <div className="space-y-2">
          {storyObj ? (
            <div className="rounded-lg border border-brand-500/30 bg-brand-500/5 px-2 py-1.5 text-[11px] leading-snug text-brand-300">
              已连线剧情节点：自动识别 {mergedShots.length} 个分镜，选中后自动带入画面内容 / 对白 / 音效
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-edge px-2 py-1.5 text-[11px] text-ink-3">
              未连线剧情节点：可手动填写提示词直接生成；连线剧情后自动识别分镜内容 / 人物 / 道具 / 音频素材
            </div>
          )}
          <select
            className="nodrag h-8 w-full rounded-md border border-edge bg-input px-1.5 text-sm text-ink outline-none focus:border-brand-500"
            value={shotNo ? String(shotNo) : ''}
            disabled={locked}
            onChange={(e) => applyShot(Number(e.target.value))}
          >
            <option value="">选择分镜（生成分镜视频）</option>
            {mergedShots.map((s) => (
              <option key={s.no} value={s.no}>分镜{s.no}：{s.location || ''}{s.time ? `（${s.time}）` : ''}</option>
            ))}
          </select>
          {currentShot && (
            <div className="rounded-lg bg-soft px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
              {shotDesc(currentShot)}
            </div>
          )}
        </div>
      </LockedDrawer>

      {/* ── 📐 画面配置（弹窗）── */}
      <LockedModal
        open={drawer === 'config'}
        onClose={closeDrawer}
        title="📐 画面配置"
        footer={
          <button className="nodrag flex h-9 w-full items-center justify-center rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500" onClick={closeDrawer}>
            确定
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {dd('ratio', '画面比例', RATIO_OPTS, aspectRatio, (v) => { setAspectRatio(v); patchObject(id, { aspect_ratio: v }) })}
          {dd('motion', '运镜', CAMERA_MOTION_OPTS, motion, (v) => { setMotion(v); patchObject(id, { camera_motion: v }) })}
          {dd('res', '清晰度', RES_OPTS, resolution, (v) => { setResolution(v); patchObject(id, { resolution: v }) })}
          {dd('style', '风格', STYLE_OPTS, style, (v) => { setStyle(v); patchObject(id, { style: v }) })}
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">时长（秒）</span>
            <input
              type="number"
              min={1}
              max={60}
              className="nodrag nowheel w-full rounded-md border border-edge bg-input px-1.5 py-1 text-sm text-ink outline-none focus:border-brand-500"
              disabled={locked}
              value={String(payload.duration ?? '')}
              placeholder="默认 5 秒"
              onChange={(e) => patchObject(id, { duration: e.target.value })}
            />
          </label>
        </div>
      </LockedModal>

      {/* ── 🎙 分镜音频（底部抽屉）── */}
      <LockedDrawer
        open={drawer === 'audio'}
        onClose={closeDrawer}
        title="🎙 分镜音频（对白 · 画内画外音 · 特效音效）"
        side="bottom"
        footer={
          <button className="nodrag flex h-9 w-full items-center justify-center rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500" onClick={closeDrawer}>
            完成
          </button>
        }
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ink-3">对白 / 旁白（配音稿）</span>
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
            className={inputCls}
            rows={Math.min(12, Math.max(2, dialogue.join('\n').split('\n').length))}
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
            <span className="text-[11px] text-ink-3">特效音效（画内画外音）</span>
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
            className={inputCls}
            rows={Math.min(12, Math.max(2, sfx.join('\n').split('\n').length))}
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
      </LockedDrawer>

      {/* ── 💬 字幕（弹窗）── */}
      <LockedModal
        open={drawer === 'subtitle'}
        onClose={closeDrawer}
        title="💬 字幕"
        footer={
          <button className="nodrag flex h-9 w-full items-center justify-center rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500" onClick={closeDrawer}>
            确定
          </button>
        }
      >
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
      </LockedModal>

      {/* ── ⚙️ 模型选择（右抽屉）── */}
      <LockedDrawer
        open={drawer === 'model'}
        onClose={closeDrawer}
        title="⚙️ 模型选择"
        footer={
          <button className="nodrag flex h-9 w-full items-center justify-center rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500" onClick={closeDrawer}>
            保存设置
          </button>
        }
      >
        <div className="space-y-1.5">
          <span className="text-[11px] text-ink-3">生视频模型（模型库）</span>
          <select
            className="nodrag h-8 w-full rounded-md border border-edge bg-input px-1 text-sm text-ink outline-none focus:border-brand-500"
            value={cloudModelId}
            disabled={locked}
            onChange={(e) => { setCloudModelId(e.target.value); patchObject(id, { gen_profile_id: e.target.value }) }}
          >
            <option value="">默认模型（系统自动选）</option>
            {profiles.filter((p) => fitsCapability(p, 'video')).map((p) => {
              const sm = (p as AnyObj)?.scene_models as AnyObj | undefined
              const vidModel = String((sm && typeof sm === 'object' ? sm.video : '') ?? '') || String(p.model ?? '')
              return p && p.id ? (
                <option key={p.id} value={p.id}>
                  {String(p.name ?? p.id)}
                  {vidModel ? ` · ${vidModel}` : ''}
                </option>
              ) : null
            })}
          </select>
          <div className="text-[10px] leading-snug text-ink-3">
            在「设置-模型」中添加生视频模型（如 MiniMax H3 / Wan-AI），即可在此选择。选「默认模型」时系统智能路由自动选路。
          </div>
        </div>
      </LockedDrawer>

      {/* ── 📚 技能与知识库（右抽屉）── */}
      <LockedDrawer
        open={drawer === 'skill'}
        onClose={closeDrawer}
        title="📚 技能与知识库"
        footer={
          <button className="nodrag flex h-9 w-full items-center justify-center rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500" onClick={closeDrawer}>
            确认应用
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">技能库（内容注入提示词优化/配音稿/音效）</span>
            <select
              className="nodrag h-8 w-full rounded-md border border-edge bg-input px-1 text-sm text-ink outline-none focus:border-brand-500"
              value={skillId}
              disabled={locked}
              onChange={(e) => { setSkillId(e.target.value); patchObject(id, { skill_ref: e.target.value }) }}
            >
              <option value="">不引用技能</option>
              {skills.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>{String(s.name || s.id)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">知识库（内容注入提示词优化/配音稿/音效）</span>
            <select
              className="nodrag h-8 w-full rounded-md border border-edge bg-input px-1 text-sm text-ink outline-none focus:border-brand-500"
              value={kbId}
              disabled={locked}
              onChange={(e) => { setKbId(e.target.value); patchObject(id, { kb_ref: e.target.value }) }}
            >
              <option value="">不引用知识库</option>
              {kbs.map((k) => (
                <option key={String(k.id)} value={String(k.id)}>{String(k.title || k.id)}</option>
              ))}
            </select>
          </label>
        </div>
      </LockedDrawer>

      {/* ── ✨ AI 润色（右抽屉，非空校验）── */}
      <LockedDrawer
        open={drawer === 'polish'}
        onClose={closeDrawer}
        title="✨ AI 优化提示词"
        footer={
          <button className="nodrag flex h-9 w-full items-center justify-center rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500" onClick={closeDrawer}>
            完成
          </button>
        }
      >
        <div className="text-[11px] text-ink-3">优化当前视频提示词（自动带上画面风格/运镜/清晰度/比例）</div>
        <AiOptimizeBar
          id={id}
          target="prompt"
          label="优化"
          disabled={locked}
          requireInput
          quickReqs={['镜头特写', '节奏加快', '氛围沉浸', '写实风格']}
          quickTemplates={{
            '镜头特写': '强调镜头特写与细节，局部放大面部/手部/产品细节，浅景深，微距质感',
            '节奏加快': '整体节奏加快，动作利落，剪辑点干脆，节奏感强',
            '氛围沉浸': '强化场景氛围与情绪沉浸感，光影层次丰富，环境音与画面融合',
            '写实风格': '写实摄影风格，真实光影与材质，胶片质感，高细节，贴近真实世界',
          }}
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
      </LockedDrawer>

      {/* ── 🧩 素材库（底部抽屉）── */}
      <LockedDrawer
        open={drawer === 'lib'}
        onClose={closeDrawer}
        title="🧩 素材库"
        side="bottom"
        footer={
          <button className="nodrag flex h-9 w-full items-center justify-center rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500" onClick={closeDrawer}>
            完成
          </button>
        }
      >
        <div className="space-y-1.5">
          <div className="text-[11px] text-ink-3">连线关联的人物 / 道具 / 背景音频（{materials.length}）</div>
          {materials.length === 0 ? (
            <div className="rounded-lg border border-dashed border-edge px-3 py-4 text-center text-[11px] text-ink-3">
              暂无关联素材。把图片节点（设用途=人物/道具）或音频节点（设类型=BGM/对白）连线到本视频节点即可在此引用。
            </div>
          ) : (
            materials.map((m) => (
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
                  <div className="text-[10px] text-ink-3">{m.kind === 'image' ? '图片' : '音频'}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </LockedDrawer>
    </div>
  )
}
