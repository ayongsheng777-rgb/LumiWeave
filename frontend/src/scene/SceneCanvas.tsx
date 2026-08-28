/**
 * 专业场景画布（规格书 §3 / §10）
 *
 * 布局：左场景侧边栏 · 中无限画布（含动态工具条）· 右动态 Inspector（抽屉）· 底部六页签工作栏
 * 全部对象走同一个 sceneObject 节点组件，具体长相由后端注册表决定。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Loader2, Sparkles, Upload, Clapperboard } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { sceneNodeTypes } from './SceneObjectNode'
import { sceneFilmUpload, sceneFilmAnalyze } from '../api'
import { nodeInstanceColor } from './sceneColors'
import SceneSidebar from './SceneSidebar'
import SceneToolbar from './SceneToolbar'
import SceneBottomBar from './SceneBottomBar'
import SceneNodeModal from './SceneNodeModal'
import SceneTemplateMarket from './SceneTemplateMarket'

type AnyObj = Record<string, unknown>

function SceneCanvasInner() {
  const objects = useSceneStore((s) => s.objects)
  const edges = useSceneStore((s) => s.edges)
  const objectStatus = useSceneStore((s) => s.objectStatus)
  const onNodesChange = useSceneStore((s) => s.onNodesChange)
  const onEdgesChange = useSceneStore((s) => s.onEdgesChange)
  const onConnect = useSceneStore((s) => s.onConnect)
  const setSelected = useSceneStore((s) => s.setSelected)
  const addObject = useSceneStore((s) => s.addObject)
  const currentSceneId = useSceneStore((s) => s.currentSceneId)
  const typeDef = useSceneStore((s) => s.currentTypeDef())
  const loading = useSceneStore((s) => s.loading)
  const busy = useSceneStore((s) => s.busy)
  const loadAssets = useSceneStore((s) => s.loadAssets)
  const loadVersions = useSceneStore((s) => s.loadVersions)
  const undo = useSceneStore((s) => s.undo)
  const redo = useSceneStore((s) => s.redo)
  const { screenToFlowPosition } = useReactFlow()

  // 语义连线（V2.8）：每条边用 source 节点实例色；端点节点运行中时加蚂蚁线动画
  const coloredEdges = useMemo(() => {
    const byId = new Map(objects.map((o) => [o.id, o]))
    return edges.map((e) => {
      const src = byId.get(e.source)
      const srcType = String(((src?.data as AnyObj)?.objectType) || 'text')
      const srcMeta = useSceneStore.getState().metaOf(srcType)
      const color = nodeInstanceColor(srcType, e.source, srcMeta.color)
      const running = objectStatus[e.source] === 'running' || objectStatus[e.target] === 'running'
      return {
        ...e,
        style: { ...(e.style || {}), stroke: color, strokeWidth: 2.5 },
        className: running ? 'scene-edge-anim' : undefined,
      }
    })
  }, [edges, objects, objectStatus])

  const [filmBusy, setFilmBusy] = useState(false)
  const [filmErr, setFilmErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // 切换场景时加载素材库与版本列表（§35/§38）
  useEffect(() => {
    if (currentSceneId) {
      void loadAssets()
      void loadVersions()
    }
  }, [currentSceneId, loadAssets, loadVersions])

  // 撤销/重做快捷键（§32）：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 或 Ctrl+Y 重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (k === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // 影视拉片：上传视频 → 自动拆镜（§68）
  const handleFilmUpload = async (file: File) => {
    if (!currentSceneId) return
    setFilmBusy(true)
    setFilmErr('')
    try {
      const up = await sceneFilmUpload(currentSceneId, file)
      const url = up?.data?.url
      if (!url || up?.ok === false) {
        setFilmErr(up?.data?.error || up?.data?.message || '视频上传失败（请确认已登录 / 文件格式为 mp4/webm/mov/m4v）')
        return
      }
      const res = await sceneFilmAnalyze(currentSceneId, url)
      if (res.ok && res.data?.ok !== false) {
        await useSceneStore.getState().openScene(currentSceneId)
        await useSceneStore.getState().loadAssets()
      } else {
        setFilmErr(String(res.data?.error || '拆镜失败：视频解析异常（请检查 ffmpeg / 网络）'))
      }
    } catch (e) {
      setFilmErr(`上传/拆镜异常：${String(e)}`)
    } finally {
      setFilmBusy(false)
    }
  }

  const isFilmScene = typeDef?.category === 'film'

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/lumiweave-scene-object')
      if (!type) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      void addObject(type, position)
    },
    [screenToFlowPosition, addObject],
  )

  return (
    <div className="lw-canvas-bg flex h-full w-full">
      <SceneSidebar />

      <div className="relative min-w-0 flex-1" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>        {currentSceneId ? (
          <>
            <ReactFlow
              nodes={objects}
              edges={coloredEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={({ nodes: sel }) => setSelected(sel.map((n) => n.id))}
              nodeTypes={sceneNodeTypes}
              fitView
              minZoom={0.1}
              maxZoom={2.5}
              deleteKeyCode={['Backspace', 'Delete']}
              selectionOnDrag
              multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} size={1} color="var(--lw-canvas-dot)" />
              <Controls showInteractive={false} className="!bottom-16" />
              <MiniMap
                pannable
                zoomable
                className="!bottom-16"
                nodeColor={(n) =>
                  String(
                    useSceneStore.getState().metaOf(String(n.data?.objectType || '')).color ||
                      '#64748b',
                  )
                }
              />
            </ReactFlow>

            <SceneToolbar />

            {/* 影视拆镜上传（§68）：放在缩放控件右侧，避免与底部栏/控件重叠 */}
            {isFilmScene && (
              <div className="absolute bottom-24 left-14 z-20">
                <button
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-brand-500/40 bg-panel/90 px-3 text-[11px] text-brand-500 shadow-node-dark backdrop-blur-md transition hover:bg-panel disabled:opacity-50"
                  onClick={() => fileRef.current?.click()}
                  disabled={filmBusy || !!busy}
                  title="上传 MP4 → 自动拆镜 → 视觉分析"
                >
                  {filmBusy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Clapperboard size={13} />
                  )}
                  <Upload size={13} />
                  {filmBusy ? '拆镜中…' : '上传视频拆镜'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="video/*,.mp4,.webm,.mov,.m4v"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void handleFilmUpload(f)
                    e.target.value = ''
                  }}
                />
                {filmErr && (
                  <div className="mt-1.5 max-w-[260px] rounded-md border border-red-400/40 bg-red-400/10 px-2 py-1 text-[10px] leading-snug text-red-400">
                    {filmErr}
                  </div>
                )}
              </div>
            )}

            {/* 右侧属性面板已移除：所有编辑交互已迁移到节点上（含 AI 对话弹窗） */}

            <SceneBottomBar />

            {/* 执行中遮罩提示 */}
            {busy && (
              <div className="pointer-events-none absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-edge bg-panel/95 px-3 py-1.5 text-[11px] text-ink shadow-node-dark backdrop-blur-md">
                <Loader2 size={13} className="animate-spin text-brand-500" />
                正在执行：{busy}
              </div>
            )}
          </>
        ) : (
          /* 空态：引导新建场景 */
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            {loading ? (
              <>
                <Loader2 size={22} className="animate-spin text-brand-500" />
                <span className="text-xs text-ink-3">正在加载场景…</span>
              </>
            ) : (
              <>
                <Sparkles size={26} className="text-brand-500" />
                <div className="text-sm text-ink">还没有打开任何场景</div>
                <div className="max-w-xs text-[11px] leading-relaxed text-ink-3">
                  在左侧选一个专业场景模板新建：
                  <br />
                  电商商品营销物料 · 电商短剧带货 · 影视拉片
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 场景描述条（顶部居中，仅有场景时显示） */}
      {currentSceneId && typeDef && (
        <div className="pointer-events-none absolute left-1/2 top-1 z-10 max-w-md -translate-x-1/2 truncate rounded-full bg-panel/70 px-3 py-1 text-[10px] text-ink-3 backdrop-blur-md">
          {typeDef.description}
        </div>
      )}

      {/* 编辑弹窗（V2.8：内容优先，编辑收敛到弹窗） */}
      <SceneNodeModal />

      {/* 营销模板市场（电商物料场景：按平台分类一键铺入） */}
      {currentSceneId && typeDef?.id === 'ecommerce-material' && (
        <div className="absolute bottom-24 right-4 z-20">
          <SceneTemplateMarket />
        </div>
      )}
    </div>
  )
}

export default function SceneCanvas() {
  return (
    <ReactFlowProvider>
      <SceneCanvasInner />
    </ReactFlowProvider>
  )
}
