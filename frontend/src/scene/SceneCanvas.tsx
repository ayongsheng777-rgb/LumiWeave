/**
 * 专业场景画布（规格书 §3 / §10）
 *
 * 布局：左场景侧边栏 · 中无限画布（含动态工具条）· 右动态 Inspector（抽屉）· 底部六页签工作栏
 * 全部对象走同一个 sceneObject 节点组件，具体长相由后端注册表决定。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Settings2, X, Loader2, Sparkles, Undo2, Redo2, Upload, Clapperboard } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { sceneNodeTypes } from './SceneObjectNode'
import { sceneFilmUpload, sceneFilmAnalyze } from '../api'
import SceneSidebar from './SceneSidebar'
import SceneToolbar from './SceneToolbar'
import SceneInspector from './SceneInspector'
import SceneBottomBar from './SceneBottomBar'

function SceneCanvasInner() {
  const objects = useSceneStore((s) => s.objects)
  const edges = useSceneStore((s) => s.edges)
  const onNodesChange = useSceneStore((s) => s.onNodesChange)
  const onEdgesChange = useSceneStore((s) => s.onEdgesChange)
  const onConnect = useSceneStore((s) => s.onConnect)
  const setSelected = useSceneStore((s) => s.setSelected)
  const addObject = useSceneStore((s) => s.addObject)
  const currentSceneId = useSceneStore((s) => s.currentSceneId)
  const typeDef = useSceneStore((s) => s.currentTypeDef())
  const loading = useSceneStore((s) => s.loading)
  const busy = useSceneStore((s) => s.busy)
  const undo = useSceneStore((s) => s.undo)
  const redo = useSceneStore((s) => s.redo)
  const canUndo = useSceneStore((s) => s.canUndo)
  const canRedo = useSceneStore((s) => s.canRedo)
  const loadAssets = useSceneStore((s) => s.loadAssets)
  const loadVersions = useSceneStore((s) => s.loadVersions)
  const { screenToFlowPosition } = useReactFlow()

  const [showInspector, setShowInspector] = useState(() => window.innerWidth >= 1100)
  const [filmBusy, setFilmBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // 响应式（§49 / P2-02）：窄屏自动收起 Inspector，窗口变窄时跟随
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1100) setShowInspector(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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
    try {
      const up = await sceneFilmUpload(currentSceneId, file)
      const url = up?.url || up?.data?.url
      if (!url) return
      const res = await sceneFilmAnalyze(currentSceneId, url)
      if (res.ok && res.data?.ok !== false) {
        await useSceneStore.getState().openScene(currentSceneId)
        await useSceneStore.getState().loadAssets()
      }
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
    <div className="flex h-full w-full">
      <SceneSidebar />

      <div className="relative min-w-0 flex-1" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
        {currentSceneId ? (
          <>
            <ReactFlow
              nodes={objects}
              edges={edges}
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
              <Background gap={24} size={1} />
              <Controls showInteractive={false} className="!bottom-16" />
              <MiniMap
                pannable
                zoomable
                className="!bottom-16 !border !border-edge !bg-panel"
                nodeColor={(n) =>
                  String(
                    useSceneStore.getState().metaOf(String(n.data?.objectType || '')).color ||
                      '#64748b',
                  )
                }
              />
            </ReactFlow>

            <SceneToolbar />

            {/* 左下：撤销/重做 + 影视拆镜上传（§32/§68） */}
            <div className="absolute bottom-24 left-3 z-20 flex items-center gap-1.5">
              <button
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-edge bg-panel/90 text-ink-2 shadow-node-dark backdrop-blur-md transition enabled:hover:text-ink disabled:opacity-40"
                onClick={undo}
                disabled={!canUndo}
                title="撤销 (Ctrl+Z)"
              >
                <Undo2 size={15} />
              </button>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-edge bg-panel/90 text-ink-2 shadow-node-dark backdrop-blur-md transition enabled:hover:text-ink disabled:opacity-40"
                onClick={redo}
                disabled={!canRedo}
                title="重做 (Ctrl+Shift+Z)"
              >
                <Redo2 size={15} />
              </button>
              {isFilmScene && (
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
              )}
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
            </div>

            {/* 右上：Inspector 开关 */}
            <button
              className={`absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-lg border border-edge bg-panel/90 shadow-node-dark backdrop-blur-md transition ${
                showInspector ? 'text-brand-500' : 'text-ink-2 hover:text-ink'
              }`}
              onClick={() => setShowInspector(!showInspector)}
              title="属性面板"
            >
              <Settings2 size={17} />
            </button>

            {/* 右侧 Inspector 抽屉 */}
            {showInspector && (
              <div className="absolute right-3 top-14 z-20 flex h-[calc(100%-8rem)] w-64 flex-col overflow-hidden rounded-2xl border border-edge bg-panel/95 shadow-node-dark backdrop-blur-md">
                <button
                  className="absolute right-2 top-2 z-10 rounded p-0.5 text-ink-3 transition hover:text-ink"
                  onClick={() => setShowInspector(false)}
                >
                  <X size={13} />
                </button>
                <SceneInspector />
              </div>
            )}

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
