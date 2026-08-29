// sceneScript —— 剧本解析公共模块（Image / Video / Audio 节点编辑器共用）
// 从剧本 script 解析：人物 / 道具 / 分镜 / BGM / 对白 / 画内画外音。括号内逗号不拆分。

export type AnyObj = Record<string, unknown>

export interface ParsedShot {
  no: number
  location: string
  time: string
  goal: string
  mood: string
  bgm: string
  body: string
  duration: string
  shots: { no: string; desc: string }[]
  dialogue: { speaker: string; emotion: string; line: string }[]
  sfx: string[]
}
export interface ParsedScript {
  characters: string[]
  props: string[]
  shots: ParsedShot[]
}
export const EMPTY_PARSED: ParsedScript = { characters: [], props: [], shots: [] }

/** 判断节点是否为剧情节点：兼容两种存储 */
export function isStoryNode(n: AnyObj | null | undefined): boolean {
  if (!n) return false
  const t = String((n as AnyObj).type ?? '').toLowerCase()
  const ot = String(((n as AnyObj).data as AnyObj)?.objectType ?? '').toLowerCase()
  return t === 'story' || ot === 'story'
}

/** 取「出场元素」段内某字段区间 */
export function sectionOf(script: string, startField: string, endFields: string[]): string {
  const m = script.match(/# 出场元素([\s\S]*?)(?=\n# )/)
  if (!m) return ''
  const block = m[1]
  const start = block.indexOf(startField)
  if (start < 0) return ''
  let end = block.length
  for (const f of endFields) {
    const i = block.indexOf(f, start + startField.length)
    if (i >= 0 && i < end) end = i
  }
  return block.slice(start, end)
}

/** 顶层拆分：括号内逗号/顿号不拆 */
export function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(' || ch === '（') depth++
    if (ch === ')' || ch === '）') depth--
    if ((ch === ',' || ch === '，' || ch === '、') && depth === 0) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** 无效内容行（环境音/音效/分镜地点时间等）直接跳过 */
export function isJunkLine(l: string): boolean {
  if (/^(（|\(|环境音|音效|旁白|画外音)/.test(l)) return true
  if (/(地点|时间|环境)[：:]/.test(l)) return true
  if (/^分镜\s*\d/.test(l)) return true
  return false
}

/** 从剧本解析「人物」：名字 → 完整描述行。
 * 兼容两种格式：
 *   A. 子行列表：- 人物：\n  - 林晓（女，28岁）：...
 *   B. 同行列表：- 人物：林晓、陈默（同行的道具/分镜解析一直正常，人物此前漏掉）
 */
export function parseCharacters(script: string): Record<string, string> {
  const desc: Record<string, string> = {}
  const sec = sectionOf(script, '人物', ['道具', '分镜'])
  if (!sec) return desc
  for (const raw of sec.split('\n')) {
    let l = raw.trim().replace(/^[-*]\s*/, '')
    if (!l) continue
    // 同行格式：- 人物：林晓（女，28岁）、陈默 → 用顶层拆分逐个取名（括号内顿号不拆）
    if (l.startsWith('人物')) {
      const rest = l.replace(/^人物[：:]\s*/, '').trim()
      if (rest) {
        for (const piece of splitTopLevel(rest)) {
          const nm = (piece.split(/[（(]/)[0] || '').trim()
          if (!nm || nm.length > 12) continue
          if (!desc[nm] || piece.length > desc[nm].length) desc[nm] = piece
        }
      }
      continue
    }
    if (isJunkLine(l)) continue
    l = l.replace(/^\s*\d+[.、）)]?\s*/, '')
    const name = (l.split(/[：:（(]/)[0] || '').trim()
    if (!name || name.length > 12) continue
    if (/[/\\]|\d{2}/.test(name)) continue
    if (!desc[name] || l.length > desc[name].length) desc[name] = l
  }
  return desc
}

/** 从剧本解析「道具」名字列表 */
export function parsePropsList(script: string): string[] {
  const out: string[] = []
  // 🔴 endFields 必须含「场景」：否则模板里道具段之后的场景行会被整段吞进道具名单
  const sec = sectionOf(script, '道具', ['场景', '分镜'])
  if (!sec) return out
  for (const raw of sec.split('\n')) {
    let l = raw.trim().replace(/^[-*]\s*/, '')
    if (!l) continue
    if (l.startsWith('道具')) l = l.replace(/^道具[：:]\s*/, '')
    if (!l || isJunkLine(l)) continue
    l = l.replace(/^\s*\d+[.、）)]?\s*/, '')
    splitTopLevel(l).forEach((x) => {
      if (x && !out.includes(x)) out.push(x)
    })
  }
  return out
}

/** 从剧本解析「道具」名字 → 描述（取含名字的最长片段，供生图提示词使用） */
export function parseProps(script: string): Record<string, string> {
  const desc: Record<string, string> = {}
  const sec = sectionOf(script, '道具', ['场景', '分镜'])
  if (!sec) return desc
  for (const raw of sec.split('\n')) {
    let l = raw.trim().replace(/^[-*]\s*/, '')
    if (!l) continue
    if (l.startsWith('道具')) l = l.replace(/^道具[：:]\s*/, '')
    if (!l || isJunkLine(l)) continue
    l = l.replace(/^\s*\d+[.、）)]?\s*/, '')
    for (const piece of splitTopLevel(l)) {
      const nm = (piece.split(/[（(:：]/)[0] || '').trim()
      if (!nm || nm.length > 20) continue
      if (!desc[nm] || piece.length > desc[nm].length) desc[nm] = piece
    }
  }
  return desc
}

/** 从分镜块解析对白 + 画内画外音（环境音/音效标注）。
 * 只取「对白 / 旁白」后连续「-」行，遇空行/字段行即止（不会串到下一场景）。 */
export function parseDialogueBlock(block: string): {
  dialogue: { speaker: string; emotion: string; line: string }[]
  sfx: string[]
} {
  const dialogue: { speaker: string; emotion: string; line: string }[] = []
  const sfx: string[] = []
  const dm = block.match(/-?\s*对白\s*\/\s*旁白[：:]?\s*\n((?:[ \t]*-[ \t]*[^\n]*\n?)*)/)
  const zone = dm ? dm[1] : ''
  for (const raw of zone.split('\n')) {
    const l = raw.trim().replace(/^[-*]\s*/, '')
    if (!l) continue
    // 画内画外音：整行括号（环境音/音效/脚步声/风声…）
    if (/^[（(]/.test(l) || /^(环境音|音效|旁白|画外音)/.test(l)) {
      const t = l.replace(/^[（(]|[）)]$/g, '').trim()
      if (t && !sfx.includes(t)) sfx.push(t)
      continue
    }
    // 对白：名字（情绪）："台词" / 名字：台词 / [旁白] "台词"
    const mm = l.match(/^([^（(：:]+?)(?:（([^）)]*)）)?[：:]\s*["“]?(.+?)["”]?\s*$/)
    if (mm && mm[1] && mm[3]) {
      dialogue.push({ speaker: mm[1].trim(), emotion: (mm[2] || '').trim(), line: mm[3].trim() })
      continue
    }
    // [旁白] "台词"（方括号标记 + 引号台词，无冒号）
    const mmb = l.match(/^\[([^\[\]]+)\]\s*["“]?(.+?)["”]?\s*$/)
    if (mmb && mmb[2]) {
      dialogue.push({ speaker: `[${mmb[1].trim()}]`, emotion: '', line: mmb[2].trim() })
    }
  }
  return { dialogue, sfx }
}

/** 中文数字 → 阿拉伯（一→1 … 十→10；支持 十一/二十 等；失败返回 0） */
export function parseCnNum(s: string): number {
  const t = String(s ?? '').trim()
  if (/^\d+$/.test(t)) return parseInt(t, 10) || 0
  const cn: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  if (cn[t]) return cn[t]
  if (t.length === 2 && cn[t[0]] && cn[t[1]]) {
    const a = cn[t[0]]
    const b = cn[t[1]]
    return a === 10 ? 10 + b : a * 10 + b
  }
  return 0
}

/** 从剧本 script 实时解析「场景/分镜」完整信息。
 * 兼容新模板（# 场景一：名称（约 15 秒））与旧模板（## 分镜N：（地点，时间））。 */
export function parseShotsFromScript(script: string): ParsedShot[] {
  const shots: ParsedShot[] = []
  if (!script) return shots
  const re = /^#{1,2}\s*(?:场景|分镜)\s*([一二三四五六七八九十\d]+)[：:]?\s*(.*)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(script))) {
    const no = parseCnNum(m[1]) || shots.length + 1
    let head = (m[2] || '').trim()
    let durTitle = ''
    // 新模板标题：名称（约 X 秒）
    const mt = head.match(/（约\s*([\d.]+)\s*秒）/)
    if (mt) {
      durTitle = mt[1]
      head = head.slice(0, mt.index).trim()
    }
    const parts = splitTopLevel(head)
    const loc = (parts[0] || '').trim()
    const tm = parts.slice(1).join('，').trim()
    const start = m.index + m[0].length
    const nxt = script.slice(start).match(/^#{1,2}\s*(?:场景|分镜)/m)
    const block = nxt ? script.slice(start, start + (nxt.index ?? script.length)) : script.slice(start)
    const get = (label: string) => {
      const g = block.match(new RegExp(`-?\\s*${label}[：:]\\s*([^\\n]+)`))
      return g ? g[1].trim() : ''
    }
    const shotArr: { no: string; desc: string }[] = []
    // 关键画面：兼容无编号「- xxx」与「- 镜头X-1：xxx」；只取连续「-」行，遇字段/空行即止
    const gm = block.match(/-?\s*关键画面[：:]?\s*\n((?:[ \t]*-[ \t]*[^\n]*\n?)*)/)
    if (gm) {
      for (const line of gm[1].split('\n')) {
        const d = line.trim().replace(/^[-*]\s*/, '').trim()
        if (!d) continue
        // 对白区起点：关键画面区到此为止（不吞对白/下一字段）
        if (d.startsWith('对白')) break
        if (/^(时长|背景音乐|场景目标|分镜目标|情绪基调|画面正文)[：:]/.test(d)) continue
        const mm = d.match(/^镜头([\d\-]+)[：:]\s*(.+)/)
        if (mm) shotArr.push({ no: mm[1].trim(), desc: mm[2].trim() })
        else shotArr.push({ no: '', desc: d })
      }
    }
    const { dialogue, sfx } = parseDialogueBlock(block)
    // 时长：标题（约X秒）优先，其次「- 时长：约X秒」行
    const durLine = get('时长')
    // 画面正文（V2.9l）：场景正文段落（模板单行「- 画面正文：xxx」）
    const body = get('画面正文')
    shots.push({
      no,
      location: loc,
      time: tm,
      goal: get('场景目标') || get('分镜目标'),
      mood: get('情绪基调'),
      bgm: get('背景音乐'),
      body,
      duration: durLine || durTitle,
      shots: shotArr,
      dialogue,
      sfx,
    })
  }
  return shots
}

/** 场景（分镜）描述组装 */
export function shotDesc(s: ParsedShot): string {
  const shots = (s.shots || []).map((x) => `镜头${x.no}：${x.desc}`).join('\n')
  return [
    `分镜${s.no}：${s.location || ''}${s.time ? `（${s.time}）` : ''}`,
    s.goal ? `目标：${s.goal}` : '',
    s.mood ? `情绪：${s.mood}` : '',
    s.duration ? `时长：约${s.duration}秒` : '',
    shots ? `画面：\n${shots}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** 纯场景描述（生成场景图用）：只含 地点/时间/氛围，不含目标/时长/人物动作等夹带内容 */
export function sceneDesc(s: ParsedShot): string {
  const base = [s.location || '', s.time || ''].filter(Boolean).join('，')
  const parts = [base]
  if (s.mood) parts.push(`氛围：${s.mood}`)
  return parts.filter(Boolean).join('\n')
}

/** 按 URL 扩展名判断图片（问题3：图片地址误进 <video controls> 会显示无效播放器） */
export function isImageUrl(url: string): boolean {
  if (!url) return false
  const clean = String(url).split('?')[0].split('#')[0].toLowerCase()
  return /\.(jpe?g|png|webp|gif|bmp|avif)$/.test(clean)
}

/** LLM 用途匹配（AI 重写/润色等文本任务）：未设场景或含 prompt/general 均可用 */
export function fitsLlm(p: { scenes?: string[] }): boolean {
  const s = Array.isArray(p.scenes) ? p.scenes : []
  return s.length === 0 || s.includes('prompt') || s.includes('general')
}

/** 模型能力匹配（V2.8.2/2.9d）：生图/生视频下拉只列具备对应能力的模型。
 * 避免纯文本模型（glm/deepseek 等）被误选导致生成失败。
 * 放行条件（任一）：
 *  1. 平台显式配置了该场景的模型映射 scene_models[need]
 *  2. 模型名/描述含生成类关键词（image/flux/... 或 video/wan/...）
 *  3. scenes 明确含 need（🔴 不含 general：通用文本模型不得进入生图/生视频下拉）
 */
export function fitsCapability(
  p: { scenes?: string[]; scene_models?: Record<string, unknown>; model?: string; description?: string; name?: string },
  need: 'image' | 'video',
): boolean {
  const sm = (p.scene_models || {}) as Record<string, unknown>
  if (sm && typeof sm === 'object' && String(sm[need] ?? '').trim()) return true
  const hay = [p.model, p.description, p.name].filter(Boolean).join(' ').toLowerCase()
  const imgRe = /(image|flux|sdxl|sd3|dall|qwen-image|kolors|wanx|midjourney|stable|wuniu|photo|图像|绘图|出图|生图)/
  const vidRe = /(video|wan|kling|runway|pika|hunyuan|sora|\bvid\b|可灵|即梦|视频)/
  if (need === 'image' && imgRe.test(hay)) return true
  if (need === 'video' && vidRe.test(hay)) return true
  const scenes = Array.isArray(p.scenes) ? p.scenes : []
  return scenes.includes(need)
}
