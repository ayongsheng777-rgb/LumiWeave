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

/** 从剧本解析「人物」：名字 → 完整描述行 */
export function parseCharacters(script: string): Record<string, string> {
  const desc: Record<string, string> = {}
  const sec = sectionOf(script, '人物', ['道具', '分镜'])
  if (!sec) return desc
  for (const raw of sec.split('\n')) {
    let l = raw.trim().replace(/^[-*]\s*/, '')
    if (!l || l.startsWith('人物')) continue
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
  const sec = sectionOf(script, '道具', ['分镜'])
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

/** 从分镜块解析对白 + 画内画外音（环境音/音效标注） */
export function parseDialogueBlock(block: string): {
  dialogue: { speaker: string; emotion: string; line: string }[]
  sfx: string[]
} {
  const dialogue: { speaker: string; emotion: string; line: string }[] = []
  const sfx: string[] = []
  const dm = block.match(/-?\s*对白\s*\/\s*旁白[\s\S]*?\n((?:.*\n)*?)(?=\n?\s*-?\s*时长|$)/)
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
    // 对白：名字（情绪）："台词" 或 名字：台词
    const mm = l.match(/^([^（(：:]+?)(?:（([^）)]*)）)?[：:]\s*["“]?(.+?)["”]?\s*$/)
    if (mm && mm[1] && mm[3]) {
      dialogue.push({ speaker: mm[1].trim(), emotion: (mm[2] || '').trim(), line: mm[3].trim() })
    }
  }
  return { dialogue, sfx }
}

/** 从剧本 script 实时解析「分镜」完整信息 */
export function parseShotsFromScript(script: string): ParsedShot[] {
  const shots: ParsedShot[] = []
  if (!script) return shots
  const re = /##\s*分镜(\d+)[：:]?\s*(.*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(script))) {
    const no = parseInt(m[1], 10)
    const parts = splitTopLevel((m[2] || '').trim())
    const loc = (parts[0] || '').trim()
    const tm = parts.slice(1).join('，').trim()
    const start = m.index + m[0].length
    const nxt = script.slice(start).match(/\n##\s*分镜/)
    const block = nxt ? script.slice(start, start + (nxt.index ?? script.length)) : script.slice(start)
    const get = (label: string) => {
      const g = block.match(new RegExp(`-?\\s*${label}[：:]\\s*([^\\n]+)`))
      return g ? g[1].trim() : ''
    }
    const shotArr: { no: string; desc: string }[] = []
    const gm = block.match(/-?\s*关键画面[\s\S]*?\n((?:.*\n)*?)(?=\n?\s*-?\s*对白|$)/)
    if (gm) {
      for (const line of gm[1].split('\n')) {
        const mm = line.match(/[-*]\s*镜头([\d\-]+)[：:]\s*(.+)/)
        if (mm) shotArr.push({ no: mm[1].trim(), desc: mm[2].trim() })
      }
    }
    const { dialogue, sfx } = parseDialogueBlock(block)
    shots.push({
      no,
      location: loc,
      time: tm,
      goal: get('分镜目标'),
      mood: get('情绪基调'),
      bgm: get('背景音乐'),
      duration: get('时长'),
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
