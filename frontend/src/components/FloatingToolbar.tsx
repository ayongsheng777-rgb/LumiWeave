import { defaultDataFor, makeNode, useWorkflowStore } from '../store/workflowStore'
import { FileInput, Brain, FileText, Wrench, Download, Sparkles } from 'lucide-react'

const ITEMS: { type: string; label: string; icon: JSX.Element }[] = [
  { type: 'input', label: '输入', icon: <FileInput size={18} /> },
  { type: 'llm', label: 'LLM 推理', icon: <Brain size={18} /> },
  { type: 'prompt_template', label: '提示词', icon: <FileText size={18} /> },
  { type: 'skill', label: '技能', icon: <Wrench size={18} /> },
  { type: 'output', label: '输出', icon: <Download size={18} /> },
  { type: 'render', label: '出图', icon: <Sparkles size={18} /> },
]

// 左侧悬浮工具条：拖拽到画布生成节点，或点击直接添加
export default function FloatingToolbar() {
  const add = (type: string) => {
    const node = makeNode(type, defaultDataFor(type))
    useWorkflowStore.getState().addNode(node)
  }

  return (
    <div className="z-10 flex w-14 shrink-0 flex-col items-center gap-1 border-r border-edge bg-panel py-3">
      <div className="mb-1 text-[10px] text-ink-3">节点</div>
      {ITEMS.map((it) => (
        <button
          key={it.type}
          title={`${it.label}（拖到画布，或点击添加）`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/lumiweave-node', it.type)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onClick={() => add(it.type)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-2 transition hover:bg-brand-500/20 hover:text-brand-300 active:scale-95"
        >
          {it.icon}
        </button>
      ))}
    </div>
  )
}
