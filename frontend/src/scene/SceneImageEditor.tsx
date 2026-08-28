// SceneImageEditor —— 图片节点全面板（V2.7）
// 连线剧情节点后：识别 人物/道具/场景 → 列表选择 → 描述自动提取（可手改/AI 重写带要求）
// + 技能库/知识库参考注入 + 云端 API / ComfyUI（本地局域网或远程）生成
// + 生成结果：点击放大 / 下载 / 图像基础编辑（旋转/亮度/对比度/黑白/裁剪）
import { useEffect, useMemo, useState } from 'react'
import {
  Loader2, Wand2, ZoomIn, Download, Paintbrush, Send,
} from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { useUiStore } from '../store/uiStore'
import {
  aiChat, getProfiles, getRenderers, getRendererWorkflows,
  getSkills, promptLearningList, renderMedia,
} from '../api'
import SceneImageEdit from './SceneImageEdit'
import AiOptimizeBar from './AiOptimizeBar'
import ErrorBanner from '../components/ErrorBanner'
import {
  type AnyObj, type ParsedScript, EMPTY_PARSED, isStoryNode,
  parseCharacters, parsePropsList, parseShotsFromScript, shotDesc,
} from './sceneScript'

type Category = '人物' | '道具' | '场景'


/** 模型库「适用场景」匹配：未设场景=通用，或含 general/目标场景 */
function fitsScene(p: { scenes?: string[] }, need: string): boolean {
  const s = p.scenes
  if (!s || !s.length) return true
  return s.includes('general') || s.includes(need)
}

// ── 分辨率 / 宽高比（V2.8）────────────────────────────────────────
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

  // ── 连线剧情节点：读剧本 + 解析数据（兼容新拖入 type='sceneObject' 的节点）──
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
  const propList = useMemo(() => parsePropsList(script), [script])
  // 分镜：优先前端实时解析（完整+括号不截断），无剧本才回退后端 parsed
  const mergedShots = useMemo(() => {
    if (script) return parseShotsFromScript(script)
    return parsed.shots || []
  }, [parsed, script])

  // ── 面板状态 ────────────────────────────────────────────────
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

  // 生成方式：云端=模型库选模型（直连，不用商业接口）；ComfyUI=选渲染器
  const [mode, setMode] = useState<'cloud' | 'comfyui'>(String(payload.render_mode ?? 'cloud') === 'comfyui' ? 'comfyui' : 'cloud')
  const [cloudModelId, setCloudModelId] = useState(String(payload.gen_profile_id ?? payload.profile_id ?? ''))
  // 分辨率 / 宽高比（V2.8：生成尺寸由短边×比例计算）
  const [resolution, setResolution] = useState(String(payload.resolution || '1K'))
  const [ratio, setRatio] = useState(String(payload.ratio || '1:1'))
  const [renderers, setRenderers] = useState<AnyObj[]>([])
  const [rendererId, setRendererId] = useState(String(payload.renderer_id ?? ''))
  const [checkpoints, setCheckpoints] = useState<string[]>([])
  const [checkpoint, setCheckpoint] = useState(String(payload.checkpoint ?? ''))
  const [generating, setGenerating] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  // ── 选项列表：只用前端实时解析（干净，过滤后端脏数据）；无剧本回退 parsed；加手动项 ──
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

  // 类别切换 → 重置选中与描述
  const switchCategory = (c: Category) => {
    setCategory(c)
    setSelected('')
    setDesc('')
  }

  // 选中对象 → 提取描述 + 标题自动识别为选中对象
  const pickOption = (val: string) => {
    setSelected(val)
    patchObject(id, { purpose: category, title: `${category}·${val}` })
    if (category === '场景') {
      const nm = val.match(/^分镜(\d+)/)
      const no = nm ? parseInt(nm[1], 10) : NaN
      const s = mergedShots.find((x) => x.no === no)
      setDesc(s ? shotDesc(s) : val)
    } else {
      setDesc(charDescs[val] || val)
    }
  }

  // 手动添加对象（无剧本 / 剧本没识别到时直接手选）
  const addManual = () => {
    const v = manualInput.trim()
    if (!v) return
    setManualItems((prev) => [...prev, v])
    setManualInput('')
    setSelected(v)
    setDesc(v)
    patchObject(id, { purpose: category, title: `${category}·${v}` })
  }

  // ── 数据加载 ────────────────────────────────────────────────
  // 数据加载
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
    // 知识库
    promptLearningList()
      .then((r) => {
        const k = ((r.data as AnyObj)?.knowledge as AnyObj[]) || []
        setKbs(k)
      })
      .catch(() => {})
    // ComfyUI 渲染器
    getRenderers()
      .then((r) => {
        const all = ((r.data as AnyObj)?.renderers as AnyObj[]) || (r.data as AnyObj[]) || []
        const list = all.filter((p) => String(p.type ?? '').includes('comfyui') && p.status !== 'disabled')
        setRenderers(list.length ? list : all)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 恢复已保存的面板状态（刷新/重开节点后）；兼容导演台骨架节点（purpose→category、prompt→desc 兜底）
  useEffect(() => {
    if (payload.category) setCategory(String(payload.category) as Category)
    else if (payload.purpose) setCategory(String(payload.purpose) as Category)
    if (payload.selected) setSelected(String(payload.selected))
    if (payload.desc) setDesc(String(payload.desc))
    else if (payload.prompt) setDesc(String(payload.prompt))
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

  // ── AI 重写描述（可输入要求，如"人物三视图"）─────────────────
  const rewrite = async () => {
    if (!desc.trim() || rewriting) return
    setRewriting(true)
    try {
      const req = [
        `【现有描述】\n${desc.trim()}`,
        rewriteReq.trim() ? `【重写要求】${rewriteReq.trim()}` : '【重写要求】优化表达，更具体生动，适合作为生图提示词',
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
      patchObject(id, { desc: out }) // 持久化，避免刷新丢失
      setRewriteReq('')
    } catch (e) {
      setErrMsg('AI 重写失败，请检查模型配置或网络后重试')
      setErrDetail(String(e))
    } finally {
      setRewriting(false)
    }
  }

  // ── 生成：云端 / ComfyUI ────────────────────────────────────
  const genPrompt = useMemo(() => {
    const parts: string[] = []
    // 节点已有提示词（含导演台骨架节点）：优先作为基础，避免重新生成时丢失原提示词
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
      // 角色锁定参考源（V2.8）：收集场景内 locked_ref 图片作为参考图，跨分镜保持一致性
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
      // 云端：优先模型库直连（profile_id）；未选则智能路由（兼容旧数据）
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
            category,
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

  const catBtn = (c: Category) => (
    <button
      key={c}
      className={`nodrag flex h-7 flex-1 items-center justify-center gap-1 rounded-md text-[11px] transition ${
        category === c ? 'bg-brand-600 text-white' : 'bg-soft text-ink-2 hover:text-ink'
      }`}
      disabled={locked}
      onClick={() => switchCategory(c)}
    >
      {c}
      <span className="text-[10px] opacity-70">
        {c === '人物' ? parsed.characters.length : c === '道具' ? parsed.props.length : parsed.shots.length}
      </span>
    </button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto nowheel">
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

      {/* AI 润色（V2.8.1 全局修复：独立模型选择 + 用户要求输入，不依赖是否选中对象） */}
      <div className="space-y-1.5 rounded-lg border border-edge p-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-ink-3">✨ AI 润色（优化生成提示词）</span>
          {!String(payload.prompt ?? '').trim() && (
            <span className="text-[10px] text-ink-3">提示词为空时，将基于下方对象描述生成</span>
          )}
        </div>
        <AiOptimizeBar
          id={id}
          target="prompt"
          label="润色"
          disabled={locked}
          quickReqs={['三视图', '细节特写', '多角度', '环境融入', '表情夸张']}
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
      </div>

      {/* 类型识别：始终显示，连剧情自动识别，也可手动选择 */}
      <div className="flex gap-1.5">{catBtn('人物')}{catBtn('道具')}{catBtn('场景')}</div>

      {/* 列表选择 + 描述 */}
      <div className="space-y-1.5">
        {storyObj ? (
          <div className="rounded-lg border border-brand-500/30 bg-brand-500/5 px-2 py-1.5 text-[11px] leading-snug text-brand-300">
            已连线剧情节点：自动识别 人物 {script ? Object.keys(charDescs).length : parsed.characters.length} / 道具 {script ? propList.length : parsed.props.length} / 分镜 {mergedShots.length}，选中后自动提取描述
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-edge px-2 py-1.5 text-[11px] text-ink-3">
            未连线剧情节点：可手动选择/添加对象；连线剧情后自动识别人物/道具/场景
          </div>
        )}
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

        {/* 手动添加 */}
        <div className="flex items-center gap-1.5">
          <input
            className="nodrag h-8 min-w-0 flex-1 rounded-md border border-edge bg-input px-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
            placeholder={`手动添加${category}名…`}
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
            className="nodrag flex h-8 shrink-0 items-center rounded-md bg-soft px-2.5 text-sm text-ink-2 transition hover:text-ink"
            disabled={locked || !manualInput.trim()}
            onClick={addManual}
          >
            + 添加
          </button>
        </div>

        {selected && (
            <>
              <textarea
                className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
                rows={Math.min(6, Math.max(3, desc.split('\n').length))}
                value={desc}
                disabled={locked}
                onChange={(e) => setDesc(e.target.value)}
              />
              {/* 提示词：直接校对/修改（导演台骨架节点 prompt 在此显示） */}
              <label className="block">
                <span className="mb-0.5 block text-[10px] text-ink-3">提示词（AI 出图用，可校对修改）</span>
                <textarea
                  className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-[11px] leading-relaxed text-ink outline-none focus:border-brand-500"
                  rows={Math.min(5, Math.max(2, String(payload.prompt ?? '').split('\n').length))}
                  value={String(payload.prompt ?? '')}
                  disabled={locked}
                  placeholder="在此校对/修改出图提示词…"
                  onChange={(e) => patchObject(id, { prompt: e.target.value })}
                />
              </label>
              {/* AI 重写：模型选择 + 可输入要求 */}
              <div className="space-y-1.5">
                <select
                  className="nodrag h-7 w-full rounded-md border border-edge bg-input px-1 text-[11px] text-ink outline-none focus:border-brand-500"
                  value={aiProfileId}
                  disabled={locked || rewriting}
                  onChange={(e) => { setAiProfileId(e.target.value); patchObject(id, { profile_id: e.target.value }) }}
                  title="AI 重写使用的模型"
                >
                  <option value="">默认模型</option>
                  {profiles.filter((p) => fitsScene(p, 'prompt')).map((p) =>
                    p && p.id ? (
                      <option key={p.id} value={p.id}>
                        {String(p.name ?? p.id)}
                        {p.model ? ` · ${p.model}` : ''}
                      </option>
                    ) : null,
                  )}
                </select>
                <div className="flex items-center gap-1.5">
                  <input
                    className="nodrag h-8 min-w-0 flex-1 rounded-md border border-edge bg-input px-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
                    placeholder="AI 重写要求，如：人物三视图"
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
                  <button
                    className="nodrag flex h-8 shrink-0 items-center gap-1 rounded-md bg-soft px-2.5 text-sm text-ink-2 transition hover:text-ink disabled:opacity-50"
                    disabled={locked || rewriting || !desc.trim()}
                    onClick={() => void rewrite()}
                  >
                    {rewriting ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                    重写
                  </button>
                </div>
              </div>
            </>
          )}
      </div>

      {/* 技能库 / 知识库参考 */}
      <div className="grid grid-cols-2 gap-1.5">
        <select
          className="nodrag h-8 min-w-0 rounded-md border border-edge bg-input px-1 text-sm text-ink outline-none focus:border-brand-500"
          value={skillId}
          disabled={locked}
          onChange={(e) => { setSkillId(e.target.value); patchObject(id, { skill_ref: e.target.value }) }}
          title="技能库：选中后内容注入生成提示词"
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
          title="知识库：选中后内容注入生成提示词"
        >
          <option value="">知识库</option>
          {kbs.map((k) => (
            <option key={String(k.id)} value={String(k.id)}>{String(k.title || k.id)}</option>
          ))}
        </select>
      </div>

      {/* 生成方式：mt-auto 贴底，避免节点拉大后下方空白 */}
      <div className="mt-auto space-y-1.5 rounded-lg border border-edge p-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-ink-3">生成方式</span>
          <div className="flex flex-1 gap-1">
            <button
              className={`nodrag flex-1 rounded-md py-1 text-[11px] transition ${mode === 'cloud' ? 'bg-brand-600 text-white' : 'bg-soft text-ink-2'}`}
              onClick={() => setMode('cloud')}
            >
              云端 API
            </button>
            <button
              className={`nodrag flex-1 rounded-md py-1 text-[11px] transition ${mode === 'comfyui' ? 'bg-brand-600 text-white' : 'bg-soft text-ink-2'}`}
              onClick={() => setMode('comfyui')}
            >
              ComfyUI
            </button>
          </div>
        </div>

        {/* 分辨率 / 宽高比（V2.8） */}
        <div className="grid grid-cols-2 gap-1.5">
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">分辨率</span>
            <select
              className="nodrag h-7 w-full rounded-md border border-edge bg-input px-1 text-[11px] text-ink outline-none focus:border-brand-500"
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
              className="nodrag h-7 w-full rounded-md border border-edge bg-input px-1 text-[11px] text-ink outline-none focus:border-brand-500"
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

        {mode === 'cloud' ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-[11px] text-ink-3">模型</span>
              <select
                className="nodrag h-7 min-w-0 flex-1 rounded-md border border-edge bg-input px-1 text-[11px] text-ink outline-none focus:border-brand-500"
                value={cloudModelId}
                disabled={locked}
                onChange={(e) => { setCloudModelId(e.target.value); patchObject(id, { gen_profile_id: e.target.value }) }}
                title="选择模型库中的模型（直连，不使用商业接口预设）"
              >
                <option value="">默认模型（系统自动选）</option>
                {profiles.filter((p) => fitsScene(p, 'image')).map((p) =>
                  p && p.id ? (
                    <option key={p.id} value={p.id}>
                      {String(p.name ?? p.id)}
                      {p.model ? ` · ${p.model}` : ''}
                    </option>
                  ) : null,
                )}
              </select>
            </div>
            <div className="text-[10px] leading-snug text-ink-3">
              在「设置-模型」中添加出图模型（如硅基流动 Qwen-Image），即可在此选择
            </div>
          </>
        ) : (
          <>
            <select
              className="nodrag h-7 w-full rounded-md border border-edge bg-input px-1 text-[11px] text-ink outline-none focus:border-brand-500"
              value={rendererId}
              onChange={(e) => { setRendererId(e.target.value); patchObject(id, { renderer_id: e.target.value }) }}
            >
              <option value="">选择 ComfyUI 渲染器（本地局域网/远程）</option>
              {renderers.map((r) => (
                <option key={String(r.id)} value={String(r.id)}>{String(r.name || r.id)}</option>
              ))}
            </select>
            <input
              className="nodrag h-7 w-full rounded-md border border-edge bg-input px-1 text-[11px] text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
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
          </>
        )}

        <button
          className="nodrag flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 text-sm text-white transition hover:bg-brand-500 disabled:opacity-50"
          disabled={locked || generating || !genPrompt.trim()}
          onClick={() => void generate()}
        >
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {generating ? '生成中…' : '生成图片'}
        </button>
        {errMsg && <ErrorBanner message={errMsg} detail={errDetail || undefined} />}
      </div>

      {editOpen && imageUrl && (
        <SceneImageEdit
          src={imageUrl}
          onClose={() => setEditOpen(false)}
          onSaved={(url) => { patchObject(id, { url }); setEditOpen(false) }}
        />
      )}
    </div>
  )
}
