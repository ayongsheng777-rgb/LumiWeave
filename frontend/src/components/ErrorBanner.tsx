// ErrorBanner —— 统一报错状态条（V2.8）
// 图标 + 易懂文案 + 「查看详情」折叠原始报错；不裸暴露 HTTP 码/底层细节
import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'

export default function ErrorBanner({
  message,
  detail,
}: {
  message: string
  detail?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px]">
      <div className="flex items-start gap-1.5">
        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          <div className="leading-snug text-red-400">{message}</div>
          {detail && (
            <button
              className="nodrag mt-0.5 flex items-center gap-0.5 text-[10px] text-red-400/70 transition hover:text-red-400"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              {open ? '收起详情' : '查看详情'}
            </button>
          )}
        </div>
      </div>
      {open && detail && (
        <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-black/20 px-2 py-1.5 text-[10px] leading-relaxed text-red-300/80">
          {detail}
        </pre>
      )}
    </div>
  )
}
