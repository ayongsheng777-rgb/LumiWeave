// api/client.ts —— API v2 客户端（MCP 改造 + 影视创作节点系统 V2）
// 供前端 MCP 面板与画布调用 v2 端点，复用 token 鉴权。

const V2_BASE = '/api/v2'

function token(): string | null {
  return localStorage.getItem('lumiweave_token')
}

async function v2(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const t = token()
  if (t) headers['Authorization'] = `Bearer ${t}`
  const res = await fetch(`${V2_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export const canvasClient = {
  get: (pid: string) => v2('GET', `/canvas/${encodeURIComponent(pid)}`),
  create: (payload: Record<string, unknown>) => v2('POST', '/object', payload),
  update: (oid: string, changes: Record<string, unknown>) => v2('PUT', `/object/${encodeURIComponent(oid)}`, { changes }),
  remove: (oid: string) => v2('DELETE', `/object/${encodeURIComponent(oid)}`),
}

export const workflowClient = {
  create: (payload: Record<string, unknown>) => v2('POST', '/workflow', payload),
  run: (wid: string, payload: Record<string, unknown> = {}) => v2('POST', `/workflow/${encodeURIComponent(wid)}/run`, payload),
  task: (tid: string) => v2('GET', `/task/${encodeURIComponent(tid)}`),
}

export const providerClient = {
  list: () => v2('GET', '/providers'),
  test: (id: string) => v2('POST', '/provider/test', { id }),
  route: (payload: Record<string, unknown>) => v2('POST', '/provider/route', payload),
}

export const mcpClient = {
  info: () => v2('GET', '/mcp/info'),
  clients: () => v2('GET', '/mcp/clients'),
  createClient: (payload: Record<string, unknown>) => v2('POST', '/mcp/clients', payload),
  deleteClient: (cid: string) => v2('DELETE', `/mcp/clients/${encodeURIComponent(cid)}`),
}

// ── 影视创作 V2 — MCP film 工具封装 ─────────────────────────────────
// 直接调用 MCP HTTP 端点（复用 canvasClient 的 token）
const MCP_BASE = '/mcp'

async function mcp(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const t = token()
  if (t) headers['Authorization'] = `Bearer ${t}`
  const res = await fetch(`${MCP_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return res.json().catch(() => ({ error: '解析失败' }))
}

// StoryNode — AI 故事解析
export async function filmStoryParse(params: {
  text: string
  genre?: string
  style?: string
  ratio?: string
  duration?: number
}) {
  return mcp('POST', '/call/film.story_parse', params)
}

// StoryboardNode — 生成分镜
export async function filmStoryboardGenerate(params: {
  characters_json?: string
  scenes_json?: string
  genre?: string
  style?: string
  ratio?: string
  total_duration?: number
}) {
  return mcp('POST', '/call/film.storyboard_generate', params)
}

// CharacterNode — 生成角色图
export async function filmCharacterGenerate(params: {
  name: string
  description: string
  prompt: string
  style?: string
  pose?: string
  expression?: string
  reference_urls?: string[]
  seed?: string
}) {
  return mcp('POST', '/call/film.character_generate', params)
}

// SceneNode — 生成场景图
export async function filmSceneGenerate(params: {
  name: string
  location: string
  time?: string
  weather?: string
  camera?: string
  description: string
  style?: string
  reference_urls?: string[]
}) {
  return mcp('POST', '/call/film.scene_generate', params)
}

// SubtitleNode — 生成字幕
export async function filmSubtitleGenerate(params: {
  video_url?: string
  audio_url?: string
  subtitle_content?: string
  format?: string
}) {
  return mcp('POST', '/call/film.subtitle_generate', params)
}

// ExportNode — 导出项目
export async function filmExport(params: {
  format?: string
  video_url?: string
  subtitle_url?: string
  include_storyboard?: boolean
  include_subtitles?: boolean
}) {
  return mcp('POST', '/call/film.export', params)
}
