import { useUiStore } from '../store/uiStore'
import TopHeader from './TopHeader'
import ChatPanel from './ChatPanel'
import Lightbox from './Lightbox'
import SettingsModal from './SettingsModal'
import PvCanvas from '../pv/PvCanvas'
import SceneCanvas from '../scene/SceneCanvas'
import { LogPanel } from './LogPanel'
import { ShotChainPanel } from './ShotChainPanel'

export default function Workspace() {
  const mode = useUiStore((s) => s.mode)
  const chatOpen = useUiStore((s) => s.chatOpen)
  const lightbox = useUiStore((s) => s.lightbox)
  const managementOpen = useUiStore((s) => s.managementOpen)

  return (
    <div className="lw-canvas-bg relative h-screen w-screen overflow-hidden text-ink">
      {/* 顶部悬浮导航（毛玻璃，画布从其下方全屏铺开） */}
      <div className="absolute inset-x-0 top-0 z-40">
        <TopHeader />
      </div>

      {/* 100% 占满的主画布区（顶栏悬浮其上） */}
      <div className="absolute inset-0 top-14">
        <div className="relative flex h-full">
          {/* 通用画布自带左下角节点库；专业场景有自己的动态工具条，两套工具条不混用 */}
          <div className="relative min-w-0 flex-1">
            {mode === 'scene' ? <SceneCanvas /> : <PvCanvas />}
          </div>
          {chatOpen && (
            <aside className="w-[400px] shrink-0 border-l border-white/30 bg-white/50 backdrop-blur-lg dark:border-white/10 dark:bg-slate-900/50">
              <ChatPanel />
            </aside>
          )}
        </div>
      </div>

      {lightbox && <Lightbox />}
      {managementOpen && <SettingsModal />}
      {/* 全局运行日志（右侧） + 分镜链信息框（左侧），两个画布共用 */}
      <LogPanel />
      <ShotChainPanel />
    </div>
  )
}
