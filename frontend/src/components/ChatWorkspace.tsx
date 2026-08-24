import { useLayoutStore } from '../store/layoutStore'
import ChatPanel from './ChatPanel'
import WorkflowCanvas from './WorkflowCanvas'

export default function ChatWorkspace() {
  const isCanvasOpen = useLayoutStore((s) => s.isCanvasOpen)
  const toggleCanvas = useLayoutStore((s) => s.toggleCanvas)

  return (
    <div className="chat-workspace">
      <div className="chat-workspace-head">
        <span className="muted">对话 + 画布双轨：左边聊天，右边搭流程</span>
        <button className="ghost" onClick={toggleCanvas}>
          {isCanvasOpen ? '隐藏画布' : '显示画布'}
        </button>
      </div>
      <div className={`chat-workspace-body ${isCanvasOpen ? '' : 'no-canvas'}`}>
        <div className="chat-col">
          <ChatPanel />
        </div>
        {isCanvasOpen && (
          <div className="canvas-col">
            <WorkflowCanvas />
          </div>
        )}
      </div>
    </div>
  )
}
