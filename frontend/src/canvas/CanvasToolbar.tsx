import { useState } from 'react'
import { aiBuildWorkflow, canvasApplyLayout, canvasSaveGraph, canvasToWorkflow, runWorkflow } from '../api'
import { useCanvasStore } from '../store/canvasStore'
import { canvasToWorkflow as toWfGraph } from './workflowAdapter'
import { dagLayout } from './layout'
import { Play, Save, Undo2, Redo2, Trash2, Wand2, Workflow, LayoutGrid, MessageSquare, Image, Camera, Sun, Zap, Box } from 'lucide-react'
import { emitLog } from '../components/LogPanel'

// V2.5 标准 6 节点快捷添加（规格书 §2）
const V2_NODES = [
  { type: 'prompt',    label: '提示词', icon: MessageSquare, color: '#6366f1' },
  { type: 'reference', label: '参考图', icon: Image,        color: '#8b5cf6' },
  { type: 'camera',    label: '镜头',   icon: Camera,       color: '#06b6d4' },
  { type: 'lighting',  label: '灯光',   icon: Sun,          color: '#f59e0b' },
  { type: 'motion',    label: '运动',   icon: Zap,          color: '#10b981' },
  { type: 'render',    label: '渲染',   icon: Box,          color: '#ef4444' },
] as const

export default function CanvasToolbar() {
  const { undo, redo, clear, projectId, objects, edges, updateNodeStatus, load, applyAutoLayout, addObject } = useCanvasStore()
  const [running, setRunning] = useState(false)
  const [building, setBuilding] = useState(false)
  const [buildPrompt, setBuildPrompt] = useState('')
  const [saved, setSaved] = useState(false)
  const [converting, setConverting] = useState(false)

  const addV2Node = (type: string) => {
    addObject(type as never, { x: 400 + Math.random() * 100, y: 200 + Math.random() * 80 })
  }

  const run = async () => {
    if (!objects.length || running) return
    setRunning(true)
    const startTime = Date.now()
    objects.forEach((o) => {
      updateNodeStatus(o.id, 'queued')
      emitLog({
        nodeId: o.id,
        nodeLabel: String(o.type || o.id),
        nodeType: String(o.type || 'unknown'),
        status: 'queued',
        message: '节点已排队',
      })
    })
    try {
      const graph = toWfGraph(objects, edges)
      await runWorkflow(graph, (nodeId, status, result) => {
        updateNodeStatus(nodeId, status, result)
        const obj = objects.find((o) => o.id === nodeId)
        const elapsed = Date.now() - startTime
        const label = obj ? String(obj.type || nodeId) : nodeId
        const duration = elapsed > 0 ? elapsed : undefined
        if (status === 'running') {
          emitLog({ nodeId, nodeLabel: label, nodeType: String(obj?.type || 'unknown'), status: 'running', message: '执行中…' })
        } else if (status === 'completed') {
          const summary = typeof result === 'string' ? result.slice(0, 80) : JSON.stringify(result || {}).slice(0, 80)
          emitLog({ nodeId, nodeLabel: label, nodeType: String(obj?.type || 'unknown'), status: 'completed', message: `完成 · ${summary}`, detail: typeof result === 'object' ? JSON.stringify(result, null, 2) : undefined, duration })
        } else if (status === 'failed') {
          const err = typeof result === 'object' && result !== null ? String((result as Record<string, unknown>).error || result) : String(result)
          emitLog({ nodeId, nodeLabel: label, nodeType: String(obj?.type || 'unknown'), status: 'failed', message: `失败 · ${err.slice(0, 60)}`, detail: err })
        }
      })
    } catch (e) {
      console.warn('工作流执行失败', e)
    } finally {
      setRunning(false)
    }
  }

  const toWorkflow = async () => {
    if (!objects.length || converting) return
    setConverting(true)
    const res = await canvasToWorkflow(projectId, '画布工作流')
    setConverting(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
  }

  const save = async () => {
    const res = await canvasSaveGraph(
      projectId,
      objects.map((o) => ({
        id: o.id, type: o.type, data: o.data, position: o.position,
        size: o.style?.width ? { width: o.style.width, height: o.style.height } : undefined,
      })),
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
      {/* V2.5 规格书 6 标准节点快捷按钮 */}
      <div className="flex items-center gap-1 border-r border-[var(--lw-ink-1)] pr-3 mr-2">
        {V2_NODES.map(({ type, label, icon: Icon, color }) => (
          <button
            key={type}
            className="ghost"
            title={`添加 ${label} 节点`}
            onClick={() => addV2Node(type)}
            style={{ color }}
          >
            <Icon size={13} />
            <span className="text-[10px]">{label}</span>
          </button>
        ))}
      </div>

      <button className="toolbar-run" onClick={run} disabled={running || objects.length === 0}>
        <Play size={14} /> {running ? '执行中…' : '运行工作流'}
      </button>
      <button className="ghost" onClick={save} title="保存画布">
        <Save size={14} /> {saved ? '已保存' : '保存'}
      </button>
      <button className="ghost" onClick={toWorkflow} disabled={converting || objects.length === 0} title="把画布转回工作流">
        <Workflow size={14} /> {converting ? '转换中…' : '转回工作流'}
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
        <button className="ghost" onClick={applyAutoLayout} title="按连线自动排列节点" disabled={objects.length === 0}><LayoutGrid size={14} /> 自动排列</button>
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
