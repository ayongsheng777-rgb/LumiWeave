// =====================================================================
// 画布设置（设置弹窗「画布」tab）
//   ① 场景候选池：出图 / 出视频各自维护「候选模型列表 + 默认项」。
//      候选来源：云端模型库 profile（可拉取平台模型列表自选）+ 本地 ComfyUI checkpoint。
//   ② 智能动作：画布节点悬浮工具栏「智能生成」菜单的模板配置
//      （提示词模板可改、默认模型从候选池选、可启停）。
// =====================================================================
import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  getProfiles,
  getPvActions,
  getRenderers,
  getRendererWorkflows,
  getScenePools,
  listPlatformModels,
  savePvActions,
  saveScenePools,
} from '../api'
import { bumpPools, type PoolCandidate, type PvAction, type ScenePools } from '../pv/pools'

const inputCls =
  'w-full rounded-md border border-edge bg-input px-2 py-1.5 text-xs text-ink outline-none transition focus:border-brand-500 placeholder:text-ink-3'

interface ProfileLite {
  id: string
  name: string
  model: string
  scene_models?: Record<string, string>
}

const SCENE_LABEL: Record<'image' | 'video', string> = { image: '出图', video: '出视频' }

const EMPTY_POOLS: ScenePools = {
  image: { default: '', candidates: [] },
  video: { default: '', candidates: [] },
}

export default function CanvasModelPanel() {
  const [pools, setPools] = useState<ScenePools>(EMPTY_POOLS)
  const [actions, setActions] = useState<PvAction[]>([])
  const [profiles, setProfiles] = useState<ProfileLite[]>([])
  const [loading, setLoading] = useState(true)
  const [savingPools, setSavingPools] = useState(false)
  const [savingActions, setSavingActions] = useState(false)
  const [msg, setMsg] = useState('')

  // 添加候选的表单状态
  const [addScene, setAddScene] = useState<'image' | 'video'>('image')
  const [addKind, setAddKind] = useState<'cloud' | 'comfyui'>('cloud')
  const [addProfile, setAddProfile] = useState('')
  const [addModel, setAddModel] = useState('')
  const [platformModels, setPlatformModels] = useState<string[]>([])
  const [ckpts, setCkpts] = useState<string[]>([])
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    void (async () => {
      const [p, a, pr] = await Promise.all([getScenePools(), getPvActions(), getProfiles()])
      if (p.ok && p.data.pools) {
        const raw = p.data.pools as Partial<ScenePools>
        setPools({
          image: raw.image?.candidates ? (raw.image as ScenePools['image']) : { default: '', candidates: [] },
          video: raw.video?.candidates ? (raw.video as ScenePools['video']) : { default: '', candidates: [] },
        })
      }
      if (a.ok) setActions((a.data.actions as PvAction[]) || [])
      if (pr.ok) setProfiles((pr.data.profiles as ProfileLite[]) || [])
      setLoading(false)
    })()
  }, [])

  /** 拉平台模型列表（云端候选自选） */
  const fetchPlatformModels = async () => {
    if (!addProfile) return
    setFetching(true)
    try {
      const res = await listPlatformModels(addProfile)
      if (res.ok) setPlatformModels((res.data.models as string[]) || [])
      else setMsg(String(res.data.error || '拉取模型列表失败'))
    } finally {
      setFetching(false)
    }
  }

  /** 拉 ComfyUI checkpoint 列表（第一个启用的 comfyui 渲染器） */
  const fetchCheckpoints = async () => {
    setFetching(true)
    try {
      const rr = await getRenderers()
      const list = (rr.ok ? (rr.data.renderers as { id: string; type: string; enabled: boolean }[]) : []) || []
      const comfy = list.find((r) => r.type === 'comfyui' && r.enabled)
      if (!comfy) {
        setMsg('没有启用的 ComfyUI 渲染器，先去「出图」tab 配一个')
        return
      }
      const wf = await getRendererWorkflows(comfy.id)
      if (wf.ok) setCkpts((wf.data.checkpoints as string[]) || [])
      else setMsg(String(wf.data.error || '拉取 ComfyUI 模型失败'))
    } finally {
      setFetching(false)
    }
  }

  const addCandidate = () => {
    const model = addModel.trim()
    if (!model) {
      setMsg('先填模型名（或从列表里选一个）')
      return
    }
    let candidate: PoolCandidate
    if (addKind === 'comfyui') {
      candidate = {
        id: `comfyui::${model}`,
        profile_id: 'comfyui',
        model,
        label: `ComfyUI·${model}`,
        renderer: 'comfyui',
      }
    } else {
      if (!addProfile) {
        setMsg('先选一个模型库配置')
        return
      }
      const p = profiles.find((x) => x.id === addProfile)
      candidate = {
        id: `${addProfile}::${model}`,
        profile_id: addProfile,
        model,
        label: `${p?.name || addProfile}·${model}`,
        renderer: 'cloud',
      }
    }
    setPools((cur) => {
      const pool = cur[addScene]
      if (pool.candidates.some((c) => c.id === candidate.id)) {
        setMsg('这个候选已经在池里了')
        return cur
      }
      const candidates = [...pool.candidates, candidate]
      return {
        ...cur,
        [addScene]: { default: pool.default || candidate.id, candidates },
      }
    })
    setAddModel('')
    setMsg('')
  }

  const removeCandidate = (scene: 'image' | 'video', id: string) => {
    setPools((cur) => {
      const pool = cur[scene]
      const candidates = pool.candidates.filter((c) => c.id !== id)
      const def = pool.default === id ? candidates[0]?.id || '' : pool.default
      return { ...cur, [scene]: { default: def, candidates } }
    })
  }

  const setDefault = (scene: 'image' | 'video', id: string) => {
    setPools((cur) => ({ ...cur, [scene]: { ...cur[scene], default: id } }))
  }

  const onSavePools = async () => {
    setSavingPools(true)
    try {
      const res = await saveScenePools(pools as unknown as Record<string, unknown>)
      setMsg(res.ok ? '候选池已保存' : String(res.data.error || '保存失败'))
      if (res.ok) bumpPools()
    } finally {
      setSavingPools(false)
    }
  }

  const onSaveActions = async () => {
    setSavingActions(true)
    try {
      const res = await savePvActions(actions as unknown as Record<string, unknown>[])
      setMsg(res.ok ? '智能动作已保存' : String(res.data.error || '保存失败'))
      if (res.ok) bumpPools()
    } finally {
      setSavingActions(false)
    }
  }

  const patchAction = (id: string, patch: Partial<PvAction>) => {
    setActions((cur) => cur.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }

  const allCandidates = useMemo(
    () => [...pools.image.candidates, ...pools.video.candidates],
    [pools],
  )

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-3">
        <Loader2 size={15} className="animate-spin" /> 加载画布配置…
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* ── ① 场景候选池 ─────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">场景候选池</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-3">
            出图 / 出视频各自维护一组候选模型（云端模型库 + 本地 ComfyUI），画布弹窗里的模型下拉就从这里出。
            每个场景选一个默认项，智能动作没指定模型时就用默认项。
          </p>
        </div>

        {(['image', 'video'] as const).map((scene) => (
          <div key={scene} className="rounded-xl border border-edge bg-soft/40 p-3">
            <div className="mb-2 text-xs font-medium text-ink-2">{SCENE_LABEL[scene]}候选</div>
            {pools[scene].candidates.length === 0 && (
              <p className="py-1 text-[11px] text-ink-3">还没有候选，用下面的表单添加。</p>
            )}
            <div className="space-y-1.5">
              {pools[scene].candidates.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-lg border border-edge bg-input px-2.5 py-1.5"
                >
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-3" title="设为默认">
                    <input
                      type="radio"
                      name={`default-${scene}`}
                      checked={pools[scene].default === c.id}
                      onChange={() => setDefault(scene, c.id)}
                    />
                    默认
                  </label>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{c.label}</span>
                  {c.renderer === 'comfyui' && (
                    <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] text-teal-400">本地</span>
                  )}
                  <button
                    className="rounded p-1 text-ink-3 transition hover:bg-soft hover:text-red-400"
                    onClick={() => removeCandidate(scene, c.id)}
                    title="移出候选池"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* 添加候选表单 */}
        <div className="space-y-2 rounded-xl border border-dashed border-edge p-3">
          <div className="text-xs font-medium text-ink-2">添加候选</div>
          <div className="grid grid-cols-2 gap-2">
            <select className={inputCls} value={addScene} onChange={(e) => setAddScene(e.target.value as 'image' | 'video')}>
              <option value="image">加入：出图池</option>
              <option value="video">加入：出视频池</option>
            </select>
            <select
              className={inputCls}
              value={addKind}
              onChange={(e) => {
                setAddKind(e.target.value as 'cloud' | 'comfyui')
                setAddModel('')
              }}
            >
              <option value="cloud">云端模型库</option>
              <option value="comfyui">本地 ComfyUI</option>
            </select>
          </div>
          {addKind === 'cloud' ? (
            <>
              <div className="flex gap-2">
                <select className={inputCls} value={addProfile} onChange={(e) => setAddProfile(e.target.value)}>
                  <option value="">选模型库配置…</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.id}
                    </option>
                  ))}
                </select>
                <button
                  className="flex shrink-0 items-center gap-1 rounded-md border border-edge px-2 text-[11px] text-ink-2 transition hover:bg-hover disabled:opacity-50"
                  onClick={() => void fetchPlatformModels()}
                  disabled={!addProfile || fetching}
                  title="从平台拉取可用模型列表"
                >
                  {fetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  拉取列表
                </button>
              </div>
              <input
                className={inputCls}
                placeholder="模型名（可从拉取的列表里选，也可手输）"
                value={addModel}
                onChange={(e) => setAddModel(e.target.value)}
                list="canvas-platform-models"
              />
              <datalist id="canvas-platform-models">
                {platformModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="checkpoint 名（如 xxx.safetensors）"
                  value={addModel}
                  onChange={(e) => setAddModel(e.target.value)}
                  list="canvas-comfyui-ckpts"
                />
                <button
                  className="flex shrink-0 items-center gap-1 rounded-md border border-edge px-2 text-[11px] text-ink-2 transition hover:bg-hover disabled:opacity-50"
                  onClick={() => void fetchCheckpoints()}
                  disabled={fetching}
                  title="从 ComfyUI 拉取 checkpoint 列表"
                >
                  {fetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  拉取列表
                </button>
              </div>
              <datalist id="canvas-comfyui-ckpts">
                {ckpts.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          )}
          <button
            className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-600"
            onClick={addCandidate}
          >
            <Plus size={13} /> 加入候选池
          </button>
        </div>

        <button
          className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs text-ink-2 transition hover:bg-hover disabled:opacity-50"
          onClick={() => void onSavePools()}
          disabled={savingPools}
        >
          {savingPools ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          保存候选池
        </button>
      </section>

      {/* ── ② 智能动作 ───────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">智能动作（节点悬浮工具栏）</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-3">
            图片节点「智能生成」菜单里的每个动作：提示词模板（{'{prompt}'} 会被你在弹窗里补的描述替换）、
            默认模型（不选 = 用候选池默认项）、是否启用。改完即时生效于画布。
          </p>
        </div>
        <div className="space-y-2">
          {actions.map((a) => (
            <div key={a.id} className="space-y-2 rounded-xl border border-edge bg-soft/40 p-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={a.enabled}
                  onChange={(e) => patchAction(a.id, { enabled: e.target.checked })}
                  title="启用/停用"
                />
                <span className="text-xs font-medium text-ink">{a.label}</span>
                <select
                  className="ml-auto w-48 rounded-md border border-edge bg-input px-2 py-1 text-[11px] text-ink outline-none"
                  value={a.model}
                  onChange={(e) => patchAction(a.id, { model: e.target.value })}
                  title="默认模型（不选=候选池默认项）"
                >
                  <option value="">候选池默认项</option>
                  {allCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                className={`${inputCls} min-h-[56px] resize-y`}
                value={a.prompt_template}
                onChange={(e) => patchAction(a.id, { prompt_template: e.target.value })}
              />
            </div>
          ))}
        </div>
        <button
          className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs text-ink-2 transition hover:bg-hover disabled:opacity-50"
          onClick={() => void onSaveActions()}
          disabled={savingActions}
        >
          {savingActions ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          保存智能动作
        </button>
      </section>

      {msg && <p className="text-xs text-ink-2">{msg}</p>}
    </div>
  )
}
