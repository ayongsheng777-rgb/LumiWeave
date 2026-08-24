import { useLayoutStore } from '../store/layoutStore'
import ChatPanel from './ChatPanel'
import CanvasCore from '../canvas/CanvasCore'

export default function ChatWorkspace() {
  const isChatOpen = useLayoutStore((s) => s.isCanvasOpen)
  const toggleChat = useLayoutStore((s) => s.toggleCanvas)

  return (
    <div className="v2-workspace">
      <div className="v2-canvas-main">
        <CanvasCore />
      </div>
      {isChatOpen ? (
        <aside className="v2-chat-side">
          <div className="v2-chat-head">
            <span>AI 助手</span>
            <button className="ghost" onClick={toggleChat}>
              收起
            </button>
          </div>
          <ChatPanel />
        </aside>
      ) : (
        <button className="v2-chat-fab" onClick={toggleChat}>
          AI 助手
        </button>
      )}
    </div>
  )
}
