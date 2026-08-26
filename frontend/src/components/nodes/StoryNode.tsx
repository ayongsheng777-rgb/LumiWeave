import { type NodeProps } from '@xyflow/react'
import { BookOpen, Wand2, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useNodeAdapter } from '../../store/nodeAdapter'
import { NodeShell, Field, inputCls } from './NodeShell'
import { filmStoryParse, filmCharacterGenerate, filmSceneGenerate, filmPropGenerate } from '../../api'
import { emitLog } from '../LogPanel'

const GENRES = ['科幻', '奇幻', '爱情', '战争', '悬疑', '喜剧', '动作', '动画', '惊悚', '纪录片']
const STYLES = ['电影感', '动漫', '写实', '水彩', '3D', '赛博朋克', '蒸汽朋克', '古风']
const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4']

export type VideoGenMode = 'auto_full' | 'auto_firstframe' | 'text2video'
export type GenStep = 'idle' | 'parsing' | 'generating_chars' | 'generating_scenes' | 'generating_props' | 'done' | 'error'

interface GenProgress { step: string; current: number; total: number }

export const VIDEO_MODE_OPTIONS = [
  { value: 'auto_full', label: '🔗 文生图+全量参考生视频', desc: '先生成角色/场景/道具图，再全量参考生成视频' },
  { value: 'auto_firstframe', label: '🎬 文生图+首帧参考生视频', desc: '先生成角色/场景/道具图，以首帧图生成视频' },
  { value: 'text2video', label: '✍️ 纯文生视频', desc: '直接用故事描述生成视频，不生成中间图片' },
]

export function StoryNode({ id, data, selected }: NodeProps) {
  const { update } = useNodeAdapter()
  const d = data as Record<string, unknown>

  const story    = String(d.text ?? '')
  const genre    = String(d.genre ?? '科幻')
  const style    = String(d.style ?? '电影感')
  const ratio    = String(d.ratio ?? '16:9')
  const duration = Number(d.duration ?? 30)
  const chars    = (d.characters as { id: string; name: string; description: string; prompt: string }[]) || []
  const scenes   = (d.scenes   as { id: string; name: string; location: string; description: string }[]) || []
  const props    = (d.props    as { id: string; name: string; description: string; prompt: string }[]) || []
  const shots    = (d.shots    as { shot: number; character_ids?: string[]; scene_ids?: string[] }[]) || []
  const status   = String(d.status ?? 'idle')

  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const [videoMode, setVideoMode] = useState<VideoGenMode>('auto_full')
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [genStep, setGenStep]   = useState<GenStep>('idle')
  const [genProg, setGenProg]   = useState<GenProgress>({ step: '', current: 0, total: 0 })
  // 生成结果：id → url
  const [charUrls,  setCharUrls]  = useState<Record<string, string>>({})
  const [sceneUrls, setSceneUrls] = useState<Record<string, string>>({})
  const [propUrls,  setPropUrls]  = useState<Record<string, string>>({})

  // ── 步骤一：AI 解析 ──────────────────────────────────────────────
  const runParse = async () => {
    if (!story.trim()) { setError('请先输入故事内容'); return }
    setBusy(true); setError('')
    setGenStep('parsing')
    update(id, { status: 'running' })
    emitLog({ nodeId: id, nodeLabel: '故事输入', nodeType: 'story', status: 'running', message: 'AI 解析故事中…' })
    const t0 = Date.now()
    try {
      const res = await filmStoryParse({ text: story, genre, style, ratio, duration })
      if (res.ok !== false && res.data) {
        const parsed = res.data
        const gotChars  = (parsed.characters as { id: string; name: string; description: string; prompt: string }[]) || []
        const gotScenes = (parsed.scenes    as { id: string; name: string; location: string; description: string }[]) || []
        const gotProps  = (parsed.props     as { id: string; name: string; description: string; prompt: string }[]) || []
        const gotShots  = (parsed.shots     as { shot: number; character_ids?: string[]; scene_ids?: string[] }[]) || []
        update(id, {
          status: 'completed',
          characters:  gotChars,
          scenes:      gotScenes,
          props:       gotProps,
          shots:       gotShots,
          storyboard:  gotShots,
        })
        emitLog({ nodeId: id, nodeLabel: '故事输入', nodeType: 'story', status: 'completed',
          message: `解析完成 · ${gotChars.length}角色/${gotScenes.length}场景/${gotShots.length}分镜`, duration: Date.now() - t0 })
        setGenStep('idle')
      } else {
        setError((res.error || '解析失败') as string)
        update(id, { status: 'failed' })
        setGenStep('error')
        emitLog({ nodeId: id, nodeLabel: '故事输入', nodeType: 'story', status: 'failed', message: `解析失败 · ${String(res.error || '').slice(0, 60)}` })
      }
    } catch (e) {
      setError(String(e)); update(id, { status: 'failed' }); setGenStep('error')
      emitLog({ nodeId: id, nodeLabel: '故事输入', nodeType: 'story', status: 'failed', message: `解析失败 · ${String(e).slice(0, 60)}` })
    } finally {
      setBusy(false)
    }
  }

  // ── 步骤二：全流程生成（先生成图片，再写回 shots 填 reference_images）──
  const runFullGenerate = async () => {
    if (videoMode === 'text2video') {
      // 纯文生：只写回 shots，联动时走 text2video
      const updatedShots = shots.map((s) => ({ ...s, reference_images: [] as string[], image_url: '' }))
      update(id, { shots: updatedShots, storyboard: updatedShots, video_mode: 'text2video' })
      setGenStep('done')
      emitLog({ nodeId: id, nodeLabel: '故事输入', nodeType: 'story', status: 'completed', message: '纯文生模式已就绪，分镜可生成视频' })
      return
    }

    // 需要先生成图片
    setGenStep('generating_chars'); setGenProg({ step: '生成角色图', current: 0, total: chars.length })
    const newCharUrls: Record<string, string> = {}
    const newSceneUrls: Record<string, string> = {}
    const newPropUrls:  Record<string, string> = {}

    // 批量生成角色图（并行）
    const charJobs = chars.map(async (c, i) => {
      setGenProg({ step: '生成角色图', current: i + 1, total: chars.length })
      const res = await filmCharacterGenerate({
        name: c.name, description: c.description, prompt: c.prompt, style,
      })
      const r = res as unknown as { ok?: boolean; data?: { url?: string } }
      if (r.ok !== false && r.data?.url) newCharUrls[c.id] = r.data.url
    })
    await Promise.all(charJobs)
    setCharUrls(newCharUrls)

    // 批量生成场景图（并行）
    setGenStep('generating_scenes'); setGenProg({ step: '生成场景图', current: 0, total: scenes.length })
    const sceneJobs = scenes.map(async (s, i) => {
      setGenProg({ step: '生成场景图', current: i + 1, total: scenes.length })
      const res = await filmSceneGenerate({
        name: s.name, location: s.location, description: s.description, style,
      })
      const r = res as unknown as { ok?: boolean; data?: { url?: string } }
      if (r.ok !== false && r.data?.url) newSceneUrls[s.id] = r.data.url
    })
    await Promise.all(sceneJobs)
    setSceneUrls(newSceneUrls)

    // 批量生成道具图（并行）
    if (props.length > 0) {
      setGenStep('generating_props'); setGenProg({ step: '生成道具图', current: 0, total: props.length })
      const propJobs = props.map(async (p, i) => {
        setGenProg({ step: '生成道具图', current: i + 1, total: props.length })
        const res = await filmPropGenerate({ name: p.name, description: p.description, prompt: p.prompt, style })
        const r = res as unknown as { ok?: boolean; data?: { url?: string } }
        if (r.ok !== false && r.data?.url) newPropUrls[p.id] = r.data.url
      })
      await Promise.all(propJobs)
      setPropUrls(newPropUrls)
    }

    // 把生成的图片 URL 写回 shots，每个 shot 按 character_ids/scene_ids 填 reference_images
    // video_mode 决定用什么模式：auto_full→multi_ref，auto_firstframe→image2video
    const finalMode = videoMode === 'auto_full' ? 'multi_ref' : 'image2video'
    const updatedShots = shots.map((s) => {
      const refs: string[] = []
      const charIds: string[] = s.character_ids || []
      const sceneIds: string[] = s.scene_ids || []

      charIds.forEach((cid) => { if (newCharUrls[cid])  refs.push(newCharUrls[cid]) })
      sceneIds.forEach((sid) => { if (newSceneUrls[sid]) refs.push(newSceneUrls[sid]) })
      ;(s as Record<string, unknown>).props?.toString().split(',').forEach((pid: string) => {
        if (newPropUrls[pid.trim()]) refs.push(newPropUrls[pid.trim()])
      })

      // image2video 模式：取第一张参考图作首帧
      const imageUrl = refs[0] || ''

      return { ...s, reference_images: refs, image_url: imageUrl }
    })

    update(id, {
      shots: updatedShots,
      storyboard: updatedShots,
      video_mode: finalMode,
      character_urls: newCharUrls,
      scene_urls: newSceneUrls,
      prop_urls: newPropUrls,
    })
    setGenStep('done')
    const totalImages = Object.keys(newCharUrls).length + Object.keys(newSceneUrls).length + Object.keys(newPropUrls).length
    emitLog({ nodeId: id, nodeLabel: '故事输入', nodeType: 'story', status: 'completed',
      message: `全流程生成完成 · ${totalImages}张参考图 · ${shots.length}个分镜已填入参考图`, duration: 0 })
  }

  const isParsed = chars.length > 0 || status === 'completed'
  const isGenerating = genStep !== 'idle' && genStep !== 'done' && genStep !== 'error'

  // 进度条文字
  const stepLabel: Record<GenStep, string> = {
    idle: '', parsing: 'AI 解析中…',
    generating_chars: `生成角色图 ${genProg.current}/${genProg.total}`,
    generating_scenes: `生成场景图 ${genProg.current}/${genProg.total}`,
    generating_props: `生成道具图 ${genProg.current}/${genProg.total}`,
    done: '生成完成 ✓', error: '生成失败 ✗',
  }

  return (
    <NodeShell id={id} selected={selected} title="故事输入" icon={<BookOpen size={15} />}>
      <Field label="故事内容">
        <textarea
          className={inputCls}
          rows={4}
          value={story}
          placeholder="输入故事、小说、广告需求或视频创意……"
          onChange={(e) => update(id, { text: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="类型">
          <select className={inputCls} value={genre} onChange={(e) => update(id, { genre: e.target.value })}>
            {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="风格">
          <select className={inputCls} value={style} onChange={(e) => update(id, { style: e.target.value })}>
            {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="比例">
          <select className={inputCls} value={ratio} onChange={(e) => update(id, { ratio: e.target.value })}>
            {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="时长(秒)">
          <input className={inputCls} type="number" min={5} max={300} value={duration}
            onChange={(e) => update(id, { duration: Number(e.target.value) })} />
        </Field>
      </div>

      {error && <div className="rounded bg-status-failed/10 px-2 py-1 text-[11px] text-status-failed">{error}</div>}

      {/* ── 第一步：解析 ── */}
      <button className="nodrag w-full rounded-lg bg-brand-500 px-3 py-2 text-sm text-white transition hover:bg-brand-600 disabled:opacity-50"
        onClick={busy ? undefined : runParse} disabled={busy || isGenerating}>
        {busy && genStep === 'parsing' ? 'AI 解析中…' : '① AI 解析生成流程'}
      </button>

      {/* ── 第二步：全流程生成（始终显示；未解析时置灰） ── */}
      {genStep !== 'parsing' && (
        <div className="mt-2 space-y-1.5">
          {/* 模式选择 */}
          <div className="relative">
            <button
              className="nodrag w-full flex items-center justify-between rounded-lg border border-edge bg-soft px-3 py-2 text-sm text-ink-1 hover:border-brand-400 transition"
              onClick={() => setShowModeMenu(!showModeMenu)}
            >
              <span className="flex items-center gap-1.5">
                <Wand2 size={13} className="text-brand-400" />
                <span>{VIDEO_MODE_OPTIONS.find((o) => o.value === videoMode)?.label}</span>
              </span>
              <ChevronDown size={12} className={`transition-transform ${showModeMenu ? 'rotate-180' : ''}`} />
            </button>
            {showModeMenu && (
              <div className="absolute z-50 mt-1 w-full rounded-lg border border-edge bg-panel-2 shadow-lg">
                {VIDEO_MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`nodrag w-full px-3 py-2 text-left text-[12px] hover:bg-soft transition ${videoMode === opt.value ? 'text-brand-400 font-medium' : 'text-ink-2'}`}
                    onClick={() => { setVideoMode(opt.value as VideoGenMode); setShowModeMenu(false) }}
                  >
                    <div>{opt.label}</div>
                    <div className="text-[10px] text-ink-3">{opt.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 进度条 */}
          {isGenerating && (
            <div className="rounded bg-soft px-3 py-2 text-[11px] text-ink-2">
              <div className="mb-1">{stepLabel[genStep]}</div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-edge">
                <div
                  className="h-full rounded-full bg-brand-400 transition-all"
                  style={{ width: `${(genProg.current / Math.max(genProg.total, 1)) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* 完成状态 */}
          {genStep === 'done' && (
            <div className="rounded bg-green-500/10 px-3 py-2 text-[11px] text-green-400">
              ✓ 全流程生成完成 · {Object.keys(charUrls).length}角色图 / {Object.keys(sceneUrls).length}场景图 / {Object.keys(propUrls).length}道具图 · {shots.length}个分镜已填入参考图
            </div>
          )}

          {/* 生成按钮：未解析时置灰并提示 */}
          {!isParsed ? (
            <button className="nodrag w-full cursor-not-allowed rounded-lg bg-soft px-3 py-2 text-sm text-ink-3"
              disabled title="请先完成 ① AI 解析">
              ② 全流程生成（请先完成①解析）
            </button>
          ) : (
            <button className="nodrag w-full rounded-lg bg-brand-600 px-3 py-2 text-sm text-white transition hover:bg-brand-500 disabled:opacity-50"
              onClick={isGenerating ? undefined : runFullGenerate} disabled={isGenerating}>
              {isGenerating
                ? `② ${stepLabel[genStep]}`
                : `② 全流程生成（${videoMode === 'auto_full' ? '全量参考' : videoMode === 'auto_firstframe' ? '首帧参考' : '纯文生'}）`}
            </button>
          )}
        </div>
      )}

      {/* 解析预览 */}
      {(chars.length > 0 || status === 'completed') && (
        <div className="mt-2 rounded-md bg-soft px-2 py-1.5 text-[11px] text-ink-2">
          <span className="text-[10px] text-ink-3">解析结果：</span>
          {chars.length}个角色 · {scenes.length}个场景 · {props.length}个道具 · {shots.length}个分镜
        </div>
      )}

      {/* 已生成的参考图预览（生成完成后折叠显示） */}
      {genStep === 'done' && (
        <div className="mt-2 space-y-1">
          {Object.keys(charUrls).length > 0 && (
            <div>
              <div className="text-[10px] text-ink-3">角色图</div>
              <div className="flex gap-1 overflow-x-auto">
                {Object.entries(charUrls).map(([cid, url]) => (
                  <img key={cid} src={url} className="h-14 w-14 rounded-md object-cover flex-shrink-0" alt={cid} title={chars.find((c) => c.id === cid)?.name || cid} />
                ))}
              </div>
            </div>
          )}
          {Object.keys(sceneUrls).length > 0 && (
            <div>
              <div className="text-[10px] text-ink-3">场景图</div>
              <div className="flex gap-1 overflow-x-auto">
                {Object.entries(sceneUrls).map(([sid, url]) => (
                  <img key={sid} src={url} className="h-14 w-14 rounded-md object-cover flex-shrink-0" alt={sid} title={scenes.find((s) => s.id === sid)?.name || sid} />
                ))}
              </div>
            </div>
          )}
          {Object.keys(propUrls).length > 0 && (
            <div>
              <div className="text-[10px] text-ink-3">道具图</div>
              <div className="flex gap-1 overflow-x-auto">
                {Object.entries(propUrls).map(([pid, url]) => (
                  <img key={pid} src={url} className="h-14 w-14 rounded-md object-cover flex-shrink-0" alt={pid} title={props.find((p) => p.id === pid)?.name || pid} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </NodeShell>
  )
}
