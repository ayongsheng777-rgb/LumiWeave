// SceneHoverToolbar —— 节点悬浮工具栏（V2.8 UI 重构）
// 悬停/选中节点时在正上方浮现胶囊毛玻璃工具栏：
// ✨智能润色(开弹窗) / 🔄重新生成 / 🎭角色锁定(图片参考源) / ⬇️快速导出 / ⚙️节点设置(开弹窗)
import { Download, Loader2, RefreshCw, Settings2, UserRound, Wand2 } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'

type Payload = Record<string, unknown>

/** 取图片/视频/音频结果地址 */
function resultUrl(payload: Payload, objectType: string): string {
  const keys = objectType === 'video' ? ['url', 'video', 'video_url'] : ['url', 'image', 'image_url', 'cover', 'thumbnail', 'main_image']
  for (const k of keys) {
    const v = payload[k]
    if (typeof v === 'string' && v.trim()) return v
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0]) return v[0]
  }
  return ''
}

export default function SceneHoverToolbar({ id, objectType, payload }: { id: string; objectType: string; payload: Payload }) {
  const openNodeModal = useSceneStore((s) => s.openNodeModal)
  const patchObject = useSceneStore((s) => s.patchObject)
  const runAction = useSceneStore((s) => s.runAction)
  const busy = useSceneStore((s) => s.busy)

  const url = resultUrl(payload, objectType)
  const lockedRef = payload.locked_ref === true

  // 🔄 重新生成：有场景生成动作的类型直接触发（回填当前节点）；否则打开编辑面板
  // V2.8.1 修复：图片用 generate_node_image、视频用 generate_node_video（原 generate_video 会新建节点而非回填）
  const regenAction =
    objectType === 'video' ? 'generate_node_video'
      : objectType === 'audio' ? 'generate_music'
        : objectType === 'image' ? 'generate_node_image'
          : ''
  const hasPrompt = String(payload.prompt ?? payload.desc ?? payload.text ?? '').trim()
  const regen = () => {
    if (regenAction && hasPrompt) void runAction(regenAction, [id])
    else openNodeModal(id)
  }
  const download = () => {
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `lumiweave-${objectType}.${objectType === 'video' ? 'mp4' : objectType === 'audio' ? 'mp3' : 'png'}`
    a.target = '_blank'
    a.click()
  }
  const btn = 'flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] text-ink-2 transition hover:bg-soft hover:text-ink disabled:opacity-40'

  return (
    <div
      className="scene-hover-toolbar pointer-events-none absolute -top-11 left-1/2 z-30 flex -translate-x-1/2 translate-y-1 items-center gap-0.5 whitespace-nowrap rounded-full border border-white/50 bg-white/70 px-1.5 py-1 opacity-0 shadow-lg backdrop-blur-lg transition-all duration-200 dark:border-white/10 dark:bg-slate-900/70"
      onClick={(e) => e.stopPropagation()}
    >
      <button className={btn} title="智能润色（AI 优化提示词，在编辑面板内）" onClick={() => openNodeModal(id)}>
        <Wand2 size={12} /> 润色
      </button>
      <button className={btn} title="重新生成（保留设定重新抽卡）" disabled={!!busy} onClick={regen}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} 重生成
      </button>
      {objectType === 'image' && (
        <button
          className={`${btn} ${lockedRef ? '!text-brand-500' : ''}`}
          title={lockedRef ? '已设为参考源（跨分镜保持该角色/物件一致），点击取消' : '角色锁定：设为全局参考源，后续生成自动保持一致性'}
          onClick={() => patchObject(id, { locked_ref: !lockedRef })}
        >
          <UserRound size={12} /> {lockedRef ? '已锁定' : '锁定'}
        </button>
      )}
      <button className={btn} title="快速导出" disabled={!url} onClick={download}>
        <Download size={12} /> 导出
      </button>
      <button className={btn} title="节点设置（完整编辑面板）" onClick={() => openNodeModal(id)}>
        <Settings2 size={12} /> 设置
      </button>
    </div>
  )
}
