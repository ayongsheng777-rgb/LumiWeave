import { useUiStore } from '../store/uiStore'
import TopHeader from './TopHeader'
import FloatingToolbar from './FloatingToolbar'
import WorkflowCanvas from './WorkflowCanvas'
import ChatPanel from './ChatPanel'
import Lightbox from './Lightbox'
import SettingsModal from './SettingsModal'
import CanvasCore from '../canvas/CanvasCore'
import { LogPanel } from './LogPanel'
import { ShotChainPanel } from './ShotChainPanel'

export default function Workspace() {
  const mode = useUiStore((s) => s.mode)
  const chatOpen = useUiStore((s) => s.chatOpen)
  const lightbox = useUiStore((s) => s.lightbox)
  const managementOpen = useUiStore((s) => s.managementOpen)

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-ink">
      <TopHeader />
      <div className="relative flex flex-1 overflow-hidden">
        <FloatingToolbar />
        <div className="relative flex-1">
          {mode === 'workflow' ? <WorkflowCanvas /> : <CanvasCore />}
        </div>
        {chatOpen && (
          <aside className="w-[400px] shrink-0 border-l border-edge bg-panel">
            <ChatPanel />
          </aside>
        )}
      </div>
      {lightbox && <Lightbox />}
      {managementOpen && <SettingsModal />}
      {/* 全局运行日志（右侧） + 分镜链信息框（左侧），两个画布共用 */}
      <LogPanel />
      <ShotChainPanel />
    </div>
  )
}
