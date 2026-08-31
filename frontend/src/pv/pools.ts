// 场景模型候选池 + 画布智能动作：整个画布共享一份缓存（仿 useProfiles）
// 候选池 = image/video 两个场景各自的「可选模型列表 + 默认项」，
// 候选可以是云端模型库 profile，也可以是本地 ComfyUI checkpoint（profile_id='comfyui'）。
import { useEffect, useState } from 'react'
import { getPvActions, getScenePools } from '../api'

export interface PoolCandidate {
  id: string             // '<profile_id>::<model>'，comfyui 候选为 'comfyui::<checkpoint>'
  profile_id: string     // 模型库 profile id；'comfyui' = 本地渲染器
  model: string
  label: string
  renderer: 'cloud' | 'comfyui'
}

export interface ScenePool {
  default: string        // 候选 id
  candidates: PoolCandidate[]
}

export type ScenePools = Record<'image' | 'video', ScenePool>

export interface PvAction {
  id: string
  label: string
  kind: 'image' | 'video'
  enabled: boolean
  scene: 'image' | 'video'
  /** 候选 id；空 = 用场景默认 */
  model: string
  prompt_template: string
}

const EMPTY_POOLS: ScenePools = {
  image: { default: '', candidates: [] },
  video: { default: '', candidates: [] },
}

let poolsCache: ScenePools | null = null
let actionsCache: PvAction[] | null = null
let poolsInflight: Promise<ScenePools> | null = null
let actionsInflight: Promise<PvAction[]> | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* 单个订阅者报错不影响其他 */
    }
  })
}

export function fetchScenePools(): Promise<ScenePools> {
  if (poolsCache) return Promise.resolve(poolsCache)
  if (poolsInflight) return poolsInflight
  poolsInflight = getScenePools()
    .then((res) => {
      const raw = (res.ok ? (res.data.pools as Partial<ScenePools>) : null) || {}
      const pools: ScenePools = {
        image: raw.image?.candidates ? (raw.image as ScenePool) : { default: '', candidates: [] },
        video: raw.video?.candidates ? (raw.video as ScenePool) : { default: '', candidates: [] },
      }
      poolsCache = pools
      notify()
      return pools
    })
    .catch(() => EMPTY_POOLS)
    .finally(() => {
      poolsInflight = null
    })
  return poolsInflight
}

export function fetchPvActions(): Promise<PvAction[]> {
  if (actionsCache) return Promise.resolve(actionsCache)
  if (actionsInflight) return actionsInflight
  actionsInflight = getPvActions()
    .then((res) => {
      const list: PvAction[] = (res.ok ? (res.data.actions as PvAction[]) : []) || []
      actionsCache = list
      notify()
      return list
    })
    .catch(() => [] as PvAction[])
    .finally(() => {
      actionsInflight = null
    })
  return actionsInflight
}

/** 设置里改过候选池/动作后手动刷新，所有画布节点同步拿到新值 */
export function bumpPools() {
  poolsCache = null
  actionsCache = null
  void fetchScenePools()
  void fetchPvActions()
}

export function useScenePools(): ScenePools {
  const [pools, setPools] = useState<ScenePools>(poolsCache ?? EMPTY_POOLS)
  useEffect(() => {
    const fn = () => setPools(poolsCache ?? EMPTY_POOLS)
    listeners.add(fn)
    if (poolsCache) setPools(poolsCache)
    else void fetchScenePools()
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return pools
}

export function usePvActions(kind?: 'image' | 'video'): PvAction[] {
  const [actions, setActions] = useState<PvAction[]>(actionsCache ?? [])
  useEffect(() => {
    const fn = () => setActions(actionsCache ?? [])
    listeners.add(fn)
    if (actionsCache) setActions(actionsCache)
    else void fetchPvActions()
    return () => {
      listeners.delete(fn)
    }
  }, [])
  if (!kind) return actions
  return actions.filter((a) => a.kind === kind && a.enabled)
}

/** 解析候选 id → 候选对象（两个池里找） */
export function resolveCandidate(pools: ScenePools, candidateId: string): PoolCandidate | null {
  if (!candidateId) return null
  for (const pool of [pools.image, pools.video]) {
    const hit = pool.candidates.find((c) => c.id === candidateId)
    if (hit) return hit
  }
  return null
}

/** 场景默认候选 */
export function defaultCandidate(pools: ScenePools, scene: 'image' | 'video'): PoolCandidate | null {
  return resolveCandidate(pools, pools[scene]?.default || '')
}
