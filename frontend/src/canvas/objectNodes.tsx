import type { ReactNode } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'

type ObjData = Record<string, unknown>

function Shell({ title, color, selected, children }: { title: string; color: string; selected: boolean; children: ReactNode }) {
  return (
    <div className={`obj-node ${selected ? 'obj-selected' : ''}`} style={{ borderTopColor: color }}>
      <div className="obj-node-head">
        <span className="obj-node-dot" style={{ background: color }} />
        <span className="obj-node-title">{title}</span>
      </div>
      <div className="obj-node-body">{children}</div>
    </div>
  )
}

function TextNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const update = useCanvasStore((s) => s.updateObject)
  return (
    <Shell title="文本" color="#8b5cf6" selected={!!selected}>
      <textarea
        className="nodrag nowheel"
        rows={3}
        value={String(d.text ?? '')}
        onChange={(e) => update(id, { text: e.target.value })}
      />
    </Shell>
  )
}

function NoteNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const update = useCanvasStore((s) => s.updateObject)
  return (
    <Shell title="便签" color="#f59e0b" selected={!!selected}>
      <textarea
        className="nodrag nowheel"
        rows={2}
        placeholder="记一笔…"
        value={String(d.text ?? '')}
        onChange={(e) => update(id, { text: e.target.value })}
      />
    </Shell>
  )
}

function PromptNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const update = useCanvasStore((s) => s.updateObject)
  return (
    <Shell title="提示词" color="#10b981" selected={!!selected}>
      <textarea
        className="nodrag nowheel"
        rows={3}
        placeholder="输入提示词…"
        value={String(d.text ?? '')}
        onChange={(e) => update(id, { text: e.target.value })}
      />
    </Shell>
  )
}

function ImageNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const update = useCanvasStore((s) => s.updateObject)
  const url = String(d.url ?? '')
  return (
    <Shell title="图片" color="#3b82f6" selected={!!selected}>
      {url ? (
        <img className="obj-img" src={url} alt="生成图" draggable={false} />
      ) : (
        <div className="obj-img-placeholder">未生成</div>
      )}
      <input
        className="nodrag nowheel"
        type="text"
        placeholder="图片 URL"
        value={url}
        onChange={(e) => update(id, { url: e.target.value })}
      />
    </Shell>
  )
}

function AiResultNode({ id, data, selected }: NodeProps) {
  const d = data as ObjData
  const update = useCanvasStore((s) => s.updateObject)
  const kind = String(d.kind ?? 'text')
  return (
    <Shell title="AI 结果" color="#ef4444" selected={!!selected}>
      {kind === 'image' && d.url ? (
        <img className="obj-img" src={String(d.url)} alt="AI 生成" draggable={false} />
      ) : (
        <textarea
          className="nodrag nowheel"
          rows={3}
          value={String(d.text ?? '')}
          onChange={(e) => update(id, { text: e.target.value })}
        />
      )}
    </Shell>
  )
}

export const objectNodeTypes = {
  text: TextNode,
  note: NoteNode,
  prompt: PromptNode,
  image: ImageNode,
  ai_result: AiResultNode,
}
