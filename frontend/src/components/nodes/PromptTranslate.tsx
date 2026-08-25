/** PromptTranslate — 提示词中/英互译展示小组件
 * 提示词始终以「原生语种」引用（value 存原文，生成时不做强制翻译）。
 * 本组件只做「翻译显示」：原文是中文就译成英文看，是英文就译成中文看，
 * 翻译结果仅用于阅读理解，不覆盖原文。
 */
import { useState } from 'react'
import { Languages } from 'lucide-react'
import { aiChat } from '../../api'

function isCjk(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s)
}

export function PromptTranslate({ prompt }: { prompt: string }) {
  const [translated, setTranslated] = useState('')
  const [translating, setTranslating] = useState(false)
  const [show, setShow] = useState(false)

  const doTranslate = async () => {
    if (!prompt.trim() || translating) return
    setTranslating(true)
    const target = isCjk(prompt) ? '英文' : '中文'
    try {
      const res = await aiChat({
        system: `你是专业的中英文互译助手。把下面的 AI 绘图/视频提示词翻译成${target}，专业术语（镜头、光照、风格等）保留原文并附简短注释。只输出译文，不要解释。`,
        user: prompt,
        scenario: 'general',
      })
      if (res.ok && res.data?.result) {
        setTranslated(String(res.data.result).trim())
        setShow(true)
      }
    } catch {
      /* ignore */
    } finally {
      setTranslating(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="nodrag rounded px-1.5 py-0.5 text-[10px] text-ink-3 transition hover:bg-soft hover:text-ink disabled:opacity-40"
          onClick={doTranslate}
          disabled={translating || !prompt.trim()}
          title="翻译查看（不改变原文）"
        >
          <Languages size={11} className="inline mr-0.5" />
          {translating ? '翻译中…' : `译→${isCjk(prompt) ? '英' : '中'}`}
        </button>
        {translated && (
          <button
            type="button"
            className={`nodrag rounded px-1.5 py-0.5 text-[10px] transition ${show ? 'bg-brand-600 text-white' : 'bg-soft text-ink-3 hover:bg-soft/80'}`}
            onClick={() => setShow((v) => !v)}
            title="显示/隐藏译文"
          >
            {show ? '隐藏译文' : '查看译文'}
          </button>
        )}
      </div>
      {show && translated && (
        <div className="mt-1 rounded border border-brand-500/20 bg-brand-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-ink-2">
          {translated}
        </div>
      )}
    </div>
  )
}
