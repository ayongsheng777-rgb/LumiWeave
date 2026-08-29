/**
 * 场景工具条（规格书 §11 动态工具条）
 *
 * 只显示当前场景注册的对象类型（object_types），切换场景即换一套工具。
 * 支持点击添加与拖入画布两种方式。
 * V2.6：节点精简为 7 类；底部集成三个资源入口（上传网络资源 / 从本地上传 / 从资产选择）。
 */
import { useRef, useState } from 'react'
import {
  MousePointer2, Type, ShoppingBag, ImageIcon, Film, Music, BookOpen,
  Clapperboard, ClipboardList, Undo2, Redo2, Link2, Upload, FolderOpen, Loader2, X,
  LayoutGrid, Square,
} from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { uploadImage } from '../api'

/** 对象类型 → 图标（注册表没覆盖到的类型统一给个兜底图标） */
const ICONS: Record<string, React.ReactNode> = {
  select: <MousePointer2 size={16} />,
  text: <Type size={16} />,
  product: <ShoppingBag size={16} />,
  story: <BookOpen size={16} />,
  image: <ImageIcon size={16} />,
  video: <Film size={16} />,
  audio: <Music size={16} />,
  director: <Clapperboard size={16} />,
  storyboard: <ClipboardList size={16} />,
  group: <Square size={16} />,
}

/** 上传资源类型 → 场景对象类型 */
const NET_TYPES = ['image', 'video', 'audio'] as const

export default function SceneToolbar() {
  const typeDef = useSceneStore((s) => s.currentTypeDef())
  const metaOf = useSceneStore((s) => s.metaOf)
  const addObject = useSceneStore((s) => s.addObject)
  const patchObject = useSceneStore((s) => s.patchObject)
  const loadAssets = useSceneStore((s) => s.loadAssets)
  const assets = useSceneStore((s) => s.assets)
  const currentSceneId = useSceneStore((s) => s.currentSceneId)
  const undo = useSceneStore((s) => s.undo)
  const redo = useSceneStore((s) => s.redo)
  const canUndo = useSceneStore((s) => s.canUndo)
  const canRedo = useSceneStore((s) => s.canRedo)
  const autoLayout = useSceneStore((s) => s.autoLayout)
  const storeBusy = useSceneStore((s) => s.busy)

  const [menu, setMenu] = useState<'net' | 'local' | 'asset' | null>(null)
  const [netUrl, setNetUrl] = useState('')
  const [netType, setNetType] = useState<(typeof NET_TYPES)[number]>('image')
  const [busy, setBusy] = useState(false)
  const [layoutBusy, setLayoutBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!currentSceneId || !typeDef) return null

  const onAutoLayout = async () => {
    if (layoutBusy) return
    setLayoutBusy(true)
    try {
      await autoLayout()
    } finally {
      setLayoutBusy(false)
    }
  }

  const addWithUrl = async (type: string, url: string) => {
    // 🔴 不读 selectedIds：新节点不带 selected 标记，React Flow 的 onSelectionChange
    // 会在 addObject 之后立刻把 selectedIds 清空，导致 url 挂不上（画布空白节点）
    const nid = await addObject(type, useSceneStore.getState().nextObjectPos())
    if (nid) patchObject(nid, { url })
  }

  const onNetAdd = async () => {
    if (!netUrl.trim() || busy) return
    setBusy(true)
    await addWithUrl(netType, netUrl.trim())
    setBusy(false)
    setNetUrl('')
    setMenu(null)
  }

  const onLocalFile = async (file: File) => {
    if (!file || busy) return
    setBusy(true)
    const res = await uploadImage(file, currentSceneId || undefined)
    setBusy(false)
    if (res.ok) {
      const url = String((res.data as { url?: string } | undefined)?.url ?? '')
      if (url) {
        const type = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'image'
        await addWithUrl(type, url)
      }
    }
    setMenu(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const onAssetPick = async (asset: { type?: string; url: string }) => {
    const t = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image'
    await addWithUrl(t, asset.url)
    setMenu(null)
  }

  return (
    <div className="pointer-events-auto absolute left-3 top-3 z-20 flex flex-col items-center gap-1 rounded-2xl border border-[var(--lw-glass-edge)] bg-[var(--lw-glass-bg)] px-1.5 py-2 shadow-node-dark backdrop-blur-md">
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
            onClick={() => void addObject(t, useSceneStore.getState().nextObjectPos())}
            className="flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-hover active:scale-95"
            style={{ color: meta.color }}
          >
            {ICONS[t] || <Type size={16} />}
          </button>
        )
      })}

      {/* 撤销/重做 */}
      <div className="mt-1 flex flex-col items-center gap-1 border-t border-edge pt-1.5">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 transition hover:bg-hover hover:text-ink disabled:opacity-40"
          onClick={undo}
          disabled={!canUndo}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 size={15} />
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 transition hover:bg-hover hover:text-ink disabled:opacity-40"
          onClick={redo}
          disabled={!canRedo}
          title="重做 (Ctrl+Shift+Z)"
        >
          <Redo2 size={15} />
        </button>
      </div>

      {/* 一键排列（三场景通用）：血缘分层 + 同类成列，顺带补齐缺失连线 */}
      <div className="mt-1 flex flex-col items-center gap-1 border-t border-edge pt-1.5">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 transition hover:bg-hover hover:text-brand-400 disabled:opacity-40"
          onClick={() => void onAutoLayout()}
          disabled={layoutBusy || !!storeBusy}
          title="一键排列：按血缘自动分层排整齐，并补齐缺失的连线（可 Ctrl+Z 撤销）"
        >
          {layoutBusy ? <Loader2 size={15} className="animate-spin" /> : <LayoutGrid size={15} />}
        </button>
      </div>

      {/* 三个资源入口（V2.6）：网络 / 本地 / 资产 */}
      <div className="mt-1 flex flex-col items-center gap-1 border-t border-edge pt-1.5">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 transition hover:bg-hover hover:text-brand-400"
          onClick={() => { setMenu(menu === 'net' ? null : 'net'); if (menu !== 'net') void loadAssets() }}
          title="上传网络资源（粘贴图片/视频/音频 URL）"
        >
          <Link2 size={14} />
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 transition hover:bg-hover hover:text-brand-400"
          onClick={() => setMenu(menu === 'local' ? null : 'local')}
          title="从本地上传文件"
        >
          <Upload size={14} />
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 transition hover:bg-hover hover:text-brand-400"
          onClick={() => { setMenu(menu === 'asset' ? null : 'asset'); if (menu !== 'asset') void loadAssets() }}
          title="从资产库选择"
        >
          <FolderOpen size={14} />
        </button>
      </div>

      {/* 浮层：向右展开 */}
      {menu && (
        <div className="absolute left-full top-0 z-30 ml-2 w-64 rounded-xl border border-[var(--lw-glass-edge)] bg-[var(--lw-glass-bg)] p-3 shadow-node-dark backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink">
              {menu === 'net' ? '上传网络资源' : menu === 'local' ? '从本地上传' : '从资产选择'}
            </span>
            <button className="text-ink-3 hover:text-ink" onClick={() => setMenu(null)}>
              <X size={13} />
            </button>
          </div>

          {menu === 'net' && (
            <div className="space-y-2">
              <select
                className="w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none"
                value={netType}
                onChange={(e) => setNetType(e.target.value as typeof netType)}
              >
                {NET_TYPES.map((t) => (
                  <option key={t} value={t}>{metaOf(t).label}</option>
                ))}
              </select>
              <input
                className="w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3"
                placeholder="粘贴图片/视频/音频 URL…"
                value={netUrl}
                onChange={(e) => setNetUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onNetAdd()}
              />
              <button
                className="flex w-full items-center justify-center gap-1 rounded-md bg-brand-500 py-1.5 text-sm text-white transition hover:bg-brand-600 disabled:opacity-40"
                onClick={onNetAdd}
                disabled={busy || !netUrl.trim()}
              >
                {busy && <Loader2 size={12} className="animate-spin" />} 添加到画布
              </button>
            </div>
          )}

          {menu === 'local' && (
            <div className="space-y-2">
              <button
                className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-edge bg-soft py-3 text-sm text-ink-2 transition hover:border-brand-400 hover:text-brand-400"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {busy ? '上传中…' : '选择文件（图片/视频/音频）'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*,audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onLocalFile(f)
                }}
              />
            </div>
          )}

          {menu === 'asset' && (
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {assets.length === 0 && <div className="py-2 text-center text-xs text-ink-3">资产库为空（先去生成或上传）</div>}
              {assets.map((a) => (
                <button
                  key={a.id}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-ink-2 transition hover:bg-hover"
                  onClick={() => void onAssetPick(a)}
                  title={a.url}
                >
                  <span className="h-6 w-6 shrink-0 overflow-hidden rounded bg-soft">
                    {a.type === 'audio' ? (
                      <Music size={12} className="mx-auto mt-1.5 text-ink-3" />
                    ) : (
                      <img src={a.url} alt="" className="h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{a.name || a.url}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
