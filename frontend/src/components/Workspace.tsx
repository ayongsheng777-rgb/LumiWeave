import { useUiStore } from '../store/uiStore'
import TopHeader from './TopHeader'
import FloatingToolbar from './FloatingToolbar'
import SkillFloatingWindow from './SkillFloatingWindow'
import NodeConfigDrawer from './NodeConfigDrawer'
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
    <div className="relative h-screen w-screen overflow-hidden bg-canvas text-ink">
      {/* 顶部悬浮导航（毛玻璃，画布从其下方全屏铺开） */}
      <div className="absolute inset-x-0 top-0 z-40">
        <TopHeader />
      </div>

      {/* 100% 占满的主画布区（顶栏悬浮其上） */}
      <div className="absolute inset-0 top-14">
        <div className="relative flex h-full">
          {/* 节点库浮层（默认收起），两个画布共用 */}
          <FloatingToolbar />
          {/* 快捷技能浮窗：一键生成带连线的工作流 */}
          <SkillFloatingWindow />
          <div className="relative flex-1">
            {mode === 'workflow' ? <WorkflowCanvas /> : <CanvasCore />}
          </div>
          {chatOpen && (
            <aside className="w-[400px] shrink-0 border-l border-edge bg-panel">
              <ChatPanel />
            </aside>
          )}
        </div>
      </div>

      {lightbox && <Lightbox />}
      {managementOpen && <SettingsModal />}
      {/* 节点参数配置抽屉（齿轮按钮/选中节点唤出），两个画布共用 */}
      <NodeConfigDrawer />
      {/* 全局运行日志（右侧） + 分镜链信息框（左侧），两个画布共用 */}
      <LogPanel />
      <ShotChainPanel />
    </div>
  )
}
