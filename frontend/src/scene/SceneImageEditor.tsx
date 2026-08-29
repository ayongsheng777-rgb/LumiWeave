// SceneImageEditor —— 图片节点全面板（V2.7 → 界面重构文档 V2.9g）
// 按《界面重构方案与设计文档》改造：
//   1. 全面图标化：模型/尺寸/生成方式/技能知识库/润色/重写/实体 全部收敛为独立图标 → 抽屉/弹窗
//   2. 主界面常显两个文本框：①描述/内容编辑框 ②提示词校对框；底部🚀激活生成图片大按钮
//   3. 防误触锁定：抽屉/弹窗点遮罩不关闭，必须点 完成/取消
//   4. 空值校验：抽屉输入框为空点执行 → Warning 拦截，不触发接口
// 功能属性不变、不删减：识别/描述提取/手动添加/模型/分辨率比例/生成方式/润色/重写/技能/知识库/参考图全保留
import { useEffect, useMemo, useState } from 'react'
import {
  Loader2, Wand2, ZoomIn, Download, Paintbrush, Send,
  Settings2, Frame, Cloud, Library, Sparkles, Users,
} from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { useUiStore } from '../store/uiStore'
import {
  aiChat, getProfiles, getRenderers, getRendererWorkflows,
  getSkills, promptLearningList, renderMedia,
} from '../api'
import SceneImageEdit from './SceneImageEdit'
import { LockedDrawer, LockedModal } from './LockedOverlays'
import AiOptimizeBar from './AiOptimizeBar'
import SkillPicker from './SkillPicker'
import ErrorBanner from '../components/ErrorBanner'
import {
  type AnyObj, type ParsedScript, EMPTY_PARSED, isStoryNode,
  parseCharacters, parseProps, parsePropsList, parseShotsFromScript, sceneDesc,
  fitsCapability, fitsLlm,
} from './sceneScript'

type Category = '人物' | '道具' | '场景'

// ── 分辨率 / 宽高比 ────────────────────────────────────────
const RES_SHORT: Record<string, number> = { '480P': 480, '720P': 720, '1K': 1024, '2K': 1440 }
const RES_OPTS_IMG = ['480P', '720P', '1K', '2K']
const RATIO_OPTS_IMG = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']

/** 按 短边(分辨率) × 宽高比 计算生成尺寸（取 8 的倍数） */
function calcImageSize(resolution: string, ratio: string): string {
  const short = RES_SHORT[resolution] || 1024
  const m = ratio.split(':').map((x) => Number(x))
  if (m.length !== 2 || !m[0] || !m[1]) return '1024x1024'
  const [w, h] = m
  let width: number
  let height: number
  if (w >= h) {
    height = short
    width = Math.round((short * w) / h)
  } else {
    width = short
    height = Math.round((short * h) / w)
  }
  const round8 = (v: number) => Math.max(8, Math.round(v / 8) * 8)
  return `${round8(width)}x${round8(height)}`
}

export default function SceneImageEditor({ id, locked }: { id: string; locked: boolean }) {
  const patchObject = useSceneStore((s) => s.patchObject)
  const objects = useSceneStore((s) => s.objects)
  const edges = useSceneStore((s) => s.edges)
  const openLightbox = useUiStore((s) => s.openLightbox)
  const obj = useSceneStore((s) => s.objects.find((o) => o.id === id))
  const payload = ((obj?.data as AnyObj)?.payload || {}) as AnyObj
  const imageUrl = String(payload.url ?? '')

  // ── 连线剧情节点：读剧本 + 解析数据 ──
  const storyObj = useMemo(() => {
    const sid = edges
      .map((e) => (e.source === id ? e.target : e.target === id ? e.source : ''))
      .find((x) => !!x && isStoryNode(objects.find((o) => o.id === x)))
    return sid ? objects.find((o) => o.id === sid) : null
  }, [edges, objects, id])
  const storyPayload = ((storyObj?.data as AnyObj)?.payload || {}) as AnyObj
  const script = String(storyPayload.script ?? '')
  const parsed: ParsedScript = (storyPayload.parsed as ParsedScript) || EMPTY_PARSED
  const charDescs = useMemo(() => parseCharacters(script), [script])
  const propDescs = useMemo(() => parseProps(script), [script])
  const propList = useMemo(() => parsePropsList(script), [script])
  const mergedShots = useMemo(() => {
    if (script) return parseShotsFromScript(script)
    return parsed.shots || []
  }, [parsed, script])

  // ── 面板状态 ─────────────────────────────────────────────
  const [category, setCategory] = useState<Category>('人物')
  const [selected, setSelected] = useState('')
  const [desc, setDesc] = useState('')
  const [rewriteReq, setRewriteReq] = useState('')
  const [rewriting, setRewriting] = useState(false)
  const [profiles, setProfiles] = useState<{ id: string; name?: string; model?: string; scenes?: string[] }[]>([])
  const [aiProfileId, setAiProfileId] = useState(String(payload.profile_id ?? ''))
  const [skills, setSkills] = useState<AnyObj[]>([])
  const [skillId, setSkillId] = useState(String(payload.skill_ref ?? ''))
  const [kbs, setKbs] = useState<AnyObj[]>([])
  const [kbId, setKbId] = useState(String(payload.kb_ref ?? ''))
  const [errMsg, setErrMsg] = useState('')
  const [errDetail, setErrDetail] = useState('')

  // 生成方式：云端=模型库选模型（直连）；ComfyUI=选渲染器
  const [mode, setMode] = useState<'cloud' | 'comfyui'>(String(payload.render_mode ?? 'cloud') === 'comfyui' ? 'comfyui' : 'cloud')
  const [cloudModelId, setCloudModelId] = useState(String(payload.gen_profile_id ?? payload.profile_id ?? ''))
  const [resolution, setResolution] = useState(String(payload.resolution || '1K'))
  const [ratio, setRatio] = useState(String(payload.ratio || '1:1'))
  const [renderers, setRenderers] = useState<AnyObj[]>([])
  const [rendererId, setRendererId] = useState(String(payload.renderer_id ?? ''))
  const [checkpoints, setCheckpoints] = useState<string[]>([])
  const [checkpoint, setCheckpoint] = useState(String(payload.checkpoint ?? ''))
  const [generating, setGenerating] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  // ── 功能抽屉/弹窗开关（界面重构：图标化）──────────────────
  const [drawer, setDrawer] = useState<'model' | 'size' | 'mode' | 'skill' | 'polish' | 'rewrite' | 'entity' | null>(null)
  const closeDrawer = () => setDrawer(null)

  // ── 选项列表：前端实时解析 + 手动项 ──
  const [manualItems, setManualItems] = useState<string[]>([])
  const [manualInput, setManualInput] = useState('')
  const options = useMemo(() => {
    if (category === '人物') {
      const names = script ? Object.keys(charDescs) : parsed.characters || []
      return Array.from(new Set([...names, ...manualItems]))
    }
    if (category === '道具') {
      const names = script ? propList : parsed.props || []
      return Array.from(new Set([...names, ...manualItems]))
    }
    const shots = script ? mergedShots : parsed.shots || []
    return Array.from(
      new Set([...shots.map((s) => `分镜${s.no}：${s.location}${s.time ? `，${s.time}` : ''}`.trim()), ...manualItems]),
    )
  }, [category, script, charDescs, propList, mergedShots, parsed, manualItems])

  // ── 数据加载 ─────────────────────────────────────────────
  useEffect(() => {
    getProfiles()
      .then((r) => {
        const list = ((r.data as AnyObj)?.profiles as { id: string; name?: string; model?: string; scenes?: string[] }[]) || []
        setProfiles(list)
        if (list.length && !aiProfileId) setAiProfileId(list[0].id)
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
    getRenderers()
      .then((r) => {
        const all = ((r.data as AnyObj)?.renderers as AnyObj[]) || (r.data as AnyObj[]) || []
        const list = all.filter((p) => String(p.type ?? '').includes('comfyui') && p.status !== 'disabled')
        setRenderers(list.length ? list : all)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 恢复已保存的面板状态
  useEffect(() => {
    if (payload.category) setCategory(String(payload.category) as Category)
    else if (payload.purpose) setCategory(String(payload.purpose) as Category)
    if (payload.selected) setSelected(String(payload.selected))
    else {
      const t = String(payload.title || payload.name || '').trim()
      if (t.includes('·')) {
        const name = t.split('·')[1]?.trim()
        if (name) setSelected(name)
      }
    }
    if (payload.desc) setDesc(String(payload.desc))
    else if (payload.prompt) setDesc(String(payload.prompt))
    else if (String(payload.title ?? '').trim() && !String(payload.desc ?? '').trim()) setDesc(String(payload.title))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // renderer 切换 → 拉 ComfyUI 能力（checkpoint）
  useEffect(() => {
    if (mode !== 'comfyui' || !rendererId) return
    getRendererWorkflows(rendererId)
      .then((r) => {
        const cps = ((r.data as AnyObj)?.checkpoints as string[]) || []
        setCheckpoints(cps)
        if (cps.length && !checkpoint) setCheckpoint(cps[0])
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendererId, mode])

  // 类别切换 → 重置选中与描述（同步写 purpose，保证后端参考图按用途匹配不漂移）
  const switchCategory = (c: Category) => {
    setCategory(c)
    setSelected('')
    setDesc('')
    patchObject(id, { purpose: c })
  }

  // 选中对象 → 提取描述 + 标题自动识别为选中对象
  const pickOption = (val: string) => {
    setSelected(val)
    patchObject(id, { purpose: category, title: `${category}·${val}` })
    if (category === '场景') {
      const nm = val.match(/^分镜(\d+)/)
      const no = nm ? parseInt(nm[1], 10) : NaN
      const s = mergedShots.find((x) => x.no === no)
      // 场景图描述只含场景信息（地点/时间/氛围），不夹带人物动作/对白等
      setDesc(s ? sceneDesc(s) : val)
    } else if (category === '道具') {
      // 道具描述查道具表（此前错查人物表导致道具提示词只剩名词）
      setDesc(propDescs[val] || val)
    } else {
      setDesc(charDescs[val] || val)
    }
  }

  // 手动添加对象（空值校验：为空点添加 → 警告）
  const addManual = () => {
    const v = manualInput.trim()
    if (!v) {
      setErrMsg('请输入要添加的实体名称，内容不能为空')
      return
    }
    setErrMsg('')
    setManualItems((prev) => [...prev, v])
    setManualInput('')
    setSelected(v)
    setDesc(v)
    patchObject(id, { purpose: category, title: `${category}·${v}` })
  }

  // ── AI 重写描述（非空校验：需求为空点重写 → 警告）────────
  const rewrite = async () => {
    if (!desc.trim() || rewriting) return
    if (!rewriteReq.trim()) {
      setErrMsg('请先输入重写要求（如：人物三视图），内容不能为空')
      return
    }
    setErrMsg('')
    setRewriting(true)
    try {
      const req = [
        `【现有描述】\n${desc.trim()}`,
        `【重写要求】${rewriteReq.trim()}`,
      ].join('\n')
      const res = await aiChat({
        system:
          '你是角色/道具/场景描述专家。根据现有描述与要求重写一段用于 AI 生图的详细描述（人物可含外貌/服装/表情/三视图等），直接输出结果，不要解释。',
        user: req,
        profile_id: aiProfileId || undefined,
        scenario: 'general',
      })
      const out = res.ok ? String((res.data as AnyObj)?.result ?? '') : `重写失败：${JSON.stringify((res.data as AnyObj)?.error ?? '')}`
      setDesc(out)
      patchObject(id, { desc: out })
      setRewriteReq('')
    } catch (e) {
      setErrMsg('AI 重写失败，请检查模型配置或网络后重试')
      setErrDetail(String(e))
    } finally {
      setRewriting(false)
    }
  }

  // ── 生成：云端 / ComfyUI ────────────────────────────────
  const genPrompt = useMemo(() => {
    const parts: string[] = []
    const existing = String(payload.prompt ?? '').trim()
    if (existing && existing !== desc.trim()) parts.push(`【现有提示词】\n${existing}`)
    if (selected) parts.push(`【生成目标】${category} · ${selected}`)
    if (desc.trim()) parts.push(`【对象描述】\n${desc.trim()}`)
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
  }, [selected, category, desc, skillId, kbId, skills, kbs, payload])

  const generate = async () => {
    if (!genPrompt.trim() || generating) return
    setGenerating(true)
    setErrMsg('')
    try {
      // 角色锁定参考源：只取与当前类别相同的参考图（场景图不注入人物/道具图）
      const refs = objects
        .filter((o) => {
          const p = (o?.data as AnyObj)?.payload as AnyObj | undefined
          if (!p || p.locked_ref !== true) return false
          if (!String(p.url || p.main_image || '').trim()) return false
          return category ? String(p.purpose ?? '') === category : true
        })
        .map((o) => {
          const p = (o?.data as AnyObj)?.payload as AnyObj
          return String(p.url || p.main_image || '')
        })
        .filter(Boolean)
      const ids = mode === 'cloud' ? (cloudModelId ? [cloudModelId] : ['']) : ['']
      let lastErr = ''
      for (const pid of ids) {
        const res = await renderMedia({
          kind: 'image',
          render_mode: mode,
          profile_id: mode === 'cloud' ? pid : undefined,
          renderer_id: mode === 'comfyui' ? rendererId : undefined,
          params: {
            prompt: genPrompt.trim(),
            size: calcImageSize(resolution, ratio),
            negative: String(payload.negative_prompt ?? '').trim(),
            ...(mode === 'comfyui' && checkpoint ? { checkpoint } : {}),
            ...(mode === 'cloud' && refs.length ? { reference_images: refs } : {}),
          },
        })
        const d = res.data as AnyObj
        const imgs = (d?.images as { url?: string }[] | undefined) || []
        const url = String(imgs?.[0]?.url || d?.url || d?.result || '')
        if (res.ok && url) {
          patchObject(id, {
            url,
            prompt: genPrompt.trim(),
            render_mode: mode,
            gen_profile_id: mode === 'cloud' ? cloudModelId : '',
            renderer_id: rendererId,
            checkpoint: mode === 'comfyui' ? checkpoint : '',
            skill_ref: skillId,
            kb_ref: kbId,
            resolution,
            ratio,
            size: calcImageSize(resolution, ratio), // 写回尺寸：节点卡片「生成图片」按钮（后端 generate_node_image）读 data.size
            purpose: category, // 🔴 统一写 purpose（废弃 category 双字段），后端参考图按 purpose 匹配
            selected,
            desc,
          })
          setErrMsg('')
          return
        }
        lastErr = String(d?.error || d?.message || '未知错误')
        const logs = (d?.logs as { message?: string }[] | undefined) || []
        if (logs.length) lastErr += `｜${logs[logs.length - 1]?.message ?? ''}`
      }
      setErrMsg('生成失败，请检查所选模型/网络配置后重试')
      setErrDetail(lastErr)
    } catch (e) {
      setErrMsg('生成异常，请稍后重试')
      setErrDetail(String(e))
    } finally {
      setGenerating(false)
    }
  }

  // 结果操作
  const download = () => {
    if (!imageUrl) return
    const a = document.createElement('a')
    a.href = imageUrl
    a.download = 'lumiweave-image.png'
    a.target = '_blank'
    a.click()
  }

  // ── 顶部图标工具栏（界面重构：全面图标化）──────────────────
  const toolBtn = (active: boolean) =>
    `nodrag flex h-8 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] transition ${
      active ? 'bg-brand-600 text-white' : 'bg-soft text-ink-2 hover:bg-hover hover:text-ink'
    }`
  const tools: { key: typeof drawer; icon: React.ReactNode; label: string; title: string }[] = [
    { key: 'model', icon: <Settings2 size={14} />, label: '模型', title: '模型选择' },
    { key: 'size', icon: <Frame size={14} />, label: '尺寸', title: '分辨率与宽高比' },
    { key: 'mode', icon: <Cloud size={14} />, label: '生成方式', title: '云端 / ComfyUI' },
    { key: 'skill', icon: <Library size={14} />, label: '技能库', title: '技能 / 知识库参考' },
    { key: 'polish', icon: <Sparkles size={14} />, label: '润色', title: 'AI 润色提示词' },
    { key: 'rewrite', icon: <Wand2 size={14} />, label: '重写', title: 'AI 重写描述' },
    { key: 'entity', icon: <Users size={14} />, label: '实体', title: '人物/道具/场景关联' },
  ]

  // 模型库图像模型（显示 scene_models.image，非文本主模型名）
  const imageModels = profiles.filter((p) => fitsCapability(p, 'image'))
  const cloudModelLabel = useMemo(() => {
    const hit = imageModels.find((p) => p.id === cloudModelId)
    if (!hit) return '未选'
    const sm = (hit as AnyObj)?.scene_models as AnyObj | undefined
    return String((sm && typeof sm === 'object' ? sm.image : '') ?? '') || String(hit.model ?? '')
  }, [imageModels, cloudModelId])

  const inputCls = 'nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500'

  return (
    <div className="flex flex-col gap-2 nowheel">
      {/* 生成结果 + 操作 */}
      {imageUrl && (
        <div className="relative overflow-hidden rounded-lg border border-edge bg-black/30">
          <img src={imageUrl} alt="生成结果" className="max-h-44 w-full cursor-zoom-in object-contain" onClick={() => openLightbox(imageUrl)} />
          <div className="absolute right-1 top-1 flex gap-1">
            <button className="nodrag rounded bg-black/60 p-1 text-white hover:bg-black/80" title="放大" onClick={() => openLightbox(imageUrl)}>
              <ZoomIn size={13} />
            </button>
            <button className="nodrag rounded bg-black/60 p-1 text-white hover:bg-black/80" title="下载" onClick={download}>
              <Download size={13} />
            </button>
            <button className="nodrag rounded bg-black/60 p-1 text-white hover:bg-black/80" title="图像编辑" onClick={() => setEditOpen(true)}>
              <Paintbrush size={13} />
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

      {/* 常显文本框 1：描述 / 内容编辑框 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-ink-3">
            描述 / 内容{selected ? ` · ${category}·${selected}` : ''}
          </span>
          {storyObj && (
            <span className="text-[10px] text-brand-300">
              已识别 {script ? Object.keys(charDescs).length : parsed.characters.length} 人物 / {script ? propList.length : parsed.props.length} 道具 / {mergedShots.length} 分镜
            </span>
          )}
        </div>
        <textarea
          className={inputCls}
          rows={Math.min(30, Math.max(3, desc.split('\n').length))}
          value={desc}
          disabled={locked}
          placeholder="描述 / 内容（选中实体或手动输入后，AI 据此生成提示词）"
          onChange={(e) => setDesc(e.target.value)}
        />
      </div>

      {/* 常显文本框 2：提示词（AI 出图用，可校对修改） */}
      <div className="space-y-1">
        <span className="text-[11px] text-ink-3">提示词（AI 出图用，可校对修改）</span>
        <textarea
          className={inputCls}
          rows={Math.min(30, Math.max(2, String(payload.prompt ?? '').split('\n').length))}
          value={String(payload.prompt ?? '')}
          disabled={locked}
          placeholder="在此校对/修改出图提示词…"
          onChange={(e) => patchObject(id, { prompt: e.target.value })}
        />
      </div>

      {/* 负面提示词（不希望出现的元素） */}
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

      {/* 底部 🚀 激活生成图片 大按钮 */}
      <button
        className="nodrag flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
        disabled={locked || generating || !genPrompt.trim()}
        onClick={() => void generate()}
      >
        {generating ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        {generating ? '生成中…' : '🚀 激活生成图片'}
      </button>

      {editOpen && imageUrl && (
        <SceneImageEdit
          src={imageUrl}
          onClose={() => setEditOpen(false)}
          onSaved={(url) => { patchObject(id, { url }); setEditOpen(false) }}
        />
      )}

      {/* ── ⚙️ 模型选择抽屉 ── */}
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
          <span className="text-[11px] text-ink-3">出图模型（模型库）</span>
          <select
            className="nodrag h-8 w-full rounded-md border border-edge bg-input px-1 text-sm text-ink outline-none focus:border-brand-500"
            value={cloudModelId}
            disabled={locked}
            onChange={(e) => { setCloudModelId(e.target.value); patchObject(id, { gen_profile_id: e.target.value }) }}
            title="选择模型库中的出图模型"
          >
            <option value="">默认模型（系统自动选）</option>
            {imageModels.map((p) => {
              const sm = (p as AnyObj)?.scene_models as AnyObj | undefined
              const imgModel = String((sm && typeof sm === 'object' ? sm.image : '') ?? '') || String(p.model ?? '')
              return p && p.id ? (
                <option key={p.id} value={p.id}>
                  {String(p.name ?? p.id)}
                  {imgModel ? ` · ${imgModel}` : ''}
                </option>
              ) : null
            })}
          </select>
          <div className="text-[10px] leading-snug text-ink-3">
            在「设置-模型」中添加出图模型（如硅基流动 Qwen-Image），即可在此选择。选「默认模型」时由系统智能路由自动选路。
          </div>
          {cloudModelId && <div className="rounded bg-soft px-2 py-1 text-[10px] text-ink-2">当前：{cloudModelLabel}</div>}
        </div>
      </LockedDrawer>

      {/* ── 📐 尺寸与分辨率弹窗 ── */}
      <LockedModal
        open={drawer === 'size'}
        onClose={closeDrawer}
        title="📐 尺寸与分辨率"
        footer={
          <button className="nodrag flex h-9 w-full items-center justify-center rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500" onClick={closeDrawer}>
            确定
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">分辨率</span>
            <select
              className="nodrag h-8 w-full rounded-md border border-edge bg-input px-1 text-sm text-ink outline-none focus:border-brand-500"
              value={RES_OPTS_IMG.includes(resolution) ? resolution : ''}
              disabled={locked}
              onChange={(e) => { setResolution(e.target.value); patchObject(id, { resolution: e.target.value }) }}
            >
              {RES_OPTS_IMG.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">宽高比</span>
            <select
              className="nodrag h-8 w-full rounded-md border border-edge bg-input px-1 text-sm text-ink outline-none focus:border-brand-500"
              value={RATIO_OPTS_IMG.includes(ratio) ? ratio : ''}
              disabled={locked}
              onChange={(e) => { setRatio(e.target.value); patchObject(id, { ratio: e.target.value }) }}
            >
              {RATIO_OPTS_IMG.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="rounded bg-soft px-2 py-1.5 text-[10px] text-ink-3">
          生成尺寸 = 短边按分辨率 × 宽高比 计算（如 1K×16:9 = 1792x1024，自动取 8 的倍数）
        </div>
      </LockedModal>

      {/* ── ☁️ 生成方式弹窗 ── */}
      <LockedModal
        open={drawer === 'mode'}
        onClose={closeDrawer}
        title="☁️ 生成方式"
        footer={
          <button className="nodrag flex h-9 w-full items-center justify-center rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500" onClick={closeDrawer}>
            确定
          </button>
        }
      >
        <div className="space-y-2">
          <div className="flex gap-1">
            <button
              className={`nodrag flex-1 rounded-md py-1.5 text-[11px] transition ${mode === 'cloud' ? 'bg-brand-600 text-white' : 'bg-soft text-ink-2'}`}
              onClick={() => { setMode('cloud'); patchObject(id, { render_mode: 'cloud' }) }}
            >
              云端 API
            </button>
            <button
              className={`nodrag flex-1 rounded-md py-1.5 text-[11px] transition ${mode === 'comfyui' ? 'bg-brand-600 text-white' : 'bg-soft text-ink-2'}`}
              onClick={() => { setMode('comfyui'); patchObject(id, { render_mode: 'comfyui' }) }}
            >
              ComfyUI
            </button>
          </div>

          {mode === 'cloud' ? (
            <div className="text-[11px] leading-snug text-ink-3">
              云端出图：模型在「⚙️ 模型选择」里配置；未选时系统自动优选可用接口（质量/速度/成本评分）。
            </div>
          ) : (
            <div className="space-y-2">
              <select
                className="nodrag h-8 w-full rounded-md border border-edge bg-input px-1 text-sm text-ink outline-none focus:border-brand-500"
                value={rendererId}
                onChange={(e) => { setRendererId(e.target.value); patchObject(id, { renderer_id: e.target.value }) }}
              >
                <option value="">选择 ComfyUI 渲染器（本地局域网/远程）</option>
                {renderers.map((r) => (
                  <option key={String(r.id)} value={String(r.id)}>{String(r.name || r.id)}</option>
                ))}
              </select>
              <input
                className="nodrag h-8 w-full rounded-md border border-edge bg-input px-1 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
                list={`chk-${id}`}
                placeholder="Checkpoint 模型（可下拉或手输）"
                value={checkpoint}
                onChange={(e) => { setCheckpoint(e.target.value); patchObject(id, { checkpoint: e.target.value }) }}
              />
              <datalist id={`chk-${id}`}>
                {checkpoints.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          )}
        </div>
      </LockedModal>

      {/* ── 📚 技能与知识库抽屉 ── */}
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
            <span className="mb-1 block text-[11px] text-ink-3">技能库（内容注入生成提示词）</span>
            <SkillPicker
              value={skillId}
              skills={skills}
              disabled={locked}
              onChange={(v) => { setSkillId(v); patchObject(id, { skill_ref: v }) }}
              placeholder="不引用技能"
              className="h-8"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">知识库（内容注入生成提示词）</span>
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

      {/* ── ✨ AI 润色抽屉（非空校验）── */}
      <LockedDrawer
        open={drawer === 'polish'}
        onClose={closeDrawer}
        title="✨ AI 润色提示词"
        footer={
          <button className="nodrag flex h-9 w-full items-center justify-center rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500" onClick={closeDrawer}>
            完成
          </button>
        }
      >
        <div className="text-[11px] text-ink-3">优化当前提示词（基于下方描述/内容，可直接使用）</div>
        <AiOptimizeBar
          id={id}
          target="prompt"
          label="润色"
          disabled={locked}
          requireInput
          quickReqs={['三视图', '细节特写', '多角度', '环境融入', '表情夸张', '写实风格']}
          quickTemplates={{
            '三视图': '角色（或物体）三视图/多角度同图，正面/侧面/背面依次排列，纯色背景，全身展示',
            '细节特写': '局部细节特写，如面部/手部/服饰纹理/材质放大，浅景深微距质感',
            '多角度': '多角度视图同图展示，正面/侧面/背面/顶部多视角并排，便于全面展示对象',
            '环境融入': '补充场景环境、光影与氛围描述，主体与环境自然融合',
            '表情夸张': '夸张生动的面部表情，情绪张力强，戏剧化表演感',
            '写实风格': '写实摄影风格，真实光影与材质，胶片质感，高细节，贴近真实世界',
          }}
          system={
            '你是角色/道具/场景生图提示词专家。把现有提示词优化成可直接用于图像生成模型的高质量中文提示词：画面具体、含光线构图与质感描述、符合所选对象用途。' +
            '若用户要求"三视图/多角度"：输出"角色（或物体）三视图/多角度同图，正面/侧面/背面依次排列，纯色背景，全身展示"；' +
            '若要求"细节特写"：输出"局部细节特写，如面部/手部/服饰纹理/材质放大，浅景深微距质感"；' +
            '若要求"环境融入"：补充场景环境、光影与氛围描述。只输出优化后的提示词，不要多余解释。'
          }
          getContext={() => {
            const parts: string[] = []
            if (selected) parts.push(`【对象】${category} · ${selected}`)
            if (desc.trim()) parts.push(`【对象描述】\n${desc.trim()}`)
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
            return parts.join('\n')
          }}
        />
      </LockedDrawer>

      {/* ── ✍️ AI 重写抽屉（非空校验）── */}
      <LockedDrawer
        open={drawer === 'rewrite'}
        onClose={closeDrawer}
        title="✍️ AI 重写描述"
        footer={
          <button className="nodrag flex h-9 w-full items-center justify-center rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500" onClick={closeDrawer}>
            完成
          </button>
        }
      >
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">重写模型</span>
            <select
              className="nodrag h-8 w-full rounded-md border border-edge bg-input px-1 text-sm text-ink outline-none focus:border-brand-500"
              value={aiProfileId}
              disabled={locked || rewriting}
              onChange={(e) => { setAiProfileId(e.target.value); patchObject(id, { profile_id: e.target.value }) }}
              title="AI 重写使用的模型"
            >
              <option value="">默认模型</option>
              {profiles.filter((p) => fitsLlm(p)).map((p) =>
                p && p.id ? (
                  <option key={p.id} value={p.id}>
                    {String(p.name ?? p.id)}
                    {p.model ? ` · ${p.model}` : ''}
                  </option>
                ) : null,
              )}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">重写要求（必填，如：人物三视图）</span>
            <input
              className="nodrag h-8 w-full rounded-md border border-edge bg-input px-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
              placeholder="输入重写要求，内容不能为空…"
              value={rewriteReq}
              disabled={locked || rewriting}
              onChange={(e) => setRewriteReq(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void rewrite()
                }
              }}
            />
          </label>
          <button
            className="nodrag flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500 disabled:opacity-50"
            disabled={locked || rewriting || !desc.trim()}
            onClick={() => void rewrite()}
          >
            {rewriting ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {rewriting ? '重写中…' : '重写'}
          </button>
          <div className="text-[10px] leading-snug text-ink-3">重写结果写回上方「描述 / 内容」编辑框，可继续校对。</div>
        </div>
      </LockedDrawer>

      {/* ── 👤 实体关联底部抽屉（人物/道具/场景识别 + 手动添加）── */}
      <LockedDrawer
        open={drawer === 'entity'}
        onClose={closeDrawer}
        title="👤 实体关联"
        side="bottom"
        footer={
          <button className="nodrag flex h-9 w-full items-center justify-center rounded-lg bg-brand-600 text-sm text-white transition hover:bg-brand-500" onClick={closeDrawer}>
            完成
          </button>
        }
      >
        <div className="space-y-2">
          <div className="flex gap-1.5">
            {(['人物', '道具', '场景'] as const).map((c) => {
              const cnt = c === '人物'
                ? script ? Object.keys(charDescs).length : parsed.characters.length
                : c === '道具'
                  ? script ? propList.length : parsed.props.length
                  : mergedShots.length
              return (
                <button
                  key={c}
                  className={`nodrag flex h-7 flex-1 items-center justify-center gap-1 rounded-md text-[11px] transition ${
                    category === c ? 'bg-brand-600 text-white' : 'bg-soft text-ink-2 hover:text-ink'
                  }`}
                  disabled={locked}
                  onClick={() => switchCategory(c)}
                >
                  {c}
                  <span className="text-[10px] opacity-70">{cnt}</span>
                </button>
              )
            })}
          </div>

          {options.length > 0 ? (
            <select
              className="nodrag h-8 w-full rounded-md border border-edge bg-input px-1.5 text-sm text-ink outline-none focus:border-brand-500"
              value={selected}
              disabled={locked}
              onChange={(e) => pickOption(e.target.value)}
            >
              <option value="">选择{category}…</option>
              {options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <div className="rounded bg-soft px-2 py-1.5 text-[11px] text-ink-3">
              暂无识别到{category}，可在下方手动添加
            </div>
          )}

          {/* 手动添加（空值校验） */}
          <div className="flex items-center gap-1.5">
            <input
              className="nodrag h-8 min-w-0 flex-1 rounded-md border border-edge bg-input px-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
              placeholder={`手动添加${category}名…（内容不能为空）`}
              value={manualInput}
              disabled={locked}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  addManual()
                }
              }}
            />
            <button
              className="nodrag flex h-8 shrink-0 items-center rounded-md bg-soft px-2.5 text-sm text-ink-2 transition hover:text-ink disabled:opacity-50"
              disabled={locked || !manualInput.trim()}
              onClick={addManual}
            >
              + 添加
            </button>
          </div>
          <div className="text-[10px] leading-snug text-ink-3">
            选中实体后自动提取描述填入「描述 / 内容」框（场景为纯场景描述）；无剧本时也可手动添加。
          </div>
        </div>
      </LockedDrawer>
    </div>
  )
}
