import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import { aiChat } from '../api'
import NodeShell from './NodeShell'
import { nodeTypes as filmNodeTypes } from '../components/nodes'
import { StoryboardNodeCanvas } from '../components/nodes/StoryboardNodeCanvas'
import { lingjingNodeTypes } from './lingjingNodes'

type ObjData = Record<string, unknown>

const fieldCls =
  'nodrag nowheel w-full rounded-md border border-[var(--lw-edge)] bg-[var(--lw-input-bg)] px-2 py-1 text-sm text-[var(--lw-ink)] outline-none'

function useNodeActions(id: string) {
  const update = useCanvasStore((s) => s.updateObject)
  const toggleLock = useCanvasStore((s) => s.toggleLock)
  const deleteObjects = useCanvasStore((s) => s.deleteObjects)
  return {
    update,
    toggleLock: () => toggleLock(id),
    remove: () => deleteObjects([id]),
  }
}

// ==================== 文本 / 便签 / AI 结果（整合为一个节点） ====================
// 支持：文本编辑 + AI 生成 + 媒体结果展示（url + kind=image/video）

function TextLikeNode({ id, data, selected, title, color, placeholder, rows }: NodeProps & { title: string; color: string; placeholder: string; rows: number }) {
  const d = data as ObjData
  const { update, toggleLock, remove } = useNodeActions(id)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const locked = d.locked === true
  const kind = String(d.kind ?? 'text')
  const url = String(d.url ?? '')

  const gen = async () => {
    if (!aiPrompt.trim()) return
    setAiBusy(true)
    const res = await aiChat({ system: '你是内容生成助手，按要求生成内容，直接输出结果，不要多余解释。', user: aiPrompt, scenario: 'general' })
    setAiBusy(false)
    if (res.ok && res.data.result) update(id, { text: String(res.data.result) })
  }

  return (
    <NodeShell title={title} color={color} selected={!!selected} locked={locked} onToggleLock={toggleLock} onDelete={remove}>
      {url && kind === 'image' && <img className="w-full rounded-md object-cover" src={url} alt="结果图" draggable={false} />}
      {url && kind === 'video' && <video className="w-full rounded-md object-cover" src={url} controls muted loop />}
      <textarea
        className={fieldCls}
        rows={rows}
        placeholder={placeholder}
        value={String(d.text ?? '')}
        disabled={locked}
        style={locked ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
        onChange={(e) => update(id, { text: e.target.value })}
      />
      {!locked && (
        <div className="mt-1.5 flex gap-1.5">
          <input
            className={fieldCls}
            placeholder="输入需求，AI 生成…"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && gen()}
          />
          <button
            className="nodrag nowheel shrink-0 rounded-md bg-brand-600 px-2 py-1 text-sm text-white transition hover:bg-brand-500 disabled:opacity-50"
            onClick={gen}
            disabled={aiBusy}
          >
            {aiBusy ? '生成中' : '生成'}
          </button>
        </div>
      )}
    </NodeShell>
  )
}

const makeTextNode = (title: string, color: string, placeholder: string, rows: number) =>
  (props: NodeProps) => <TextLikeNode {...props} title={title} color={color} placeholder={placeholder} rows={rows} />

// ==================== 节点类型映射 ====================

export const objectNodeTypes = {
  // ── 影视节点：直接复用工作流画布组件（两套画布同步最新形态）─────────
  story: filmNodeTypes.story,
  image_input: filmNodeTypes.image_input,
  character: filmNodeTypes.character,
  scene: filmNodeTypes.scene,
  prop: filmNodeTypes.prop,
  image: filmNodeTypes.image,
  video: filmNodeTypes.video,
  audio: filmNodeTypes.audio,
  subtitle: filmNodeTypes.subtitle,
  layout: filmNodeTypes.layout,
  export: filmNodeTypes.export,
  prompt: filmNodeTypes.prompt,
  skill: filmNodeTypes.skill,
  // ── 画布专属类型 ──────────────────────────────────────────────
  storyboard: StoryboardNodeCanvas,
  // 文本 / 便签 / AI 结果整合：三个旧 type 统一指向同一组件（旧画布不丢节点）
  text: makeTextNode('文本', '#8b5cf6', '双击编辑文本', 3),
  note: makeTextNode('便签', '#f59e0b', '记一笔…', 2),
  ai_result: makeTextNode('AI 结果', '#ef4444', 'AI 回答 / 媒体结果', 3),
  // ── 灵境复刻节点（原版画布导入用）──────────────────────────────────
  ...lingjingNodeTypes,
}
