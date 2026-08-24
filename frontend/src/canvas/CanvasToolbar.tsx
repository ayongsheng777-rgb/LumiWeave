import { canvasApplyLayout } from '../api'
import { OBJECT_LIBRARY, useCanvasStore } from '../store/canvasStore'

const LAYOUT_TEMPLATES = [
  { key: 'poster', label: '海报' },
  { key: 'xiaohongshu', label: '小红书' },
  { key: 'ppt', label: 'PPT' },
  { key: 'ecommerce', label: '电商' },
  { key: 'magazine', label: '杂志' },
]

export default function CanvasToolbar() {
  const { addObject, undo, redo, clear, projectId, objects, load, undoStack, redoStack } = useCanvasStore()

  const addAt = (type: string) => {
    const n = objects.length
    addObject(type, { x: 120 + (n % 4) * 60, y: 100 + (n % 5) * 60 })
  }

  const applyLayout = async (template: string) => {
    if (!template || objects.length === 0) return
    const res = await canvasApplyLayout(projectId, template)
    // 后端写库成功则刷新画布；失败则本地按模板重排（降级）
    if (res.ok && Array.isArray(res.data.objects)) {
      load(objects.map((o) => {
        const hit = res.data.objects.find((r: { id: string }) => r.id === o.id)
        return hit ? { ...o, position: hit.position, style: { ...o.style, ...hit.size } } : o
      }))
    }
  }

  return (
    <div className="canvas-toolbar">
      <div className="canvas-lib">
        {OBJECT_LIBRARY.map((o) => (
          <button key={o.type} className="lib-btn" onClick={() => addAt(o.type)}>
            + {o.label}
          </button>
        ))}
      </div>
      <div className="canvas-actions">
        <select className="nodrag nowheel" defaultValue="" onChange={(e) => applyLayout(e.target.value)}>
          <option value="" disabled>
            一键排版…
          </option>
          {LAYOUT_TEMPLATES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <button className="ghost" onClick={undo} disabled={undoStack.length === 0}>
          撤销
        </button>
        <button className="ghost" onClick={redo} disabled={redoStack.length === 0}>
          重做
        </button>
        <button className="ghost" onClick={clear}>
          清空
        </button>
      </div>
    </div>
  )
}
