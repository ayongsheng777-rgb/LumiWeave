/**
 * 场景工具条（规格书 §11 动态工具条）
 *
 * 只显示当前场景注册的对象类型（object_types），切换场景即换一套工具。
 * 支持点击添加与拖入画布两种方式。
 */
import {
  MousePointer2, Type, ShoppingBag, ImageIcon, Film, Music, FileText,
  StickyNote, Group, Crosshair, Search, Star, User, Mountain,
  Clapperboard, Video, Layers, Package, Palette, Sparkles,
} from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'

/** 对象类型 → 图标（注册表没覆盖到的类型统一给个兜底图标） */
const ICONS: Record<string, React.ReactNode> = {
  select: <MousePointer2 size={16} />,
  text: <Type size={16} />,
  product: <ShoppingBag size={16} />,
  image: <ImageIcon size={16} />,
  video: <Film size={16} />,
  audio: <Music size={16} />,
  prompt: <FileText size={16} />,
  note: <StickyNote size={16} />,
  group: <Group size={16} />,
  reference: <Crosshair size={16} />,
  analysis: <Search size={16} />,
  result: <Star size={16} />,
  poster: <Palette size={16} />,
  material: <Package size={16} />,
  story: <FileText size={16} />,
  character: <User size={16} />,
  scene: <Mountain size={16} />,
  storyboard: <Clapperboard size={16} />,
  shot: <Video size={16} />,
  frame: <Layers size={16} />,
  workflow: <Sparkles size={16} />,
}

export default function SceneToolbar() {
  const typeDef = useSceneStore((s) => s.currentTypeDef())
  const metaOf = useSceneStore((s) => s.metaOf)
  const addObject = useSceneStore((s) => s.addObject)
  const currentSceneId = useSceneStore((s) => s.currentSceneId)

  if (!currentSceneId || !typeDef) return null

  return (
    <div className="pointer-events-auto absolute left-3 top-3 z-20 flex flex-col items-center gap-1 rounded-2xl border border-edge bg-panel/90 px-1.5 py-2 shadow-node-dark backdrop-blur-md">
      <div className="mb-0.5 max-w-[52px] truncate text-center text-[9px] text-ink-3" title={typeDef.name}>
        {typeDef.name}
      </div>
      {typeDef.object_types.map((t) => {
        const meta = metaOf(t)
        return (
          <button
            key={t}
            title={`${meta.label}（点击添加，或拖到画布）`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/lumiweave-scene-object', t)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onClick={() => void addObject(t, { x: 120 + Math.random() * 200, y: 120 + Math.random() * 160 })}
            className="flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-hover active:scale-95"
            style={{ color: meta.color }}
          >
            {ICONS[t] || <Star size={16} />}
          </button>
        )
      })}
    </div>
  )
}
