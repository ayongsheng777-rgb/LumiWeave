// =====================================================================
// 节点悬浮工具栏（对标 PixVerse：选中媒体节点后浮在上方的一排动作）
// 图片：智能生成▾ / 多角度 / 打光 / 智能编辑 / 快速拆分▾ / 裁剪 / 上传 / 下载 / 全屏
// 视频：截帧▾ / 上传 / 下载 / 全屏
// 智能动作 = 新建图生图节点 + 连线 + 预填模板 + 弹 composer（不自动跑）。
// 剔除（做不到的，不留入口）：画质增强 / 音频分离 / 深度图 / 片段重拍 / 片段截取 / 视频解析。
// =====================================================================
import { useState } from 'react'
import {
  Camera,
  ChevronDown,
  Download,
  Expand,
  Grid3X3,
  Scissors,
  Sparkles,
  Sun,
  Upload,
  Wand2,
} from 'lucide-react'
import { usePvStore } from './store'
import { usePvDialogs } from './dialogStore'
import { usePvActions, useScenePools } from './pools'
import { downloadMedia, extractFrameToNode, runSmartAction, splitImageNode } from './actions'
import type { PvNodeData } from './types'
import { useUiStore } from '../store/uiStore'

const btnCls =
  'nodrag flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] text-ink-2 transition hover:bg-hover hover:text-ink'

const menuItemCls =
  'nodrag flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] text-ink-2 transition hover:bg-hover hover:text-ink'

const SPLIT_GRIDS: { cols: number; rows: number; label: string }[] = [
  { cols: 2, rows: 2, label: '四宫格 2×2' },
  { cols: 3, rows: 3, label: '九宫格 3×3' },
  { cols: 5, rows: 5, label: '25宫格 5×5' },
]

export function PvMediaToolbar({ nodeId, onUpload }: { nodeId: string; onUpload?: () => void }) {
  const node = usePvStore((s) => s.nodes.find((n) => n.id === nodeId))
  const d = node?.data as unknown as PvNodeData | undefined
  const pools = useScenePools()
  const imageActions = usePvActions('image')
  const openCrop = usePvDialogs((s) => s.openCrop)
  const openLightbox = useUiStore((s) => s.openLightbox)
  const [menu, setMenu] = useState<'smart' | 'split' | 'frame' | null>(null)
  const [frameSec, setFrameSec] = useState('1')

  if (!d || !d.url) return null
  const isImage = d.content_type === 'image'
  const isVideo = d.content_type === 'video'

  const actionOf = (id: string) => imageActions.find((a) => a.id === id)
  const runAction = (id: string) => {
    const a = actionOf(id)
    if (a) runSmartAction(nodeId, a, pools)
    setMenu(null)
  }

  const toggle = (m: 'smart' | 'split' | 'frame') => setMenu((cur) => (cur === m ? null : m))

  return (
    <div className="relative">
      <div
        className="flex items-center gap-0.5 rounded-xl border px-1.5 py-1 backdrop-blur-xl"
        style={{
          borderColor: 'var(--lw-glass-strong-edge)',
          background: 'var(--lw-glass-strong-bg)',
          boxShadow: 'var(--lw-node-shadow-hover)',
        }}
      >
        {isImage && (
          <>
            <button className={btnCls} onClick={() => toggle('smart')} title="智能生成：宫格 / 设定图 / 光影等模板">
              <Sparkles size={12} className="text-brand-400" />
              智能生成
              <ChevronDown size={10} className={menu === 'smart' ? 'rotate-180 transition' : 'transition'} />
            </button>
            {actionOf('multi_angle') && (
              <button className={btnCls} onClick={() => runAction('multi_angle')} title="换机位重绘，主体保持一致">
                <Camera size={12} />
                多角度
              </button>
            )}
            {actionOf('relight') && (
              <button className={btnCls} onClick={() => runAction('relight')} title="保持内容重新打光">
                <Sun size={12} />
                打光
              </button>
            )}
            {actionOf('smart_edit') && (
              <button className={btnCls} onClick={() => runAction('smart_edit')} title="按描述编辑画面">
                <Wand2 size={12} />
                智能编辑
              </button>
            )}
            <button className={btnCls} onClick={() => toggle('split')} title="把宫格图拆成单张素材">
              <Grid3X3 size={12} />
              快速拆分
              <ChevronDown size={10} className={menu === 'split' ? 'rotate-180 transition' : 'transition'} />
            </button>
            <button className={btnCls} onClick={() => openCrop(nodeId)} title="裁剪画面">
              <Scissors size={12} />
              裁剪
            </button>
          </>
        )}
        {isVideo && (
          <button className={btnCls} onClick={() => toggle('frame')} title="抽一帧变成图片素材">
            <Camera size={12} />
            截帧
            <ChevronDown size={10} className={menu === 'frame' ? 'rotate-180 transition' : 'transition'} />
          </button>
        )}
        {onUpload && (
          <button className={btnCls} onClick={onUpload} title="上传替换">
            <Upload size={12} />
            上传
          </button>
        )}
        <button className={btnCls} onClick={() => void downloadMedia(String(d.url), d.filename)} title="下载到本地">
          <Download size={12} />
          下载
        </button>
        <button className={btnCls} onClick={() => openLightbox(String(d.url))} title="全屏预览">
          <Expand size={12} />
          全屏
        </button>
      </div>

      {/* ── 下拉菜单（背板点击关闭）────────────────────────────── */}
      {menu && (
        <>
          <div className="nodrag fixed inset-0 z-10" onClick={() => setMenu(null)} />
          <div
            className="absolute left-0 top-full z-20 mt-1 w-44 rounded-xl border p-1 backdrop-blur-xl"
            style={{
              borderColor: 'var(--lw-glass-strong-edge)',
              background: 'var(--lw-glass-strong-bg)',
              boxShadow: 'var(--lw-node-shadow-hover)',
            }}
          >
            {menu === 'smart' &&
              (imageActions.length > 0 ? (
                imageActions.map((a) => (
                  <button key={a.id} className={menuItemCls} onClick={() => runAction(a.id)}>
                    <Sparkles size={11} className="shrink-0 text-brand-400" />
                    {a.label}
                  </button>
                ))
              ) : (
                <p className="px-2 py-1.5 text-[10px] text-ink-3">没有启用的智能动作，去「设置 → 画布」里开</p>
              ))}
            {menu === 'split' &&
              SPLIT_GRIDS.map((g) => (
                <button
                  key={g.label}
                  className={menuItemCls}
                  onClick={() => {
                    setMenu(null)
                    void splitImageNode(nodeId, g.cols, g.rows)
                  }}
                >
                  <Grid3X3 size={11} className="shrink-0" />
                  {g.label}
                </button>
              ))}
            {menu === 'frame' && (
              <>
                <button
                  className={menuItemCls}
                  onClick={() => {
                    setMenu(null)
                    void extractFrameToNode(nodeId, 'first')
                  }}
                >
                  截取首帧
                </button>
                <button
                  className={menuItemCls}
                  onClick={() => {
                    setMenu(null)
                    void extractFrameToNode(nodeId, 'last')
                  }}
                >
                  截取尾帧
                </button>
                <div className="flex items-center gap-1 px-1 py-1">
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    className="nodrag w-16 rounded-md border border-edge bg-input px-1.5 py-1 text-[11px] text-ink outline-none"
                    value={frameSec}
                    onChange={(e) => setFrameSec(e.target.value)}
                  />
                  <button
                    className={menuItemCls}
                    onClick={() => {
                      setMenu(null)
                      void extractFrameToNode(nodeId, 'current', Number(frameSec) || 0)
                    }}
                  >
                    截取该秒
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
