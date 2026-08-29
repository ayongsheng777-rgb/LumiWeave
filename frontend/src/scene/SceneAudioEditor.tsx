// SceneAudioEditor —— 音频节点全面板（V2.7 → V2.9g 增强）
// 功能（三场景通用）：
//  1. 分镜/故事板双来源引入：连线剧情节点（剧本分镜 BGM）或 分镜脚本表（storyboard 对白/音效）
//  2. AI 识别建议（风格 + 乐器 + 提示词写回）
//  3. 风格预选菜单（可自定义）+ 乐器多选 chips（可追加自定义）
//  4. AI 优化联动风格/乐器，可再自定义要求
//  5. 播放预览（url 由生成/连线回填，不再手填）；去掉手填音频地址输入框
// 说明：后端暂无音乐合成 API，产出为「音乐描述/提示词」，真实音频需外部 Suno 类服务。
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Sparkles, Music2, Plus } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { getSkills, promptLearningList } from '../api'
import { type AnyObj, isStoryNode, parseShotsFromScript, type ParsedShot } from './sceneScript'
import ErrorBanner from '../components/ErrorBanner'
import AiOptimizeBar from './AiOptimizeBar'

const AUDIO_TYPE_OPTS = ['配音', 'BGM', '音效', '对白']

// 风格预选（可下拉选择或自定义输入）
const STYLE_PRESETS = [
  '史诗感', '悬疑紧张', '温馨治愈', '欢快活泼', '科幻未来', '古风雅韵',
  '轻松俏皮', '浪漫抒情', '奇幻冒险', '热血激昂', '空灵宁静', '街头嘻哈',
]

// 乐器预选（多选 chips + 可追加自定义）
const INSTRUMENT_PRESETS = [
  '钢琴', '小提琴', '大提琴', '吉他', '贝斯', '架子鼓', '电子合成器',
  '长笛', '萨克斯', '竖琴', '古筝', '琵琶', '竹笛', '二胡',
  '人声哼唱', '打击乐', '管弦乐组',
]

/** 把 storyboard 节点（分镜脚本表）的分镜转为 ParsedShot（供音频引用） */
function shotsFromStoryboard(raw: unknown): ParsedShot[] {
  const arr = Array.isArray(raw) ? raw : []
  return arr
    .filter((s) => s && typeof s === 'object')
    .map((s, i) => {
      const d = s as AnyObj
      const dialogue = Array.isArray(d.dialogue)
        ? d.dialogue.map((x: unknown) => {
            const dd = (x as AnyObj) || {}
            return { speaker: String(dd.speaker ?? dd.name ?? ''), emotion: String(dd.emotion ?? ''), line: String(dd.line ?? dd.content ?? '') }
          })
        : []
      const sfx: string[] = d.sound_effect ? [String(d.sound_effect)] : []
      return {
        no: Number(d.shot_no ?? d.no ?? i + 1),
        location: String(d.location ?? d.scene ?? ''),
        time: '',
        goal: String(d.description ?? d.goal ?? ''),
        mood: String(d.mood ?? ''),
        bgm: String(d.bgm ?? ''),
        body: String(d.body ?? ''),
        duration: String(d.duration ?? ''),
        shots: [],
        dialogue,
        sfx,
      } as ParsedShot
    })
}

export default function SceneAudioEditor({ id, locked }: { id: string; locked: boolean }) {
  const patchObject = useSceneStore((s) => s.patchObject)
  const runAction = useSceneStore((s) => s.runAction)
  const busy = useSceneStore((s) => s.busy)
  const objects = useSceneStore((s) => s.objects)
  const edges = useSceneStore((s) => s.edges)
  const obj = useSceneStore((s) => s.objects.find((o) => o.id === id))
  const payload = ((obj?.data as AnyObj)?.payload || {}) as AnyObj
  const audioUrl = String(payload.url ?? '')

  // ── 连线节点：优先剧情节点（剧本分镜），其次分镜脚本表 storyboard ──
  const linked = useMemo(() => {
    const ids = edges
      .map((e) => (e.source === id ? e.target : e.target === id ? e.source : ''))
      .filter((x) => !!x)
    const story = ids.map((x) => objects.find((o) => o.id === x)).find((o) => isStoryNode(o))
    const sb = ids
      .map((x) => objects.find((o) => o.id === x))
      .find((o) => o && String(((o.data as AnyObj)?.objectType) ?? '') === 'storyboard')
    const script = String(((story?.data as AnyObj)?.payload as AnyObj)?.script ?? '')
    const sbShots = sb ? shotsFromStoryboard(((sb.data as AnyObj)?.payload as AnyObj)?.shots) : []
    return {
      kind: (story || sb) ? (story ? 'story' : 'storyboard') : null,
      story,
      sb,
      shots: script ? parseShotsFromScript(script) : sbShots,
    }
  }, [edges, objects, id])
  const mergedShots = linked.shots
  const bgmShots = useMemo(() => mergedShots.filter((s) => String(s.bgm ?? '').trim() || s.dialogue.length || s.sfx.length), [mergedShots])

  // 🔴 配音稿节点（后端 generate_voiceover 建的 {text, voiceover:true}）默认应是「配音」，
  // 此前兜底 BGM 导致配音稿节点显示成 BGM 面板、正文 text 被藏起来
  const audioType = String(payload.audio_type ?? (payload.voiceover ? '配音' : 'BGM'))
  const shotNo = Number(payload.shot_no) || 0
  const currentShot = mergedShots.find((s) => s.no === shotNo)

  const [style, setStyle] = useState(String(payload.style ?? ''))
  // 乐器多选：chips 状态（顿号分隔字符串）
  const [instruments, setInstruments] = useState<string[]>(() => {
    const raw = String(payload.instruments ?? '')
    return raw ? raw.split(/[、,，]/).map((x) => x.trim()).filter(Boolean) : []
  })
  const [customInst, setCustomInst] = useState('')
  const [errMsg, setErrMsg] = useState('')

  // ── 技能库 / 知识库（全节点可调用：注入 AI 优化/识别建议上下文）──
  const [skills, setSkills] = useState<AnyObj[]>([])
  const [kbs, setKbs] = useState<AnyObj[]>([])
  const [skillId, setSkillId] = useState(String(payload.skill_ref ?? ''))
  const [kbId, setKbId] = useState(String(payload.kb_ref ?? ''))

  useEffect(() => {
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

  // ── 选分镜 → 按音频类型带出对应内容（BGM→背景音乐；配音/对白→对白；音效→音效）──
  const pickShot = (no: number) => {
    const s = mergedShots.find((x) => x.no === no)
    if (!s) return
    let desc: string
    if (linked.kind === 'storyboard') {
      desc = [
        s.bgm || s.location || `分镜${s.no}`,
        s.goal ? s.goal : '',
        s.dialogue.length ? `对白：${s.dialogue.map((d) => `${d.speaker}：${d.line}`).join('；')}` : '',
        s.sfx.length ? `音效：${s.sfx.join('、')}` : '',
      ].filter(Boolean).join('\n')
    } else if (audioType === '配音' || audioType === '对白') {
      desc = s.dialogue.length
        ? s.dialogue.map((d) => `${d.speaker}${d.emotion ? `（${d.emotion}）` : ''}：${d.line}`).join('\n')
        : String(s.bgm ?? '')
    } else if (audioType === '音效') {
      desc = s.sfx.length ? s.sfx.join('\n') : String(s.bgm ?? '')
    } else {
      desc = String(s.bgm ?? '')
    }
    // 配音/对白/音效写 text（正文框），BGM 写 desc（音乐描述框）
    if (audioType === 'BGM') patchObject(id, { shot_no: no ? String(no) : '', desc })
    else patchObject(id, { shot_no: no ? String(no) : '', text: desc })
  }

  // ── AI 识别建议（后端动作：分镜内容 → 风格/乐器/提示词写回）──
  const suggest = async () => {
    if (!shotNo || !currentShot) return
    setErrMsg('')
    await runAction('generate_music', [id], { shot_no: String(shotNo) })
    const o = useSceneStore.getState().objects.find((x) => x.id === id)
    const p = ((o?.data as AnyObj)?.payload as AnyObj) || {}
    if (!String(p.prompt ?? '').trim()) {
      setErrMsg('未生成音乐提示词，请检查剧情节点是否已有剧本 / AI 配置是否可用')
      return
    }
    setStyle(String(p.style ?? ''))
    setInstruments(String(p.instruments ?? '').split(/[、,，]/).map((x) => x.trim()).filter(Boolean))
  }

  // ── 乐器多选 chips ──
  const toggleInstrument = (inst: string) => {
    const next = instruments.includes(inst) ? instruments.filter((x) => x !== inst) : [...instruments, inst]
    setInstruments(next)
    patchObject(id, { instruments: next.join('、') })
  }
  const addCustomInstrument = () => {
    const v = customInst.trim()
    if (!v) return
    if (!instruments.includes(v)) {
      const next = [...instruments, v]
      setInstruments(next)
      patchObject(id, { instruments: next.join('、') })
    }
    setCustomInst('')
  }

  return (
    <div className="flex flex-col gap-2 nowheel">
      {/* 音频类型 */}
      <label className="block">
        <span className="mb-1 block text-[11px] text-ink-3">音频类型</span>
        <select
          className="nodrag nowheel w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
          disabled={locked}
          value={AUDIO_TYPE_OPTS.includes(audioType) ? audioType : ''}
          onChange={(e) => patchObject(id, { audio_type: e.target.value })}
        >
          {AUDIO_TYPE_OPTS.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </label>

      {/* 播放预览（url 由生成/连线回填；不再手填） */}
      {audioUrl ? (
        <div className="rounded-lg border border-edge bg-soft/40 p-1.5">
          <audio src={audioUrl} controls className="w-full" />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-edge px-2 py-1.5 text-[10px] text-ink-3">
          暂无音频文件：生成/连线回填后在此播放预览
        </div>
      )}

      {/* 分镜 / 故事板引入（全部音频类型可用：BGM 取背景音乐，配音/对白取台词，音效取音效） */}
      <div className="space-y-1.5 rounded-lg border border-edge p-1.5">
        <div className="flex items-center gap-1 text-[11px] text-ink-3">
          <Music2 size={12} /> 分镜 / 故事板引入
        </div>
        {linked.kind ? (
          <div className="rounded-lg border border-brand-500/30 bg-brand-500/5 px-2 py-1.5 text-[11px] leading-snug text-brand-300">
            {linked.kind === 'story'
              ? `已连线剧情节点：自动识别 ${mergedShots.length} 个分镜（含 BGM ${bgmShots.length} 个），选中自动带入${audioType === 'BGM' ? '背景音乐描述' : audioType === '音效' ? '音效' : '对白'}`
              : `已连线分镜脚本表：自动识别 ${mergedShots.length} 个分镜（含对白/音效），选中自动带入内容`}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-edge px-2 py-1.5 text-[11px] text-ink-3">
            未连线剧情节点/分镜脚本表：可手动填写分镜内容；连线剧情（分镜 BGM）或分镜脚本表（对白/音效）后自动引入
          </div>
        )}
        <select
          className="nodrag h-8 w-full rounded-md border border-edge bg-input px-1.5 text-sm text-ink outline-none focus:border-brand-500"
          value={shotNo ? String(shotNo) : ''}
          disabled={locked}
          onChange={(e) => pickShot(Number(e.target.value))}
        >
          <option value="">选择分镜（匹配其{audioType === 'BGM' ? '背景音乐' : audioType === '音效' ? '音效' : '对白'}）</option>
          {(bgmShots.length ? bgmShots : mergedShots).map((s) => (
            <option key={s.no} value={s.no}>
              分镜{s.no}：{s.bgm || s.location || `分镜${s.no}`}
            </option>
          ))}
        </select>
      </div>

      {audioType === 'BGM' ? (
        <>
          {/* BGM 音乐描述（选分镜带入，可手改）+ AI 识别建议 */}
          <div className="space-y-1.5 rounded-lg border border-edge p-1.5">
            <textarea
              className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
              rows={Math.min(12, Math.max(2, String(payload.desc ?? '').split('\n').length))}
              value={String(payload.desc ?? '')}
              disabled={locked}
              placeholder="选中分镜自动带入背景音乐描述，可手改…"
              onChange={(e) => patchObject(id, { desc: e.target.value })}
            />
            <button
              className="nodrag flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 text-sm text-white transition hover:bg-brand-500 disabled:opacity-50"
              disabled={locked || !!busy || !shotNo || !String(payload.desc ?? '').trim()}
              onClick={() => void suggest()}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {busy ? '识别中…' : 'AI 识别建议（风格 + 乐器 + 提示词）'}
            </button>
          </div>

          {/* 风格预选（可自定义）+ 乐器多选 */}
          <div className="space-y-1.5 rounded-lg border border-edge p-1.5">
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-3">音乐风格（预选或自定义）</span>
              <input
                className="nodrag w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
                list={`style-presets-${id}`}
                disabled={locked}
                value={style}
                placeholder="选择或输入风格，如：史诗感"
                onChange={(e) => { setStyle(e.target.value); patchObject(id, { style: e.target.value }) }}
              />
              <datalist id={`style-presets-${id}`}>
                {STYLE_PRESETS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            <div>
              <span className="mb-1 block text-[11px] text-ink-3">乐器设定（多选）</span>
              <div className="flex flex-wrap gap-1">
                {INSTRUMENT_PRESETS.map((inst) => {
                  const active = instruments.includes(inst)
                  return (
                    <button
                      key={inst}
                      type="button"
                      className={`nodrag rounded-full border px-2 py-0.5 text-[10px] transition ${
                        active
                          ? 'border-brand-500 bg-brand-500/15 text-brand-300'
                          : 'border-edge bg-soft text-ink-3 hover:bg-hover hover:text-ink'
                      }`}
                      disabled={locked}
                      onClick={() => toggleInstrument(inst)}
                    >
                      {inst}
                    </button>
                  )
                })}
              </div>
              <div className="mt-1 flex items-center gap-1">
                <input
                  className="nodrag h-7 min-w-0 flex-1 rounded-md border border-edge bg-input px-2 text-[11px] text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
                  placeholder="追加自定义乐器…"
                  value={customInst}
                  disabled={locked}
                  onChange={(e) => setCustomInst(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addCustomInstrument()
                    }
                  }}
                />
                <button
                  className="nodrag flex h-7 shrink-0 items-center gap-0.5 rounded-md bg-soft px-2 text-[11px] text-ink-2 transition hover:text-ink disabled:opacity-50"
                  disabled={locked || !customInst.trim()}
                  onClick={addCustomInstrument}
                >
                  <Plus size={11} /> 添加
                </button>
              </div>
            </div>
          </div>

          {/* 音乐提示词 + AI 优化（联动风格/乐器） */}
          <div className="space-y-1.5 rounded-lg border border-edge p-1.5">
            <span className="text-[11px] text-ink-3">音乐提示词（AI 优化自动联动已选风格/乐器，可再自定义要求）</span>
            <textarea
              className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
              rows={Math.min(20, Math.max(3, String(payload.prompt ?? '').split('\n').length))}
              value={String(payload.prompt ?? '')}
              disabled={locked}
              placeholder="AI 识别建议后自动生成音乐提示词，可手改…"
              onChange={(e) => patchObject(id, { prompt: e.target.value })}
            />
            <AiOptimizeBar
              id={id}
              target="prompt"
              label="AI 优化"
              disabled={locked}
              quickReqs={['更欢快', '加人声哼唱', '节奏放慢', '氛围大气']}
              quickTemplates={{
                '更欢快': '整体情绪更欢快，节奏明快跳跃，旋律轻快上扬',
                '加人声哼唱': '加入人声哼唱段落，空灵或温暖的人声点缀',
                '节奏放慢': '节奏放慢，更舒缓，留白与呼吸感增强',
                '氛围大气': '氛围更宏大开阔，层次丰富，气势磅礴',
              }}
              system={
                '你是影视配乐提示词专家。把音乐提示词优化成可直接用于音乐生成模型的高质量中文提示词：含情绪、节奏/BPM、风格、乐器、层次结构。严格遵循已选【音乐风格】与【乐器设定】，不要擅自更改。只输出优化后的提示词，不要多余解释。'
              }
              getContext={() =>
                [
                  style ? `【音乐风格】${style}` : '',
                  instruments.length ? `【乐器设定】${instruments.join('、')}` : '',
                  buildRefContext(),
                ].filter(Boolean).join('\n')
              }
            />
            <div className="rounded-lg bg-soft px-2 py-1.5 text-[10px] leading-snug text-ink-3">
              说明：当前产出为音乐描述/提示词（后端暂无音乐合成 API）。真实音乐文件可用该提示词在 Suno 等外部服务生成，生成后节点自动展示播放预览。
            </div>
          </div>

          {/* 技能库 / 知识库（注入 AI 优化 / 识别建议上下文） */}
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-edge p-1.5">
            <select
              className="nodrag h-8 min-w-0 rounded-md border border-edge bg-input px-1 text-sm text-ink outline-none focus:border-brand-500"
              value={skillId}
              disabled={locked}
              onChange={(e) => { setSkillId(e.target.value); patchObject(id, { skill_ref: e.target.value }) }}
              title="技能库：选中后内容注入 AI 优化/识别建议"
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
              title="知识库：选中后内容注入 AI 优化/识别建议"
            >
              <option value="">知识库</option>
              {kbs.map((k) => (
                <option key={String(k.id)} value={String(k.id)}>{String(k.title || k.id)}</option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">文本内容</span>
            <textarea
              className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
              rows={Math.min(20, Math.max(4, String(payload.text ?? '').split('\n').length))}
              disabled={locked}
              value={String(payload.text ?? '')}
              placeholder="配音稿 / 音效描述 / 对白文本…"
              onChange={(e) => patchObject(id, { text: e.target.value })}
            />
          </label>
        </>
      )}

      {errMsg && <ErrorBanner message={errMsg} />}
    </div>
  )
}
