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

/** 单模型配置内按场景一键优选（实测连通后写回 scene_models[scene]） */
export async function autoBestScene(profileId: string, scene: string) {
  return request('POST', '/ai/auto-best-scene', { profile_id: profileId, scene })
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

// ==================== 知识库 Prompt Learning ====================
// 🔴 后端挂载前缀是 /api/prompt-kb（此前写成 /prompt-learning 导致 404，知识库全站不可用）

export async function promptLearningList() {
  return request('GET', '/prompt-kb/list')
}

export async function promptLearningSearch(q: string, k = 5) {
  return request('GET', `/prompt-kb/search?q=${encodeURIComponent(q)}&k=${k}`)
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

// 获取 ComfyUI 可用工作流能力：checkpoints/loras/samplers + 节点包检测
export async function getRendererWorkflows(rendererId: string) {
  return request('GET', `/renderers/${rendererId}/workflows`)
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
  profile_id?: string
  params: Record<string, unknown>
}) {
  return request('POST', '/renderers/media/generate', payload)
}

// 素材上传（图片/视频/音频）：multipart 直传，返回 {id, url, type}
// 传 sceneId 时素材归入该场景素材库（场景内「素材/从资产选择」可见）
export async function uploadImage(file: File, sceneId?: string) {
  const form = new FormData()
  form.append('file', file)
  if (sceneId) form.append('scene_id', sceneId)
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

// 视频抽帧：mode first|last|current，timeSeconds 仅 current 模式使用
export async function extractVideoFrame(videoUrl: string, mode: 'first' | 'last' | 'current' = 'last', timeSeconds?: number) {
  return request('POST', '/assets/video/extract-frame', { video_url: videoUrl, mode, ...(timeSeconds != null ? { time_seconds: timeSeconds } : {}) })
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
  nodes: {
    id: string
    type: string
    data: Record<string, unknown>
    position?: { x: number; y: number }
    style?: Record<string, unknown>
  }[]
  edges: {
    id: string
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
    data?: Record<string, unknown>
  }[]
  /** 画布视口（通用画布 V2：随图落库，加载时还原） */
  viewport?: { x: number; y: number; zoom: number }
  /** 素材节点自动编号计数器（通用画布 V2） */
  titleCounters?: Record<string, number>
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

/** 模型库 → 生成方式候选列表（id=模型库 profile id，后端渲染时直连；替代商业接口 providers 预设）
 *  scene 传 'image'|'video'|'audio'|'prompt'|'kb'|'skills' 时按「适用场景」过滤；不传=全部（含通用）。 */
export async function getModelChoices(scene?: string) {
  const res = await getProfiles()
  const all =
    (((res.data as { profiles?: { id: string; name?: string; model?: string; scenes?: string[] }[] } | undefined)?.profiles) ||
      []).filter((p) => p && p.id && p.model)
  const list = scene
    ? all.filter((p) => {
        const s = p.scenes
        if (!s || !s.length) return true // 未设场景=通用
        return s.includes('general') || s.includes(scene)
      })
    : all
  return {
    ok: res.ok,
    data: {
      providers: list.map((p) => ({
        id: p.id,
        name: `${p.name || p.id} · ${p.model}`,
        models: [p.model as string],
        status: 'enabled',
      })),
    },
  }
}

export async function getAssets(type?: string) {
  return request('GET', `/assets${type ? `?type=${encodeURIComponent(type)}` : ''}`)
}

/** 素材保存目录：读取/设置（本地目录，默认 DATA_DIR/uploads） */
export async function getAssetsDir() {
  return request('GET', '/assets/dir')
}

export async function setAssetsDir(dir: string) {
  return request('POST', '/assets/dir', { dir })
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

// ==================== V2.5 Render API（规格书 §4）========================

export interface RenderRequest {
  /** VisualIntent 字典，直接对应后端 VisualIntent 模型 */
  visual_intent: Record<string, unknown>
  capability_required?: string[]
}

export interface RenderResponse {
  job_id: string
  status: string
}

export interface RenderJob {
  id: string
  canvas_id: string
  node_id: string
  render_plan: Record<string, unknown>
  engine: string
  model: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  cost: number
  created_at: string
}

/** POST /api/render/create — 规格书 §4 渲染提交 */
export async function submitRender(payload: RenderRequest): Promise<RenderResponse> {
  const res = await request('POST', '/render/create', payload)
  return res.data as RenderResponse
}

/** GET /api/render/status/{job_id} — 规格书 §4 任务状态轮询 */
export async function queryRenderJob(jobId: string): Promise<RenderJob> {
  const res = await request('GET', `/render/status/${encodeURIComponent(jobId)}`)
  return res.data as RenderJob
}

/** POST /api/render/cancel/{job_id} — 规格书 §4 任务取消 */
export async function cancelRenderJob(jobId: string) {
  return request('POST', `/render/cancel/${encodeURIComponent(jobId)}`)
}

// ==================== V2.5 Scene Engine API（规格书 §58）==================

export interface SceneObjectMeta {
  label: string
  color: string
  icon?: string
  default_data?: Record<string, unknown>
  fields?: Record<string, string>
}

export interface SceneTypeDef {
  id: string
  name: string
  category: string
  description: string
  version: string
  object_types: string[]
  actions: string[]
  toolbar: string[]
  inspector: string[]
  timeline_enabled: boolean
  object_library: Record<string, SceneObjectMeta>
}

export interface SceneInstance {
  id: string
  project_id: string
  scene_type: string
  name: string
  version: number
  data: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export interface SceneObjectDTO {
  id: string
  scene_id: string
  object_type: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  z_index: number
  locked: boolean
  hidden: boolean
  data: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface SceneEdgeDTO {
  id: string
  scene_id: string
  source_id: string
  target_id: string
  edge_type: string
  data: Record<string, unknown>
}

/** GET /api/scenes/types — 场景注册表（工具条 / Inspector 动态渲染依据） */
export async function sceneTypes() {
  return request('GET', '/scenes/types')
}

/** GET /api/scenes/templates — 场景模板列表（§39） */
export async function sceneTemplates() {
  return request('GET', '/scenes/templates')
}

/** GET /api/scenes?project_id= — 该项目下的场景实例 */
export async function sceneList(projectId = 'default') {
  return request('GET', `/scenes?project_id=${encodeURIComponent(projectId)}`)
}

/** POST /api/scenes — 新建场景实例 */
export async function sceneCreate(
  payload: { scene_type: string; name?: string; data?: Record<string, unknown> },
  projectId = 'default',
) {
  return request('POST', `/scenes?project_id=${encodeURIComponent(projectId)}`, payload)
}

/** GET /api/scenes/{id} — 场景全量（含 objects + edges） */
export async function sceneGet(sceneId: string) {
  return request('GET', `/scenes/${encodeURIComponent(sceneId)}`)
}

export async function sceneUpdate(sceneId: string, payload: Record<string, unknown>) {
  return request('PUT', `/scenes/${encodeURIComponent(sceneId)}`, payload)
}

export async function sceneDelete(sceneId: string) {
  return request('DELETE', `/scenes/${encodeURIComponent(sceneId)}`)
}

/** POST /api/scenes/{id}/objects — 新建专业对象 */
export async function sceneObjectCreate(sceneId: string, payload: Record<string, unknown>) {
  return request('POST', `/scenes/${encodeURIComponent(sceneId)}/objects`, payload)
}

export async function sceneObjectUpdate(
  sceneId: string,
  objectId: string,
  payload: Record<string, unknown>,
) {
  return request(
    'PUT',
    `/scenes/${encodeURIComponent(sceneId)}/objects/${encodeURIComponent(objectId)}`,
    payload,
  )
}

export async function sceneObjectDelete(sceneId: string, objectId: string) {
  return request(
    'DELETE',
    `/scenes/${encodeURIComponent(sceneId)}/objects/${encodeURIComponent(objectId)}`,
  )
}

export async function sceneEdgeCreate(
  sceneId: string,
  payload: { source: string; target: string; edge_type?: string },
) {
  return request('POST', `/scenes/${encodeURIComponent(sceneId)}/edges`, payload)
}

export async function sceneEdgeDelete(sceneId: string, edgeId: string) {
  return request(
    'DELETE',
    `/scenes/${encodeURIComponent(sceneId)}/edges/${encodeURIComponent(edgeId)}`,
  )
}

/** POST /api/scenes/{id}/actions — 执行场景动作（分析 / 生成 / 批量） */
export async function sceneRunAction(
  sceneId: string,
  payload: { action: string; object_ids?: string[]; parameters?: Record<string, unknown> },
) {
  return request('POST', `/scenes/${encodeURIComponent(sceneId)}/actions`, payload)
}

export async function sceneAnalyze(
  sceneId: string,
  objectIds: string[] = [],
  parameters: Record<string, unknown> = {},
) {
  return request('POST', `/scenes/${encodeURIComponent(sceneId)}/analyze`, {
    object_ids: objectIds,
    parameters,
  })
}

export async function sceneBatch(
  sceneId: string,
  objectIds: string[] = [],
  parameters: Record<string, unknown> = {},
) {
  return request('POST', `/scenes/${encodeURIComponent(sceneId)}/batch`, {
    object_ids: objectIds,
    parameters,
  })
}

// ── 场景版本（§35）────────────────────────────────────────────────────────
export interface SceneVersion {
  id: string
  scene_id: string
  version: number
  label: string
  created_at: string
}

export async function sceneSaveVersion(sceneId: string, label: string) {
  return request('POST', `/scenes/${encodeURIComponent(sceneId)}/versions`, { label })
}

export async function sceneListVersions(sceneId: string) {
  return request('GET', `/scenes/${encodeURIComponent(sceneId)}/versions`)
}

export async function sceneRestoreVersion(sceneId: string, versionId: string) {
  return request('POST', `/scenes/${encodeURIComponent(sceneId)}/versions/${encodeURIComponent(versionId)}/restore`)
}

// ── 素材库（§37/§38）──────────────────────────────────────────────────────
export interface SceneAsset {
  id: string
  type: string
  url: string
  name: string
  scene_id: string
  metadata: Record<string, unknown>
  created_at: string
}

export async function sceneListAssets(sceneId: string, assetType = '') {
  const q = assetType ? `?type=${encodeURIComponent(assetType)}` : ''
  return request('GET', `/scenes/${encodeURIComponent(sceneId)}/assets${q}`)
}

// ── 影视拉片：上传 + 拆镜（§14/§15/§68）──────────────────────────────────
export async function sceneFilmUpload(sceneId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  // 🔴 必须带 Bearer 令牌：/api/scenes/* 被 auth_guard 拦截，裸 fetch 会 401 静默失败
  const token = getToken()
  const res = await fetch(`${API_BASE}/scenes/${encodeURIComponent(sceneId)}/film/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export async function sceneFilmAnalyze(sceneId: string, videoUrl: string) {
  return request('POST', `/scenes/${encodeURIComponent(sceneId)}/film/analyze`, { video_url: videoUrl })
}

// ── 商业化套餐（§73 / P2-03）──────────────────────────────────────────────
export interface Plan {
  id: string
  name: string
  price: number
  limits: Record<string, number>
  features: string[]
}

export async function scenePlans() {
  return request('GET', '/scenes/plans')
}

export async function sceneSetPlan(planId: string) {
  return request('POST', '/scenes/plans', { plan: planId })
}

// ── 营销模板（§26 / P2-01）───────────────────────────────────────────────
export interface MarketingTemplate {
  id: string
  name: string
  category: string
  platform: string
  description: string
  object_types: string[]
  actions: string[]
}

export async function sceneMarketingTemplates(sceneId: string, category = '') {
  const q = category ? `?category=${encodeURIComponent(category)}` : ''
  return request('GET', `/scenes/${encodeURIComponent(sceneId)}/templates${q}`)
}

export async function sceneApplyTemplate(sceneId: string, templateId: string) {
  return request('POST', `/scenes/${encodeURIComponent(sceneId)}/templates/${encodeURIComponent(templateId)}/apply`)
}

// ── 异步任务进度（§54 / P2-06）───────────────────────────────────────────
export async function sceneTaskProgress(sceneId: string, taskId: string) {
  return request('GET', `/scenes/${encodeURIComponent(sceneId)}/tasks/${encodeURIComponent(taskId)}`)
}

// ── AI 导演台（Director Orchestrator）─────────────────────────────────────
export async function directorCreate(payload: { scene_id: string; story_id?: string; project_id?: string; generate_video?: boolean; style?: string }) {
  return request('POST', '/director/create', payload)
}
export async function directorTaskGet(taskId: string) {
  return request('GET', `/director/task/${encodeURIComponent(taskId)}`)
}
export async function directorTasks(sceneId: string) {
  return request('GET', `/director/tasks?scene_id=${encodeURIComponent(sceneId)}`)
}
export async function directorTaskVideo(taskId: string) {
  return request('POST', `/director/task/${encodeURIComponent(taskId)}/video`, {})
}
