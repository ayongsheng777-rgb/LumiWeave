// 模型档位（profile）列表：整个画布共享一份缓存，避免每个生成节点各请求一次
import { useEffect, useState } from 'react'
import { getProfiles } from '../api'
import type { ContentType } from './types'

export interface Profile {
  id: string
  name: string
  model: string
  provider: string
  description: string
  scenario: string
  scenes?: string[]
  scene_models?: Record<string, string>
}

let cache: Profile[] | null = null
let inflight: Promise<Profile[]> | null = null
/** 订阅者：模型库刷新后通知所有在用节点重渲染 */
const listeners = new Set<(list: Profile[]) => void>()

function notify(list: Profile[]) {
  listeners.forEach((fn) => {
    try {
      fn(list)
    } catch {
      /* 单个订阅者报错不影响其他节点 */
    }
  })
}

/** 拉取模型档位（带进程内缓存） */
export function fetchProfiles(): Promise<Profile[]> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = getProfiles()
    .then((res) => {
      const list: Profile[] = (res.ok ? (res.data.profiles as Profile[]) : []) || []
      cache = list
      notify(list)
      return list
    })
    .catch(() => [] as Profile[])
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** 内容形态 → 后端 scenes 里的候选取值 */
const SCENE_KEYS: Record<ContentType, string[]> = {
  image: ['image', 'text2image', 'image2image'],
  video: ['video'],
  audio: ['audio'],
  text: ['prompt', 'general'],
}

/** 取可用于某种内容形态的模型档位 */
export function useProfiles(contentType: ContentType): Profile[] {
  const [all, setAll] = useState<Profile[]>(cache ?? [])

  useEffect(() => {
    const fn = (list: Profile[]) => setAll(list)
    listeners.add(fn)
    if (cache) setAll(cache)
    else void fetchProfiles()
    return () => {
      listeners.delete(fn)
    }
  }, [])

  const keys = SCENE_KEYS[contentType] ?? []
  return all.filter((p) => {
    const scenes = p.scenes ?? []
    if (scenes.length === 0) return true // 没标场景的老配置，当作通用可用
    return scenes.some((s) => keys.includes(s))
  })
}

/** 模型库改过之后手动刷新，所有节点会同步拿到新列表 */
export function bumpProfiles() {
  cache = null
  void fetchProfiles()
}
