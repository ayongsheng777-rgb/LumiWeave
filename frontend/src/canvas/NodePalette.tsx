import { NODE_REGISTRY, nodeCategories } from './nodeRegistry'

export default function NodePalette() {
  const onDragStart = (event: React.DragEvent, type: string) => {
    event.dataTransfer.setData('application/lumiweave-node', type)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <aside className="flex w-44 shrink-0 flex-col gap-3 overflow-y-auto border-r border-edge bg-panel px-2 py-3">
      <div className="px-1 text-xs font-semibold text-ink">节点库</div>
      {nodeCategories().map((cat) => (
        <div key={cat} className="flex flex-col gap-0.5">
          <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-ink-3">{cat}</div>
          {NODE_REGISTRY.filter((n) => n.category === cat).map((n) => (
            <div
              key={n.type}
              className="flex cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink-2 transition hover:bg-soft hover:text-ink active:cursor-grabbing"
              draggable
              onDragStart={(e) => onDragStart(e, n.type)}
              title={n.description}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: n.color }} />
              <span>{n.label}</span>
            </div>
          ))}
        </div>
      ))}
    </aside>
  )
}
