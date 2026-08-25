import { type NodeProps } from '@xyflow/react'
import { Clapperboard, Plus, RefreshCw, Zap, Link2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNodeAdapter } from '../../store/nodeAdapter'
import { NodeShell } from './NodeShell'
import { ShotGenerator, type Shot } from './ShotGenerator'
import { filmStoryboardGenerate } from '../../api'
import { emitLog } from '../LogPanel'
import { subscribeShotJump } from '../ShotChainPanel'

// 从上游 StoryNode data 中读取生成的图片 URL
interface StoryNodeData {
  characters?: { id: string; name: string; description: string; prompt: string }[]
  scenes?:    { id: string; name: string; location: string; description: string; prompt: string }[]
  props?:     { id: string; name: string; description: string; prompt: string }[]
  shots?:     { shot: number; character_ids?: string[]; scene_ids?: string[]; camera?: string; duration?: number; description?: string; prompt?: string }[]
  character_urls?: Record<string, string>
  scene_urls?:    Record<string, string>
  prop_urls?:     Record<string, string>
  video_mode?: string
}

export function StoryboardNode({ id, data, selected }: NodeProps) {
  const adapter = useNodeAdapter()
  const { update, getNodes, getEdges } = adapter as {
    update: (id: string, data: Record<string, unknown>) => void
    getNodes: () => { id: string; type?: string; data: Record<string, unknown> }[]
    getEdges: () => { target: string; source: string }[]
  }

  const d = data as Record<string, unknown>
  const shots = ((d.shots as Shot[]) || (d.storyboard as Shot[]) || []) as Shot[]

  const ratio = String(d.ratio ?? '16:9')
  const style = String(d.style ?? '电影感')
  const total_duration = Number(d.total_duration ?? shots.reduce((sum, s) => sum + (s.duration || 3), 0))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [jumpTarget, setJumpTarget] = useState<{ index: number; signal: number } | null>(null)
  const [linkedStory, setLinkedStory] = useState<StoryNodeData | null>(null)
  const shotRefs = useRef<Record<number, HTMLDivElement | null>>({})

  // 订阅「下一分镜」跳转请求
  useEffect(() => {
    const unsub = subscribeShotJump((nid, shotIndex) => {
      if (nid !== id) return
      setJumpTarget({ index: shotIndex, signal: Date.now() })
      const el = shotRefs.current[shotIndex]
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return unsub
  }, [id])

  // ── 自动联动上游 StoryNode：读取图片 URL 填入 shots ─────────────────────────
  const autoLinkStoryNode = () => {
    const allNodes = getNodes()
    const allEdges = getEdges()
    const upstreamIds = allEdges.filter((e) => e.target === id).map((e) => e.source)
    const storyNode = allNodes.find((n) => upstreamIds.includes(n.id) && n.type === 'story')
    if (!storyNode) { setLinkedStory(null); return }
    const sd = storyNode.data as StoryNodeData
    setLinkedStory(sd)

    const charUrls = sd.character_urls || {}
    const sceneUrls = sd.scene_urls || {}
    const propUrls = sd.prop_urls || {}

    if (shots.length > 0 && sd.shots && sd.shots.length > 0) {
      // 有旧分镜：把图片 URL 填入现有 shots
      const updatedShots: Shot[] = shots.map((s, i) => {
        const parsedShot = sd.shots![i]
        if (!parsedShot) return s
        const refs: string[] = []
        ;(parsedShot.character_ids || []).forEach((cid: string) => { if (charUrls[cid]) refs.push(charUrls[cid]) })
        ;(parsedShot.scene_ids    || []).forEach((sid: string) => { if (sceneUrls[sid]) refs.push(sceneUrls[sid]) })
        ;(parsedShot as Record<string, unknown>).props?.toString().split(',').forEach((pid: string) => {
          const trimmed = pid.trim()
          if (trimmed && propUrls[trimmed]) refs.push(propUrls[trimmed])
        })
        const imageUrl = refs[0] || ''
        return {
          ...s,
          prompt: parsedShot.prompt || s.prompt,
          camera: parsedShot.camera || s.camera,
          duration: parsedShot.duration || s.duration,
          reference_images: refs,
          image_url: imageUrl,
          video_mode: sd.video_mode || s.video_mode,
        } as Shot
      })
      update(id, { shots: updatedShots, storyboard: updatedShots })
      emitLog({ nodeId: id, nodeLabel: '电影分镜', nodeType: 'storyboard', status: 'running', message: `联动成功 · ${refsFromShots(updatedShots).size}张参考图填入${updatedShots.length}个分镜` })
    } else if (sd.shots && sd.shots.length > 0) {
      // 无旧分镜：用 StoryNode 的 shots 直接初始化
      const newShots: Shot[] = sd.shots.map((s) => {
        const refs: string[] = []
        ;(s.character_ids || []).forEach((cid: string) => { if (charUrls[cid]) refs.push(charUrls[cid]) })
        ;(s.scene_ids    || []).forEach((sid: string) => { if (sceneUrls[sid]) refs.push(sceneUrls[sid]) })
        ;(s as Record<string, unknown>).props?.toString().split(',').forEach((pid: string) => {
          const trimmed = pid.trim()
          if (trimmed && propUrls[trimmed]) refs.push(propUrls[trimmed])
        })
        const imageUrl = refs[0] || ''
        return {
          shot: s.shot,
          camera: s.camera || 'medium shot',
          duration: s.duration || 3,
          description: s.description || '',
          prompt: s.prompt || '',
          reference_images: refs,
          image_url: imageUrl,
          video_mode: sd.video_mode || 'multi_ref',
          output_type: 'video',
          gen_status: 'idle',
        } as Shot
      })
      update(id, { shots: newShots, storyboard: newShots, video_mode: sd.video_mode || 'multi_ref' })
      emitLog({ nodeId: id, nodeLabel: '电影分镜', nodeType: 'storyboard', status: 'running', message: `联动成功 · 从故事节点导入${newShots.length}个分镜` })
    }
  }

  // 监听连线变化（当新的 StoryNode 连上来时触发联动）
  useEffect(() => {
    autoLinkStoryNode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addShot = () => {
    const next: Shot[] = [...shots, { shot: shots.length + 1, camera: 'medium shot', duration: 3, description: '', prompt: '', gen_status: 'idle' }]
    update(id, { shots: next })
  }

  const updateShot = (idx: number, patch: Partial<Shot>) => {
    const next = shots.map((s, i) => i === idx ? { ...s, ...patch } : s) as Shot[]
    update(id, { shots: next })
  }

  const removeShot = (idx: number) => {
    const next = shots.filter((_, i) => i !== idx).map((s, i) => ({ ...s, shot: i + 1 })) as Shot[]
    update(id, { shots: next })
  }

  const genStoryboard = async () => {
    setBusy(true); setError('')
    emitLog({ nodeId: id, nodeLabel: '电影分镜', nodeType: 'storyboard', status: 'running', message: 'AI 生成分镜表…' })
    const t0 = Date.now()
    try {
      const allNodes = getNodes()
      const allEdges = getEdges()
      const upstreamIds = allEdges.filter((e) => e.target === id).map((e) => e.source)
      const storyNode = allNodes.find((n) => upstreamIds.includes(n.id) && n.type === 'story')
      const sd = storyNode ? storyNode.data as StoryNodeData : {}
      const chars  = (sd.characters as unknown[]) || []
      const scenes = (sd.scenes    as unknown[]) || []

      const res = await filmStoryboardGenerate({
        characters_json: JSON.stringify(chars),
        scenes_json:    JSON.stringify(scenes),
        story_text:     String(sd && (sd as Record<string, unknown>).text ? (sd as Record<string, unknown>).text : ''),
        genre: String(sd && (sd as Record<string, unknown>).genre || '科幻'),
        style,
        ratio,
        total_duration,
      })

      if (res.ok !== false && res.data?.shots) {
        update(id, { shots: res.data.shots, storyboard: res.data.shots, total_duration: res.data.total_duration ?? total_duration })
        emitLog({ nodeId: id, nodeLabel: '电影分镜', nodeType: 'storyboard', status: 'completed', message: `分镜生成完成 · ${(res.data.shots as unknown[]).length} 个镜头`, duration: Date.now() - t0 })
      } else {
        const err = String(res.error || '生成失败')
        setError(err)
        emitLog({ nodeId: id, nodeLabel: '电影分镜', nodeType: 'storyboard', status: 'failed', message: `分镜生成失败 · ${err.slice(0, 60)}`, detail: err })
      }
    } catch (e) {
      setError(String(e))
      emitLog({ nodeId: id, nodeLabel: '电影分镜', nodeType: 'storyboard', status: 'failed', message: `分镜生成失败 · ${String(e).slice(0, 60)}` })
    } finally {
      setBusy(false)
    }
  }

  const doneCount = shots.filter((s) => s.gen_status === 'done').length
  const linkedRefCount = shots.reduce((sum, s) => sum + ((s.reference_images as string[]) || []).length, 0)

  return (
    <NodeShell id={id} selected={selected} title="电影分镜" icon={<Clapperboard size={15} />}>
      <div className="mb-2 flex items-center justify-between text-[11px] text-ink-3">
        <span>{shots.length} 个镜头</span>
        <span>总时长 {shots.reduce((sum, s) => sum + (s.duration || 3), 0)}s</span>
        {doneCount > 0 && <span className="text-green-400">已生成 {doneCount}/{shots.length}</span>}
        {linkedRefCount > 0 && <span className="text-brand-400 flex items-center gap-0.5"><Link2 size={9} />{linkedRefCount}张参考图</span>}
      </div>

      {error && <div className="mb-2 rounded bg-status-failed/10 px-2 py-1 text-[11px] text-status-failed">{error}</div>}

      {/* 联动状态栏 */}
      {linkedStory && (
        <div className="mb-2 flex items-center gap-1.5 rounded bg-brand-500/10 px-2 py-1.5 text-[11px] text-brand-400">
          <Link2 size={10} />
          <span>已联动「故事输入」节点</span>
          <span className="ml-auto text-[10px] text-ink-3">
            {Object.keys(linkedStory.character_urls || {}).length}角色 /
            {Object.keys(linkedStory.scene_urls    || {}).length}场景 /
            {Object.keys(linkedStory.prop_urls     || {}).length}道具
          </span>
        </div>
      )}
      {!linkedStory && shots.length === 0 && (
        <div className="mb-2 rounded bg-soft px-2 py-1.5 text-[11px] text-ink-3">
          💡 把「故事输入」节点连线到本节点，即可自动导入分镜并填入参考图
        </div>
      )}

      <div className="space-y-1.5">
        {shots.map((s, i) => (
          <div key={i} ref={(el) => { shotRefs.current[i] = el }}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-brand-400">
                SHOT {String(s.shot).padStart(2, '0')}
                {((s.reference_images as string[]) || []).length > 0 && (
                  <span className="ml-1 text-[9px] text-ink-3">📎{((s.reference_images as string[]) || []).length}图</span>
                )}
              </span>
              <button className="text-[10px] text-red-400 hover:text-red-300" onClick={() => removeShot(i)}>删除</button>
            </div>
            <ShotGenerator
              shot={s}
              index={i}
              totalShots={shots.length}
              nodeId={id}
              nodeLabel="电影分镜"
              onUpdate={(patch) => updateShot(i, patch)}
              autoGenSignal={jumpTarget?.index === i ? jumpTarget.signal : 0}
            />
          </div>
        ))}
      </div>

      <button className="nodrag mt-1 w-full rounded-md border border-dashed border-edge bg-soft py-1.5 text-[11px] text-ink-3 hover:border-brand-400 hover:text-brand-400 transition"
        onClick={addShot}>
        <Plus size={11} className="mr-1 inline" />添加镜头
      </button>

      <div className="mt-2 flex gap-1.5">
        <button className="nodrag flex-1 flex items-center justify-center gap-1 rounded-lg bg-brand-600 px-2 py-2 text-sm text-white transition hover:bg-brand-500 disabled:opacity-50"
          onClick={busy ? undefined : genStoryboard} disabled={busy}>
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
          {busy ? '生成中…' : 'AI 生成分镜'}
        </button>
        {linkedStory && (
          <button className="nodrag flex items-center justify-center gap-1 rounded-lg border border-brand-500 bg-brand-500/10 px-2 py-2 text-sm text-brand-400 transition hover:bg-brand-500/20"
            onClick={autoLinkStoryNode} title="从故事节点重新导入参考图">
            <Zap size={13} />
          </button>
        )}
      </div>
    </NodeShell>
  )
}

// 工具函数：从 shots 数组提取所有参考图 URL（去重）
function refsFromShots(shots: Shot[]): Set<string> {
  const urls = new Set<string>()
  shots.forEach((s) => ((s.reference_images as string[]) || []).forEach((u) => urls.add(u)))
  return urls
}
