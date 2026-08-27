// SceneTextWriter —— 文本节点极简版（V2.7）
// 布局：文本框在上（绑定 text 字段，可直接编辑）；下方一行「模型选择 + AI 编写」键。
// 点「AI 编写」→ 以文本框现有内容为要求，AI 撰写/扩写 → 结果自动填回文本框（持久化）。
// 只有两个操作控件，去掉弹窗、多轮对话、时长/分镜参数（那些是剧本节点的需求）。
import { useEffect, useState } from 'react'
import { Loader2, Wand2 } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { aiChat, getProfiles } from '../api'

type AnyObj = Record<string, unknown>

const SYSTEM_TEXT =
  '你是内容撰写助手。根据用户给出的内容/要求撰写或扩写文本，直接输出最终结果，不要解释过程，不要额外开场白。'

export default function SceneTextWriter({
  id,
  locked,
}: {
  id: string
  locked: boolean
}) {
  const patchObject = useSceneStore((s) => s.patchObject)
  const obj = useSceneStore((s) => s.objects.find((o) => o.id === id))
  const payload = ((obj?.data as AnyObj)?.payload || {}) as AnyObj
  const value = String(payload.text ?? '')

  const [profiles, setProfiles] = useState<{ id: string; name?: string; model?: string }[]>([])
  const [profileId, setProfileId] = useState(String(payload.profile_id ?? ''))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getProfiles()
      .then((r) => {
        if (r.ok) {
          const list = ((r.data as AnyObj)?.profiles as { id: string; name?: string; model?: string }[]) || []
          setProfiles(list)
          if (list.length && !profileId) setProfileId(list[0].id)
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const write = async () => {
    if (busy) return
    setBusy(true)
    try {
      const req = value.trim()
        ? `【内容 / 要求】\n${value.trim()}`
        : '请撰写一段内容（主题由你自拟，直接输出结果）。'
      const res = await aiChat({
        system: SYSTEM_TEXT,
        user: req,
        profile_id: profileId || undefined,
        scenario: 'general',
      })
      const out = res.ok
        ? String((res.data as AnyObj)?.result ?? '')
        : `生成失败：${JSON.stringify((res.data as AnyObj)?.error ?? '未知错误')}`
      patchObject(id, { text: out })
    } catch (e) {
      patchObject(id, { text: `请求失败：${String(e)}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1.5">
      {/* 文本框：直接编辑，AI 结果也填回这里（长文在节点内可见） */}
      <textarea
        className="nodrag nowheel w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-brand-500"
        rows={Math.min(6, Math.max(3, value.split('\n').length))}
        placeholder="在此输入内容，或直接点下方「AI 编写」让 AI 撰写…"
        value={value}
        disabled={locked}
        onChange={(e) => patchObject(id, { text: e.target.value })}
      />

      {/* 操作行：只有一个模型选择框 + AI 编写键 */}
      <div className="flex items-center gap-1.5">
        <select
          className="nodrag h-8 min-w-0 flex-1 rounded-md border border-edge bg-input px-1.5 text-sm text-ink outline-none focus:border-brand-500"
          style={{ minWidth: 120, maxWidth: 220 }}
          value={profileId}
          disabled={locked || busy}
          onChange={(e) => {
            setProfileId(e.target.value)
            patchObject(id, { profile_id: e.target.value })
          }}
          title="选择 AI 模型"
        >
          <option value="">默认模型</option>
          {profiles.map((p) =>
            p && p.id ? (
              <option key={p.id} value={p.id}>
                {String(p.name ?? p.id)}
                {p.model ? ` · ${p.model}` : ''}
              </option>
            ) : null,
          )}
        </select>
        <button
          className="nodrag flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-brand-600 px-3 text-sm text-white transition hover:bg-brand-500 disabled:opacity-50"
          onClick={() => void write()}
          disabled={locked || busy}
          title="AI 撰写 / 扩写，结果填入文本框"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          <span>{busy ? '撰写中…' : 'AI 编写'}</span>
        </button>
      </div>
    </div>
  )
}
