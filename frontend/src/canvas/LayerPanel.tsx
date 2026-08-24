import { OBJECT_LIBRARY, useCanvasStore } from '../store/canvasStore'

export default function LayerPanel() {
  const { objects, selectedIds, setSelected, deleteObjects, bringForward, sendBackward } = useCanvasStore()
  const label = (type: string) => OBJECT_LIBRARY.find((o) => o.type === type)?.label || type
  // 上层在前（倒序）
  const ordered = [...objects].reverse()

  if (ordered.length === 0) {
    return <div className="layer-panel muted">画布为空，用「+ 文本/图片」添加对象</div>
  }

  return (
    <div className="layer-panel">
      <div className="layer-title">图层</div>
      {ordered.map((o) => (
        <div
          key={o.id}
          className={`layer-item ${selectedIds.includes(o.id) ? 'active' : ''}`}
          onClick={() => setSelected([o.id])}
        >
          <span className="layer-type">{label(o.type as string)}</span>
          <span className="layer-text">{String((o.data as Record<string, unknown>).text ?? (o.data as Record<string, unknown>).url ?? '').slice(0, 12) || '—'}</span>
          <span className="layer-actions">
            <button className="mini" title="上移" onClick={(e) => { e.stopPropagation(); bringForward(o.id) }}>↑</button>
            <button className="mini" title="下移" onClick={(e) => { e.stopPropagation(); sendBackward(o.id) }}>↓</button>
            <button className="mini del" title="删除" onClick={(e) => { e.stopPropagation(); deleteObjects([o.id]) }}>×</button>
          </span>
        </div>
      ))}
    </div>
  )
}
