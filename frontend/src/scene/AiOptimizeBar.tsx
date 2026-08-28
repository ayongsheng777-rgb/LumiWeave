// AiOptimizeBar —— 通用「AI 优化 / 润色」条（V2.8.1 全局修复）
// 统一解决所有场景（电商物料 / 电商短剧 / 影视拉片）里 AI 优化类功能的两大通病：
//   ① 没有「用户要求」输入框  ② 没有独立的 LLM 模型选择框
// 交互：模型下拉 + 要求输入框 + 执行按钮；把【现有内容】+【上下文】+【用户要求】
//       交给所选模型，结果写回节点指定字段（prompt / desc / text）。
import { useEffect, useState } from 'react'
import { Loader2, Send, Wand2 } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { aiChat, getProfiles } from '../api'

type AnyObj = Record<string, unknown>
type AnyProfile = { id: string; name?: string; model?: string }

const DEFAULT_SYSTEM =
  '你是内容优化专家。根据现有内容与用户要求进行优化改写，直接输出最终结果，不要多余解释、不要开场白。'

/**
 * @param id        场景对象 id（node.id）
 * @param target    写回字段：prompt / desc / text
 * @param label     按钮文案（默认「AI 优化」，图片场景可传「润色」）
 * @param system    系统提示词（按目标字段定制）
 * @param getContext 返回额外上下文（如风格/运镜/景别等配置，追加到提示中）
 * @param quickReqs 快捷要求 chips（点击填入要求框，如：三视图 / 细节特写）
 * @param disabled  锁定态禁用
 */
export default function AiOptimizeBar({
  id,
  target,
  label = 'AI 优化',
  system = DEFAULT_SYSTEM,
  getContext,
  quickReqs,
  disabled,
}: {
  id: string
  target: 'prompt' | 'desc' | 'text'
  label?: string
  system?: string
  getContext?: () => string
  quickReqs?: string[]
  disabled?: boolean
}) {
  const patchObject = useSceneStore((s) => s.patchObject)
  const obj = useSceneStore((s) => s.objects.find((o) => o.id === id))
  const payload = (((obj?.data as AnyObj)?.payload) || {}) as AnyObj
  const current = String(payload[target] ?? '')

  const [profiles, setProfiles] = useState<AnyProfile[]>([])
  // 独立 LLM 选择：存 ai_profile_id，不覆盖生成模型选择（gen_profile_id / profile_id）
  const [aiProfileId, setAiProfileId] = useState(String(payload.ai_profile_id ?? payload.profile_id ?? ''))
  const [req, setReq] = useState('')
  const [running, setRunning] = useState(false)

  useEffect(() => {
    getProfiles()
      .then((r) => {
        const list = ((r.data as AnyObj)?.profiles as AnyProfile[]) || []
        setProfiles(list)
        if (list.length && !aiProfileId) setAiProfileId(list[0].id)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async () => {
    if (running || disabled || !current.trim()) return
    setRunning(true)
    try {
      const parts = [
        current.trim() ? `【现有内容】\n${current.trim()}` : '',
        getContext ? getContext() : '',
        req.trim() ? `【用户要求】${req.trim()}` : '【用户要求】优化表达，使其更具体、专业、可直接使用',
      ].filter(Boolean).join('\n')
      const res = await aiChat({
        system,
        user: parts,
        profile_id: aiProfileId || undefined,
        scenario: 'general',
      })
      const out = res.ok ? String((res.data as AnyObj)?.result ?? '') : ''
      if (out) {
        patchObject(id, { [target]: out, ai_profile_id: aiProfileId })
        setReq('')
      }
    } finally {
      setRunning(false)
    }
  }

  /** 快捷要求多选（V2.9f）：点选叠加进要求框，再点取消 */
  const reqParts = req
    .split(/[、,，]/)
    .map((x) => x.trim())
    .filter(Boolean)
  const toggleQuick = (q: string) => {
    setReq((prev) => {
      const parts = prev
        .split(/[、,，]/)
        .map((x) => x.trim())
        .filter(Boolean)
      if (parts.includes(q)) return parts.filter((x) => x !== q).join('、')
      return [...parts, q].join('、')
    })
  }

  return (
    <div className="space-y-1.5">
      {/* 快捷要求 chips（V2.9f：可多选叠加，点选高亮，再点取消） */}
      {quickReqs && quickReqs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {quickReqs.map((q) => {
            const active = reqParts.includes(q)
            return (
              <button
                key={q}
                type="button"
                className={`nodrag rounded-full border px-2 py-0.5 text-[10px] transition disabled:opacity-40 ${
                  active
                    ? 'border-brand-500 bg-brand-500/25 font-medium text-brand-300'
                    : 'border-brand-500/30 bg-brand-500/10 text-brand-300 hover:bg-brand-500/25'
                }`}
                disabled={disabled || running}
                onClick={() => toggleQuick(q)}
                title={`${active ? '取消' : '加入'}「${q}」（可多选）`}
              >
                {q}
              </button>
            )
          })}
        </div>
      )}
      {/* 模型选择 */}
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] text-ink-3">模型</span>
        <select
          className="nodrag h-7 min-w-0 flex-1 rounded-md border border-edge bg-input px-1 text-[11px] text-ink outline-none focus:border-brand-500"
          value={aiProfileId}
          disabled={disabled || running}
          onChange={(e) => { setAiProfileId(e.target.value); patchObject(id, { ai_profile_id: e.target.value }) }}
          title="选择 AI 优化使用的模型（与生成模型相互独立）"
        >
          <option value="">默认模型（系统自动选）</option>
          {profiles.map((p) =>
            p && p.id ? (
              <option key={p.id} value={p.id}>
                {String(p.name ?? p.id)}
                {p.model ? ` · ${p.model}` : ''}
              </option>
            ) : null,
          )}
        </select>
      </div>
      {/* 用户要求 + 执行 */}
      <div className="flex items-end gap-1.5">
        <textarea
          className="nodrag nowheel min-h-8 max-h-28 min-w-0 flex-1 resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-[11px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-brand-500"
          rows={Math.min(3, Math.max(1, req.split('\n').length))}
          placeholder={`输入${label}要求，如：更宏大、突出产品质感、加入光影细节…（回车执行）`}
          value={req}
          disabled={disabled || running}
          onChange={(e) => setReq(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void run()
            }
          }}
        />
        <button
          className="nodrag flex h-8 shrink-0 items-center gap-1 rounded-md bg-brand-600 px-2.5 text-[11px] text-white transition hover:bg-brand-500 disabled:opacity-50"
          disabled={disabled || running || !current.trim()}
          onClick={() => void run()}
          title={`${label}：用所选模型改写现有内容，结果写回`}
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
          {running ? '优化中…' : label}
          <Send size={11} className="opacity-70" />
        </button>
      </div>
    </div>
  )
}
