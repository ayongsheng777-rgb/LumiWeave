import { useState } from 'react'
import { aiBuildWorkflow, canvasApplyLayout, canvasSaveGraph, runWorkflow } from '../api'
import { useCanvasStore } from '../store/canvasStore'
import { canvasToWorkflow } from './workflowAdapter'
import { dagLayout } from './layout'
import { Play, Save, Undo2, Redo2, Trash2, Wand2 } from 'lucide-react'

export default function CanvasToolbar() {
  const { undo, redo, clear, projectId, objects, edges, updateNodeStatus, load } = useCanvasStore()
  const [running, setRunning] = useState(false)
  const [building, setBuilding] = useState(false)
  const [buildPrompt, setBuildPrompt] = useState('')
  const [saved, setSaved] = useState(false)

  const run = async () => {
    if (!objects.length || running) return
    setRunning(true)
    objects.forEach((o) => updateNodeStatus(o.id, 'queued'))
    try {
      const graph = canvasToWorkflow(objects, edges)
      await runWorkflow(graph, (nodeId, status, result) => {
        updateNodeStatus(nodeId, status, result)
      })
    } catch (e) {
      console.warn('工作流执行失败', e)
    } finally {
      setRunning(false)
    }
  }

  const save = async () => {
    const res = await canvasSaveGraph(
      projectId,
      objects.map((o) => ({ id: o.id, type: o.type, data: o.data, position: o.position })),
      edges.map((e) => ({ id: e.id, source: e.source, target: e.target, source_handle: e.sourceHandle, target_handle: e.targetHandle })),
    )
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
  }

  const build = async () => {
    if (!buildPrompt.trim() || building) return
    setBuilding(true)
    const res = await aiBuildWorkflow(buildPrompt.trim())
    setBuilding(false)
    if (res.ok && Array.isArray(res.data.nodes)) {
      const rawNodes = res.data.nodes as { id: string; type: string; data?: Record<string, unknown> }[]
      const idMap: Record<string, string> = {}
      const nodes = rawNodes.map((n, i) => {
        const nid = `obj_${Date.now().toString(36)}_${i}`
        idMap[n.id] = nid
        return { id: nid, type: n.type, position: { x: 80, y: 80 + i * 180 }, data: { ...(n.data || {}), status: 'idle' } }
      })
      const rawEdges = (res.data.edges || []) as { id: string; source: string; target: string }[]
      const edges = rawEdges.map((e) => ({
        id: `edge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        source: idMap[e.source] || e.source,
        target: idMap[e.target] || e.target,
        type: 'workflow',
        animated: true,
      }))
      load(dagLayout(nodes as never, edges as never) as never, edges as never)
      setBuildPrompt('')
    }
  }

  const applyLayout = async (template: string) => {
    if (!template || objects.length === 0) return
    const res = await canvasApplyLayout(projectId, template)
    if (res.ok && Array.isArray(res.data.objects)) {
      load(objects.map((o) => {
        const hit = res.data.objects.find((r: { id: string }) => r.id === o.id)
        return hit ? { ...o, position: hit.position, style: { ...o.style, ...hit.size } } : o
      }), edges)
    }
  }

  return (
    <div className="canvas-toolbar">
      <button className="toolbar-run" onClick={run} disabled={running || objects.length === 0}>
        <Play size={14} /> {running ? '执行中…' : '运行工作流'}
      </button>
      <button className="ghost" onClick={save} title="保存画布">
        <Save size={14} /> {saved ? '已保存' : '保存'}
      </button>

      <div className="build-box nodrag nowheel">
        <Wand2 size={14} className="text-[var(--lw-ink-3)]" />
        <input
          placeholder="一句话 AI 自动搭建工作流…"
          value={buildPrompt}
          onChange={(e) => setBuildPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && build()}
        />
        <button className="ghost" onClick={build} disabled={building || !buildPrompt.trim()}>
          {building ? '生成中…' : 'AI 搭建'}
        </button>
      </div>

      <div className="canvas-actions">
        <select className="nodrag nowheel" defaultValue="" onChange={(e) => applyLayout(e.target.value)}>
          <option value="" disabled>一键排版…</option>
          {['poster', 'xiaohongshu', 'ppt', 'ecommerce', 'magazine'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="ghost" onClick={undo} title="撤销"><Undo2 size={14} /></button>
        <button className="ghost" onClick={redo} title="重做"><Redo2 size={14} /></button>
        <button className="ghost" onClick={clear} title="清空"><Trash2 size={14} /></button>
      </div>

      <div className="ml-auto flex items-center gap-2 text-[11px] text-[var(--lw-ink-3)]">
        {objects.length} 节点 · {edges.length} 连线
      </div>
    </div>
  )
}
