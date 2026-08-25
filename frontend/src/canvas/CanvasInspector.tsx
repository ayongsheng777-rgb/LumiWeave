import { useCanvasStore } from '../store/canvasStore'

const SKIP_KEYS = new Set(['status', 'result', 'error', 'locked', 'taskId', '__meta'])
const TEXTAREA_KEYS = new Set(['text', 'prompt', 'message', 'description', 'system', 'template', 'content'])

export default function CanvasInspector() {
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const objects = useCanvasStore((s) => s.objects)
  const update = useCanvasStore((s) => s.updateObject)

  const selected = objects.find((n) => n.id === selectedIds[0])

  if (!selected) {
    return (
      <aside className="canvas-inspector">
        <h3>画布设置</h3>
        <p className="inspector-hint">选中任意节点，在这里编辑它的参数。</p>
        <div className="inspector-section">
          <div className="inspector-label">提示</div>
          <div className="inspector-hint">
            从左侧「节点库」拖拽节点到画布，节点之间用右侧圆点连线，点「运行工作流」执行。
          </div>
        </div>
      </aside>
    )
  }

  const data = (selected.data || {}) as Record<string, unknown>
  const editable = Object.keys(data).filter((k) => !SKIP_KEYS.has(k))
  const status = String(data.status || 'idle')

  return (
    <aside className="canvas-inspector">
      <h3>{String(data.label || selected.type)}</h3>
      <div className="inspector-meta">
        <span className={`node-status-badge node-status-${status}`}>{status}</span>
        <span>类型 {selected.type}</span>
      </div>

      {editable.length === 0 && <p className="inspector-hint">该节点无可编辑参数。</p>}

      {editable.map((k) => {
        const v = data[k]
        const isTextarea = TEXTAREA_KEYS.has(k)
        return (
          <label key={k} className="inspector-field">
            <span className="inspector-label">{k}</span>
            {isTextarea ? (
              <textarea
                className="nodrag nowheel inspector-input"
                rows={4}
                value={v == null ? '' : String(v)}
                onChange={(e) => update(selected.id, { [k]: e.target.value })}
              />
            ) : typeof v === 'number' ? (
              <input className="nodrag nowheel inspector-input" type="number" value={v} onChange={(e) => update(selected.id, { [k]: Number(e.target.value) })} />
            ) : (
              <input className="nodrag nowheel inspector-input" value={v == null ? '' : String(v)} onChange={(e) => update(selected.id, { [k]: e.target.value })} />
            )}
          </label>
        )
      })}

      {data.result != null && (
        <div className="inspector-section">
          <div className="inspector-label">结果</div>
          <pre className="inspector-result">{typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2)}</pre>
        </div>
      )}
      {data.error != null && <div className="inspector-error">错误：{String(data.error)}</div>}
    </aside>
  )
}
