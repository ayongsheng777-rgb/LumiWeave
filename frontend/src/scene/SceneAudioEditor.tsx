// SceneAudioEditor —— 音频节点全面板（V2.7）
// 核心：背景音乐（BGM）分镜匹配识别 → AI 建议音乐风格/乐器 → 生成音乐提示词
// 连线剧情后：列出各分镜背景音乐 → 选分镜序号自动带出 BGM 描述 → AI 识别建议
// （走后端 generate_music 动作，写回 style/instruments/prompt）→ 可手改 + AI 优化
// 说明：后端暂无音乐合成 API，产出为「音乐描述/提示词」，真实音频需外部 Suno 类服务。
import { useMemo, useState } from 'react'
import { Loader2, Sparkles, Music2 } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { type AnyObj, isStoryNode, parseShotsFromScript } from './sceneScript'
import ErrorBanner from '../components/ErrorBanner'
import AiOptimizeBar from './AiOptimizeBar'

const AUDIO_TYPE_OPTS = ['配音', 'BGM', '音效', '对白']

export default function SceneAudioEditor({ id, locked }: { id: string; locked: boolean }) {
  const patchObject = useSceneStore((s) => s.patchObject)
  const runAction = useSceneStore((s) => s.runAction)
  const busy = useSceneStore((s) => s.busy)
  const objects = useSceneStore((s) => s.objects)
  const edges = useSceneStore((s) => s.edges)
  const obj = useSceneStore((s) => s.objects.find((o) => o.id === id))
  const payload = ((obj?.data as AnyObj)?.payload || {}) as AnyObj
  const audioUrl = String(payload.url ?? '')

  // ── 连线剧情节点：读剧本 + 解析分镜 BGM ──
  const storyObj = useMemo(() => {
    const sid = edges
      .map((e) => (e.source === id ? e.target : e.target === id ? e.source : ''))
      .find((x) => !!x && isStoryNode(objects.find((o) => o.id === x)))
    return sid ? objects.find((o) => o.id === sid) : null
  }, [edges, objects, id])
  const script = String(((storyObj?.data as AnyObj)?.payload as AnyObj)?.script ?? '')
  const mergedShots = useMemo(() => (script ? parseShotsFromScript(script) : []), [script])
  const bgmShots = useMemo(() => mergedShots.filter((s) => String(s.bgm ?? '').trim()), [mergedShots])

  const audioType = String(payload.audio_type ?? 'BGM')
  const shotNo = Number(payload.shot_no) || 0
  const currentShot = mergedShots.find((s) => s.no === shotNo)

  const [style, setStyle] = useState(String(payload.style ?? ''))
  const [instruments, setInstruments] = useState(String(payload.instruments ?? ''))
  const [errMsg, setErrMsg] = useState('')

  // ── 选分镜 → 带出 BGM 描述 ──
  const pickShot = (no: number) => {
    const s = mergedShots.find((x) => x.no === no)
    patchObject(id, { shot_no: no ? String(no) : '', desc: s ? String(s.bgm ?? '') : '' })
  }

  // ── AI 识别建议（后端动作：分镜 BGM → 风格/乐器/提示词写回）──
  const suggest = async () => {
    if (!shotNo || !currentShot) return
    setErrMsg('')
    await runAction('generate_music', [id], { shot_no: String(shotNo) })
    // 动作完成后节点已重载，从 store 读最新值
    const o = useSceneStore.getState().objects.find((x) => x.id === id)
    const p = ((o?.data as AnyObj)?.payload as AnyObj) || {}
    if (!String(p.prompt ?? '').trim()) {
      setErrMsg('未生成音乐提示词，请检查剧情节点是否已有剧本 / AI 配置是否可用')
      return
    }
    setStyle(String(p.style ?? ''))
    setInstruments(String(p.instruments ?? ''))
  }

  // ── 提示词 AI 优化（V2.8.1：已迁移到通用 AiOptimizeBar —— 独立模型选择 + 用户要求输入框）
  // 原 optimizePrompt 函数移除，由 AiOptimizeBar 承担（含【用户要求】注入）

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto nowheel">
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

      {/* 音频文件预览（如已生成/上传） */}
      {audioUrl && <audio src={audioUrl} controls className="w-full" />}

      {audioType === 'BGM' ? (
        <>
          {/* BGM 分镜匹配：列出有背景音乐的分镜 */}
          <div className="space-y-1.5 rounded-lg border border-edge p-1.5">
            <div className="flex items-center gap-1 text-[11px] text-ink-3">
              <Music2 size={12} /> 分镜背景音乐匹配
            </div>
            {!storyObj && (
              <div className="rounded-lg border border-dashed border-edge px-2 py-1.5 text-[11px] text-ink-3">
                未连线剧情节点：可手动填写分镜序号与背景音乐描述
              </div>
            )}
            <select
              className="nodrag h-8 w-full rounded-md border border-edge bg-input px-1.5 text-sm text-ink outline-none focus:border-brand-500"
              value={shotNo ? String(shotNo) : ''}
              disabled={locked}
              onChange={(e) => pickShot(Number(e.target.value))}
            >
              <option value="">选择分镜（匹配其背景音乐）</option>
              {(bgmShots.length ? bgmShots : mergedShots).map((s) => (
                <option key={s.no} value={s.no}>
                  分镜{s.no}：{s.bgm || `${s.location || ''}（无 BGM，可手动填写）`}
                </option>
              ))}
            </select>
            <textarea
              className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
              rows={2}
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

          {/* 风格 / 乐器设定（AI 建议后自动填入，可手改） */}
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-3">音乐风格</span>
              <input
                className="nodrag w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
                disabled={locked}
                value={style}
                placeholder="如：轻松俏皮"
                onChange={(e) => { setStyle(e.target.value); patchObject(id, { style: e.target.value }) }}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-3">乐器设定</span>
              <input
                className="nodrag w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
                disabled={locked}
                value={instruments}
                placeholder="如：尤克里里+轻鼓"
                onChange={(e) => { setInstruments(e.target.value); patchObject(id, { instruments: e.target.value }) }}
              />
            </label>
          </div>

          {/* 音乐提示词 + AI 优化（V2.8.1：独立模型选择 + 用户要求输入框） */}
          <div className="space-y-1.5 rounded-lg border border-edge p-1.5">
            <span className="text-[11px] text-ink-3">音乐提示词（AI 优化可带要求，如：更欢快、加人声哼唱）</span>
            <textarea
              className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
              rows={3}
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
              system={
                '你是影视配乐提示词专家。把音乐提示词优化成可直接用于音乐生成模型的高质量中文提示词：含情绪、节奏/BPM、风格、乐器、层次结构。只输出优化后的提示词，不要多余解释。'
              }
              getContext={() =>
                [
                  style ? `【音乐风格】${style}` : '',
                  instruments ? `【乐器设定】${instruments}` : '',
                ].filter(Boolean).join('\n')
              }
            />
            <div className="rounded-lg bg-soft px-2 py-1.5 text-[10px] leading-snug text-ink-3">
              说明：当前产出为音乐描述/提示词（后端暂无音乐合成 API）。真实音乐文件可用该提示词在 Suno 等外部音乐生成服务中生成，再把音频地址填到下方。
            </div>
          </div>

          {/* 音频地址 */}
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">音频地址（可选，外部生成的音乐文件 URL）</span>
            <input
              className="nodrag w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
              disabled={locked}
              value={audioUrl}
              placeholder="https://…/bgm.mp3"
              onChange={(e) => patchObject(id, { url: e.target.value })}
            />
          </label>
        </>
      ) : (
        <>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">文本内容</span>
            <textarea
              className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
              rows={4}
              disabled={locked}
              value={String(payload.text ?? '')}
              placeholder="配音稿 / 音效描述 / 对白文本…"
              onChange={(e) => patchObject(id, { text: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">音频地址</span>
            <input
              className="nodrag w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
              disabled={locked}
              value={audioUrl}
              placeholder="https://…/audio.mp3"
              onChange={(e) => patchObject(id, { url: e.target.value })}
            />
          </label>
        </>
      )}

      {errMsg && <ErrorBanner message={errMsg} />}
    </div>
  )
}


