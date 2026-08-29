// nodeLibrary —— 影视节点定义【单一事实源】（2026-08-29 合并）
// 此前 workflowStore.NODE_DEFAULTS 与 canvasStore.OBJECT_LIBRARY 是同一套 13 节点的
// 两份手写拷贝，极易漂移。现在统一定义在此：
//   - defaultData 取 workflowStore 版（含 status 字段，是超集）
//   - label/size 取 canvasStore 版（画布对象库元数据）
//   - text/note/ai_result 为无限画布独有对象，保留
// 两套 store 均从这里取数，加节点只改这一个文件。

export interface NodeDef {
  type: string
  label: string
  defaultData: Record<string, unknown>
  size: { width: number; height: number }
}

export const NODE_LIBRARY: NodeDef[] = [
  // ── 创作入口 ──────────────────────────────────────────────
  {
    type: 'image_input', label: '图片上传',
    defaultData: { url: '', filename: '', status: 'idle' },
    size: { width: 240, height: 300 },
  },
  {
    type: 'story', label: '故事输入',
    defaultData: {
      text: '', genre: '科幻', style: '电影感', ratio: '16:9', duration: 30,
      video_mode: 'auto_full',
      characters: [], scenes: [], props: [], storyboard: [], shots: [],
      character_urls: {}, scene_urls: {}, prop_urls: {}, status: 'idle',
    },
    size: { width: 280, height: 430 },
  },
  // ── 资产生成 ──────────────────────────────────────────────
  {
    type: 'character', label: '角色',
    defaultData: {
      name: '', description: '', prompt: '', reference: [], style: '电影感',
      pose: '', expression: '', seed: '', character_id: '', status: 'idle',
    },
    size: { width: 280, height: 620 },
  },
  {
    type: 'scene', label: '场景',
    defaultData: {
      name: '', location: '', time: '白天', weather: '晴', camera: 'wide shot',
      description: '', prompt: '', style: '电影感', reference: [], scene_id: '', status: 'idle',
    },
    size: { width: 280, height: 520 },
  },
  {
    type: 'prop', label: '道具',
    defaultData: {
      name: '', description: '', prompt: '', reference: [],
      bind_type: '', bind_id: '', prop_id: '', status: 'idle',
    },
    size: { width: 280, height: 480 },
  },
  // ── 分镜 ─────────────────────────────────────────────────
  {
    type: 'storyboard', label: '分镜',
    defaultData: { shots: [], total_duration: 0, ratio: '16:9', style: '电影感', status: 'idle' },
    size: { width: 340, height: 640 },
  },
  // ── 媒体生成 ──────────────────────────────────────────────
  {
    type: 'image', label: '图片',
    defaultData: {
      prompt: '', negative: '', reference: [], character_ids: [], scene_id: '',
      ratio: '16:9', style: '电影感', model: '', url: '', status: 'idle',
    },
    size: { width: 280, height: 520 },
  },
  {
    type: 'video', label: '视频',
    defaultData: {
      prompt: '', images: [], character_ids: [], camera: 'static', duration: 10,
      fps: 24, ratio: '16:9', style: '电影感', renderer_id: '', video_url: '', status: 'idle',
    },
    size: { width: 300, height: 640 },
  },
  // ── 后期 ─────────────────────────────────────────────────
  {
    type: 'audio', label: '声音',
    defaultData: {
      type: 'narration', script: '', voice: '默认',
      music_url: '', sfx_urls: [], audio_url: '', status: 'idle',
    },
    size: { width: 260, height: 240 },
  },
  {
    type: 'subtitle', label: '字幕',
    defaultData: {
      video_url: '', audio_url: '', format: 'srt', content: '',
      burnt_in: false, subtitle_url: '', status: 'idle',
    },
    size: { width: 260, height: 240 },
  },
  {
    type: 'layout', label: '排版',
    defaultData: { template: 'film_poster', elements: [], ratio: '16:9', status: 'idle' },
    size: { width: 280, height: 260 },
  },
  {
    type: 'export', label: '导出',
    defaultData: {
      format: 'mp4', video_url: '', subtitle_url: '',
      include_storyboard: true, include_subtitles: true, export_path: '', status: 'idle',
    },
    size: { width: 260, height: 220 },
  },
  // ── 通用辅助 ──────────────────────────────────────────────
  {
    type: 'prompt', label: '提示词模板',
    defaultData: { template: '', query: '', status: 'idle' },
    size: { width: 260, height: 200 },
  },
  // ── 无限画布独有对象 ──────────────────────────────────────
  {
    type: 'text', label: '文本',
    defaultData: { text: '', kind: 'text', url: '', status: 'idle' },
    size: { width: 260, height: 220 },
  },
  {
    type: 'note', label: '便签',
    defaultData: { text: '', kind: 'text', url: '', status: 'idle' },
    size: { width: 240, height: 180 },
  },
  {
    type: 'ai_result', label: 'AI 结果',
    defaultData: { text: '', kind: 'text', url: '', status: 'idle' },
    size: { width: 260, height: 220 },
  },
]

/** 类型 → 默认数据（workflowStore 消费） */
export const NODE_DEFAULTS: Record<string, Record<string, unknown>> = Object.fromEntries(
  NODE_LIBRARY.map((d) => [d.type, d.defaultData]),
)

/** 画布对象库（canvasStore 消费） */
export const OBJECT_LIBRARY: NodeDef[] = NODE_LIBRARY
