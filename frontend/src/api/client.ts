// api/client.ts —— API v2 客户端（MCP 改造）
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
