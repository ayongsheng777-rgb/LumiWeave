import { NODE_REGISTRY, nodeCategories } from './nodeRegistry'

export default function NodePalette() {
  const onDragStart = (event: React.DragEvent, type: string) => {
    event.dataTransfer.setData('application/lumiweave-node', type)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <aside className="node-palette">
      <div className="palette-title">节点库</div>
      {nodeCategories().map((cat) => (
        <div key={cat} className="palette-group">
          <div className="palette-cat">{cat}</div>
          {NODE_REGISTRY.filter((n) => n.category === cat).map((n) => (
            <div
              key={n.type}
              className="palette-item"
              draggable
              onDragStart={(e) => onDragStart(e, n.type)}
              title={n.description}
            >
              <span className="palette-dot" style={{ background: n.color }} />
              <span>{n.label}</span>
            </div>
          ))}
        </div>
      ))}
    </aside>
  )
}
