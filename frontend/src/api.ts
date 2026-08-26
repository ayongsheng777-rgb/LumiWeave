const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

function getToken(): string | null {
  return localStorage.getItem('lumiweave_token')
}

function setToken(token: string) {
  localStorage.setItem('lumiweave_token', token)
}

function clearToken() {
  localStorage.removeItem('lumiweave_token')
}

async function request(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    clearToken()
    window.location.reload()
    throw new Error('未授权')
  }
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export { clearToken, setToken }

export async function getSetup() {
  return request('GET', '/auth/setup')
}

export async function login(otp: string) {
  const res = await request('POST', '/auth/login', { otp })
  if (res.ok && res.data.token) {
    setToken(res.data.token)
  }
  return res
}

export async function checkAuth() {
  const res = await request('GET', '/auth/check')
  return res.data as { authed: boolean }
}

export async function logout() {
  await request('POST', '/auth/logout')
  clearToken()
}

export async function resetOtp(otp: string) {
  return request('POST', '/auth/otp-reset', { otp })
}

export async function getProfiles() {
  return request('GET', '/ai/profiles')
}

export async function getModels() {
  return request('GET', '/ai/models')
}

export async function listPlatformModels(profileId?: string) {
  return request('GET', `/ai/models-list${profileId ? `?profile_id=${encodeURIComponent(profileId)}` : ''}`)
}

export async function upsertModel(payload: Record<string, unknown>) {
  return request('POST', '/ai/models', payload)
}

export async function deleteModel(modelId: string) {
  return request('DELETE', `/ai/models/${encodeURIComponent(modelId)}`)
}

export async function probe(profileId?: string) {
  return request('POST', '/ai/probe', { profile_id: profileId })
}

export async function autoBest(profileId?: string) {
  return request('POST', '/ai/auto-best', { profile_id: profileId })
}

export async function aiChat(payload: {
  system: string
  user: string
  profile_id?: string
  json_mode?: boolean
  scenario?: string
}) {
  return request('POST', '/ai/chat', payload)
}

export async function getAiStats() {
  return request('GET', '/ai/stats')
}

export async function getTokenSummary(days = 30) {
  return request('GET', `/token-usage/summary?days=${days}`)
}

export async function getProjectUsage(days = 30) {
  return request('GET', `/token-usage/project-usage?days=${days}`)
}

export async function getTokenToday() {
  return request('GET', '/token-usage/today')
}

export async function getPricing() {
  return request('GET', '/token-usage/pricing')
}

export async function upsertPricing(payload: Record<string, unknown>) {
  return request('POST', '/token-usage/pricing', payload)
}

export async function refreshOfficialPricing() {
  return request('POST', '/token-usage/pricing/refresh-official')
}

export async function deletePricing(id: number) {
  return request('DELETE', `/token-usage/pricing/${id}`)
}

// ==================== MCP（外部编程智能体接入） ====================

export async function getMcpInfo() {
  return request('GET', '/v2/mcp/info')
}

export async function listMcpClients() {
  return request('GET', '/v2/mcp/clients')
}

export async function createMcpClient(payload: { name: string; type: string; permissions: string[] }) {
  return request('POST', '/v2/mcp/clients', payload)
}

export async function deleteMcpClient(clientId: string) {
  return request('DELETE', `/v2/mcp/clients/${encodeURIComponent(clientId)}`)
}

// ==================== 技能库 Skills ====================

export async function getSkills() {
  return request('GET', '/skills')
}

export async function getSkillDetail(skillId: string) {
  return request('GET', `/skills/${skillId}`)
}

export async function reloadSkills() {
  return request('POST', '/skills/reload')
}

export async function executeSkill(payload: { skill_id: string; args?: unknown; context?: unknown }) {
  return request('POST', '/skills/execute', payload)
}

export async function setRiskySkills(permissions: string[]) {
  return request('POST', '/skills/risky', { permissions })
}

export async function upsertSkill(payload: Record<string, unknown>) {
  return request('POST', '/skills', payload)
}

export async function deleteSkill(skillId: string) {
  return request('DELETE', `/skills/${encodeURIComponent(skillId)}`)
}

export async function importSkillFromUrl(url: string) {
  return request('POST', '/skills/import-from-url', { url })
}

// ==================== 渲染器 Renderers ====================

export async function getRenderers() {
  return request('GET', '/renderers')
}

export async function upsertRenderer(payload: Record<string, unknown>) {
  return request('POST', '/renderers', payload)
}

export async function deleteRenderer(rendererId: string) {
  return request('DELETE', `/renderers/${encodeURIComponent(rendererId)}`)
}

export async function getRendererHealth(rendererId: string) {
  return request('GET', `/renderers/${rendererId}/health`)
}

// params 形如 {prompt, negative, seed, steps, width, height, ratio}
// mode: 'text2image' | 'text2video'
export async function rendererGenerate(
  rendererId: string,
  payload: { params: Record<string, unknown>; mode?: string },
) {
  return request('POST', `/renderers/${rendererId}/generate`, payload)
}

// 统一媒体生成入口（节点「生成」按钮）：kind image|video
export async function renderMedia(payload: {
  kind: string
  render_mode: string
  provider_id?: string
  model?: string
  renderer_id?: string
  params: Record<string, unknown>
}) {
  return request('POST', '/renderers/media/generate', payload)
}

// 图片上传（V2.3 图片一等公民）：multipart 直传，返回 {id, url}
export async function uploadImage(file: File) {
  const form = new FormData()
  form.append('file', file)
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/assets/upload`, { method: 'POST', headers, body: form })
  if (res.status === 401) {
    clearToken()
    window.location.reload()
    throw new Error('未授权')
  }
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// 提示词优化：知识库+技能库优先，AI 兜底
export async function promptOptimize(payload: { prompt: string; kind?: string; model?: string }) {
  return request('POST', '/ai/prompt-optimize', payload)
}

export async function rendererCancel(rendererId: string, promptId: string) {
  return request('POST', `/renderers/${rendererId}/cancel`, { prompt_id: promptId })
}

// 视频抽帧（V2.3 尾帧->首帧接龙）：mode first|last
export async function extractVideoFrame(videoUrl: string, mode: 'first' | 'last' = 'last') {
  return request('POST', '/assets/video/extract-frame', { video_url: videoUrl, mode })
}

// ==================== 知识库 Prompt KB ====================

export async function getKbList() {
  return request('GET', '/prompt-kb/list')
}

export async function kbAdd(title: string, content: string) {
  return request('POST', '/prompt-kb/add', { title, content })
}

export async function kbAddSource(kind: string, uri: string) {
  return request('POST', '/prompt-kb/sources', { kind, uri })
}

export async function kbSearch(q: string, k = 5) {
  return request('GET', `/prompt-kb/search?q=${encodeURIComponent(q)}&k=${k}`)
}

export async function kbSync() {
  return request('POST', '/prompt-kb/sync')
}

export async function kbDelete(kid: string) {
  return request('DELETE', `/prompt-kb/knowledge/${encodeURIComponent(kid)}`)
}

export async function kbDeleteSource(sid: string) {
  return request('DELETE', `/prompt-kb/sources/${encodeURIComponent(sid)}`)
}

// ==================== 画布工作流 ====================

export interface WorkflowGraphPayload {
  nodes: { id: string; type: string; data: Record<string, unknown> }[]
  edges: {
    id: string
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }[]
}

export async function workflowExecute(graph: WorkflowGraphPayload) {
  return request('POST', '/workflow/execute', graph)
}

function wsUrl(path: string): string {
  const base = import.meta.env.VITE_API_BASE_URL || '/api'
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${base}${path}?token=${encodeURIComponent(getToken() || '')}`
}

export function workflowExecuteWs(
  graph: WorkflowGraphPayload,
  onNode: (nodeId: string, status: string, result?: unknown) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl('/workflow/ws/execute'))
    let settled = false
    ws.onopen = () => ws.send(JSON.stringify(graph))
    ws.onmessage = (ev) => {
      let msg: { type: string; node_id?: string; status?: string; result?: unknown; final_output?: Record<string, unknown>; message?: string }
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.type === 'node_status') {
        onNode(msg.node_id || '', msg.status || 'idle', msg.result)
      } else if (msg.type === 'workflow_finished') {
        settled = true
        ws.close()
        resolve(msg.final_output || {})
      } else if (msg.type === 'error') {
        settled = true
        ws.close()
        reject(new Error(msg.message || '执行失败'))
      }
    }
    ws.onerror = () => {
      if (!settled) {
        settled = true
        reject(new Error('WebSocket 连接失败'))
      }
    }
    ws.onclose = () => {
      if (!settled) {
        settled = true
        reject(new Error('WebSocket 连接已关闭'))
      }
    }
  })
}

export async function runWorkflow(
  graph: WorkflowGraphPayload,
  onNode: (nodeId: string, status: string, result?: unknown) => void,
): Promise<Record<string, unknown>> {
  try {
    return await workflowExecuteWs(graph, onNode)
  } catch {
    const res = await workflowExecute(graph)
    if (!res.ok) throw new Error(res.data.error || '执行失败')
    const outputs: Record<string, unknown> = res.data.node_outputs || {}
    Object.keys(outputs).forEach((id) => onNode(id, 'completed', outputs[id]))
    return outputs
  }
}

// ==================== 工作流持久化（V2.1） ====================

export async function workflowSave(payload: {
  project_id: string
  workflow_id?: string
  name?: string
  graph: WorkflowGraphPayload
}) {
  return request('POST', '/workflow/save', payload)
}

export async function workflowLoad(workflowId: string) {
  return request('GET', `/workflow/load/${encodeURIComponent(workflowId)}`)
}

export async function workflowList(projectId: string) {
  return request('GET', `/workflow/list?project_id=${encodeURIComponent(projectId)}`)
}

export async function workflowDelete(workflowId: string) {
  return request('DELETE', `/workflow/delete/${encodeURIComponent(workflowId)}`)
}

export async function getNodeLibrary() {
  return request('GET', '/workflow/nodes')
}

// ==================== 画布对象（V2） ====================

export interface CanvasObject {
  id: string
  project_id?: string
  type: string
  content: Record<string, unknown>
  position: { x: number; y: number }
  size?: { width: number; height: number }
  layer?: number
  metadata?: Record<string, unknown>
  created_at?: string
}

export async function canvasListObjects(projectId: string) {
  return request('GET', `/canvas/${encodeURIComponent(projectId)}`)
}

export async function canvasCreateObject(payload: Record<string, unknown>) {
  return request('POST', '/canvas/object', payload)
}

export async function canvasBatchCreate(payload: { project_id: string; objects: Record<string, unknown>[] }) {
  return request('POST', '/canvas/object/batch', payload)
}

export async function canvasUpdateObject(id: string, fields: Record<string, unknown>) {
  return request('PUT', `/canvas/object/${id}`, fields)
}

export async function canvasDeleteObject(id: string) {
  return request('DELETE', `/canvas/object/${id}`)
}

export async function canvasApplyLayout(projectId: string, template: string) {
  return request('POST', '/layout/apply', { canvas_id: projectId, template })
}

export async function canvasGetGraph(projectId: string) {
  return request('GET', `/canvas/${encodeURIComponent(projectId)}/graph`)
}

export async function canvasCreateEdge(payload: Record<string, unknown>) {
  return request('POST', '/canvas/edge', payload)
}

export async function canvasDeleteEdge(edgeId: string) {
  return request('DELETE', `/canvas/edge/${encodeURIComponent(edgeId)}`)
}

export async function canvasSaveGraph(projectId: string, nodes: Record<string, unknown>[], edges: Record<string, unknown>[]) {
  return request('POST', `/canvas/${encodeURIComponent(projectId)}/graph/save`, { nodes, edges })
}

export async function aiBuildWorkflow(prompt: string) {
  return request('POST', '/canvas/build', { prompt })
}

export async function canvasFromWorkflow(workflowId: string, projectId: string) {
  return request('POST', '/canvas/from-workflow', { workflow_id: workflowId, project_id: projectId })
}

export async function canvasToWorkflow(projectId: string, name: string) {
  return request('POST', '/canvas/to-workflow', { project_id: projectId, name })
}

export async function getProviders() {
  return request('GET', '/providers')
}

export async function upsertProvider(payload: Record<string, unknown>) {
  return request('POST', '/providers', payload)
}

export async function deleteProvider(pid: string) {
  return request('DELETE', `/providers/${encodeURIComponent(pid)}`)
}

export async function routeProviders(payload: Record<string, unknown>) {
  return request('POST', '/providers/route', payload)
}

export async function getAssets(type?: string) {
  return request('GET', `/assets${type ? `?type=${encodeURIComponent(type)}` : ''}`)
}

export async function renameAsset(assetId: string, name: string) {
  return request('PATCH', `/assets/${encodeURIComponent(assetId)}`, { name })
}

export async function deleteAsset(assetId: string) {
  return request('DELETE', `/assets/${encodeURIComponent(assetId)}`)
}

// ==================== 影视创作 V2（MCP film 工具）=====================

// MCP HTTP 调用封装（复用当前登录 token）
async function mcpCall(toolName: string, params: Record<string, unknown>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const t = getToken()
  if (t) headers['Authorization'] = `Bearer ${t}`
  const res = await fetch(`${API_BASE}/mcp/call/${toolName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  })
  if (res.status === 401) {
    clearToken()
    window.location.reload()
    throw new Error('未授权')
  }
  return res.json().catch(() => ({ error: '网络错误' }))
}

export async function filmStoryParse(params: {
  text: string; genre?: string; style?: string; ratio?: string; duration?: number
}) {
  return mcpCall('film.story_parse', params)
}

export async function filmStoryboardGenerate(params: {
  characters_json?: string; scenes_json?: string;
  story_text?: string;
  genre?: string; style?: string; ratio?: string; total_duration?: number
}) {
  return mcpCall('film.storyboard_generate', params)
}

export async function filmCharacterGenerate(params: {
  name: string; description: string; prompt: string;
  style?: string; pose?: string; expression?: string;
  reference_urls?: string[]; seed?: string;
  render_mode?: string; provider_id?: string; model?: string; renderer_id?: string
}) {
  return mcpCall('film.character_generate', params)
}

export async function filmSceneGenerate(params: {
  name: string; location: string; time?: string; weather?: string;
  camera?: string; description: string; style?: string; reference_urls?: string[];
  render_mode?: string; provider_id?: string; model?: string; renderer_id?: string
}) {
  return mcpCall('film.scene_generate', params)
}

export async function filmPropGenerate(params: {
  name: string; description: string; prompt?: string; style?: string;
  reference_urls?: string[];
  render_mode?: string; provider_id?: string; model?: string; renderer_id?: string
}) {
  return mcpCall('film.prop_generate', params)
}

export async function filmVideoGenerate(params: {
  prompt: string; mode?: string; duration?: number; ratio?: string; camera?: string;
  image_url?: string; reference_images?: string[];
  render_mode?: string; provider_id?: string; model?: string; renderer_id?: string
}) {
  return mcpCall('film.video_generate', params)
}

export async function filmSubtitleGenerate(params: {
  video_url?: string; audio_url?: string; subtitle_content?: string; format?: string
}) {
  return mcpCall('film.subtitle_generate', params)
}

export async function filmExport(params: {
  format?: string; video_url?: string; subtitle_url?: string;
  include_storyboard?: boolean; include_subtitles?: boolean
}) {
  return mcpCall('film.export', params)
}
