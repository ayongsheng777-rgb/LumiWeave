// =====================================================================
// 媒体模型预设注册表（V2.4 节点即画面改造）
// 把主流云端视频/图片模型预置成清单，每个模型带：
//   - 能力说明（desc）、是否 New 标记
//   - 支持时长/分辨率/比例、是否支持图生视频/多参考
//   - 运镜参数落地方式：native(模型专属字段) / prompt(拼进提示词) / none
//   - 预估成本（仅展示，非计费）
//   - family：用于匹配「设置-接口」里已配置的 Provider
//   - modelId：真正发给后端的模型名
// =====================================================================

export interface MediaPreset {
  key: string
  name: string
  desc: string
  badge?: string
  kind: 'video' | 'image'
  family: string        // 平台家族关键词（匹配 provider endpoint/name）
  modelId: string       // 实际 API 模型名
  renderMode: 'cloud' | 'comfyui'
  durations?: number[]  // 秒（视频）
  resolutions?: string[] // 720p/1080p（视频） 或 1K/2K/4K（图片）
  ratios: string[]
  cameraControl: 'native' | 'prompt' | 'none'
  i2v?: boolean         // 支持首帧生视频
  multiRef?: boolean    // 支持多参考图生视频
  estPerSec?: number    // 预估成本：点数/秒
  estPerImage?: number  // 预估成本：点数/张
}

// ── 运镜中文对照（value 存英文，展示中英双文）──────────────
export const CAMERA_MOVES: { value: string; zh: string }[] = [
  { value: 'static', zh: '固定镜头' },
  { value: 'follow', zh: '跟随拍摄' },
  { value: 'orbit', zh: '环绕' },
  { value: 'crane up', zh: '盘旋抬升' },
  { value: 'crane down', zh: '盘旋下降' },
  { value: 'tilt up', zh: '镜头上摇' },
  { value: 'tilt down', zh: '镜头下摇' },
  { value: 'pan left', zh: '镜头左摇' },
  { value: 'pan right', zh: '镜头右摇' },
  { value: 'push in', zh: '推近' },
  { value: 'pull out', zh: '拉远' },
  { value: 'handheld', zh: '手持' },
]

export function cameraZh(v: string): string {
  return CAMERA_MOVES.find((c) => c.value === v)?.zh || v
}

// ── 打光方向 ────────────────────────────────────────────
export const LIGHT_DIRECTIONS = [
  { value: 'front', zh: '前方顺光' },
  { value: 'left', zh: '左侧光' },
  { value: 'top', zh: '顶光' },
  { value: 'back', zh: '后方逆光' },
  { value: 'right', zh: '右侧光' },
  { value: 'bottom', zh: '底光' },
]

// ── 摄像机预设 ──────────────────────────────────────────
export const CAMERA_BODIES = ['RED KOMODO', 'ARRI Alexa Mini', 'Sony FX3', 'Sony A7S3', 'Canon R5', 'Blackmagic Pocket']
export const LENSES = ['Cinemad Prime 35mm', 'Zeiss Supreme 25mm', 'Atlas Orion Anamorphic', 'Cooke S4/i 50mm', 'Canon Zoom 24-70mm', 'iPhone 广角']
export const FOCAL_LENGTHS = ['8mm', '16mm', '24mm', '35mm', '50mm', '85mm', '135mm']
export const APERTURES = ['f/1.2', 'f/1.4', 'f/2', 'f/2.8', 'f/4', 'f/5.6', 'f/8', 'f/16']

// ── 视频模型预设（对齐参考图的模型下拉）──────────────────
export const VIDEO_PRESETS: MediaPreset[] = [
  {
    key: 'seedance-2.5', name: 'Seedance 2.5', kind: 'video', family: 'seedance',
    modelId: 'doubao-seedance-2-5-pro', renderMode: 'cloud',
    desc: '多分辨率专业影视模型，支持多模态参考生成',
    durations: [5, 10, 12], resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3'], cameraControl: 'native', i2v: true, multiRef: true,
    estPerSec: 180,
  },
  {
    key: 'seedance-2.0', name: 'Seedance 2.0', kind: 'video', family: 'seedance',
    modelId: 'doubao-seedance-2-0-pro', renderMode: 'cloud',
    desc: '多分辨率专业影视模型，支持多模态参考生成',
    durations: [5, 10, 12], resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3'], cameraControl: 'native', i2v: true, multiRef: true,
    estPerSec: 120,
  },
  {
    key: 'seedance-2.0-fast', name: 'Seedance 2.0 fast', badge: 'New', kind: 'video', family: 'seedance',
    modelId: 'doubao-seedance-2-0-lite', renderMode: 'cloud',
    desc: 'Seedance 2.0 极速版，速度快、成本低',
    durations: [5, 10], resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1'], cameraControl: 'native', i2v: true, multiRef: false,
    estPerSec: 60,
  },
  {
    key: 'seedance-2.0-mini', name: 'Seedance 2.0 mini', badge: 'New', kind: 'video', family: 'seedance',
    modelId: 'doubao-seedance-2-0-mini', renderMode: 'cloud',
    desc: '轻量级 Seedance，快速试片首选',
    durations: [5, 10], resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1'], cameraControl: 'native', i2v: true, multiRef: false,
    estPerSec: 30,
  },
  {
    key: 'minimax-h3', name: 'MiniMax H3', badge: 'New', kind: 'video', family: 'minimax',
    modelId: 'MiniMax-H3', renderMode: 'cloud',
    desc: '多模态参考生视频，支持参考图片、视频和音频',
    durations: [6, 10], resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3'], cameraControl: 'native', i2v: true, multiRef: true,
    estPerSec: 150,
  },
  {
    key: 'kling-3.0-omni', name: '可灵 3.0 Omni', kind: 'video', family: 'kling',
    modelId: 'kling-v3-omni', renderMode: 'cloud',
    desc: '全能多模态输入，直出音画和分镜',
    durations: [5, 10], resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3'], cameraControl: 'native', i2v: true, multiRef: true,
    estPerSec: 140,
  },
  {
    key: 'kling-o1', name: '可灵 O1', kind: 'video', family: 'kling',
    modelId: 'kling-v1-6', renderMode: 'cloud',
    desc: '可灵旗舰文生视频，动态自然',
    durations: [5, 10], resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3'], cameraControl: 'native', i2v: true, multiRef: false,
    estPerSec: 100,
  },
  {
    key: 'pixverse-c1', name: 'Pixverse C1', badge: 'New', kind: 'video', family: 'pixverse',
    modelId: 'pixverse-c1', renderMode: 'cloud',
    desc: '为影视而生，打斗/特效升级，多宫格分镜叙事',
    durations: [5, 8, 10], resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1'], cameraControl: 'prompt', i2v: true, multiRef: false,
    estPerSec: 90,
  },
  {
    key: 'pixverse-v6', name: 'Pixverse V6', kind: 'video', family: 'pixverse',
    modelId: 'pixverse-v6', renderMode: 'cloud',
    desc: 'Pixverse 主力版本，稳定性强',
    durations: [5, 8], resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1'], cameraControl: 'prompt', i2v: true, multiRef: false,
    estPerSec: 70,
  },
  {
    key: 'happyhorse-1.1', name: 'HappyHorse-1.1', kind: 'video', family: 'happyhorse',
    modelId: 'HappyHorse-1.1', renderMode: 'cloud',
    desc: '更稳动态表现力、更高生成一致性、更优视觉质感',
    durations: [5, 10], resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1'], cameraControl: 'prompt', i2v: true, multiRef: false,
    estPerSec: 80,
  },
  {
    key: 'happyhorse-1.0', name: 'HappyHorse-1.0', kind: 'video', family: 'happyhorse',
    modelId: 'HappyHorse-1.0', renderMode: 'cloud',
    desc: 'HappyHorse 基础版',
    durations: [5, 10], resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1'], cameraControl: 'prompt', i2v: true, multiRef: false,
    estPerSec: 60,
  },
  {
    key: 'happyhorse-1.0-edit', name: 'HappyHorse-1.0-edit', kind: 'video', family: 'happyhorse',
    modelId: 'HappyHorse-1.0-edit', renderMode: 'cloud',
    desc: 'HappyHorse 编辑版，支持参考图一致性',
    durations: [5, 10], resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1'], cameraControl: 'prompt', i2v: true, multiRef: true,
    estPerSec: 80,
  },
  // ── 本地 ComfyUI 模型 ──────────────────────────────────
  {
    key: 'ltx-2.5', name: 'LTX Video 2.5', kind: 'video', family: 'comfyui',
    modelId: 'ltx-video-2b.safetensors', renderMode: 'comfyui',
    desc: 'Lightricks 开源 DiT 视频模型，本地跑不限次数',
    durations: [3, 5, 8], resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1'], cameraControl: 'prompt', i2v: false, multiRef: false,
    estPerSec: 0,
  },
  {
    key: 'wan2.2-t2v', name: 'Wan2.2 文生视频', kind: 'video', family: 'siliconflow',
    modelId: 'Wan-AI/Wan2.2-T2V-A14B', renderMode: 'cloud',
    desc: '硅基流动 Wan2.2，开源高质文生视频',
    durations: [5, 10], resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1'], cameraControl: 'prompt', i2v: false, multiRef: false,
    estPerSec: 40,
  },
]

// ── 图片模型预设 ──────────────────────────────────────
export const IMAGE_PRESETS: MediaPreset[] = [
  {
    key: 'flux-dev', name: 'FLUX.1 dev', kind: 'image', family: 'siliconflow',
    modelId: 'black-forest-labs/FLUX.1-dev', renderMode: 'cloud',
    desc: '开源最强写实文生图，细节丰富',
    resolutions: ['1K', '2K'], ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    cameraControl: 'prompt', estPerImage: 12,
  },
  {
    key: 'flux-schnell', name: 'FLUX.1 schnell', kind: 'image', family: 'siliconflow',
    modelId: 'black-forest-labs/FLUX.1-schnell', renderMode: 'cloud',
    desc: 'FLUX 极速版，秒级出图',
    resolutions: ['1K', '2K'], ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    cameraControl: 'prompt', estPerImage: 6,
  },
  {
    key: 'qwen-image', name: '通义万相 Qwen-Image', kind: 'image', family: 'dashscope',
    modelId: 'Qwen/Qwen-Image', renderMode: 'cloud',
    desc: '阿里通义万相，中文语义理解强',
    resolutions: ['1K', '2K'], ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    cameraControl: 'prompt', estPerImage: 8,
  },
  {
    key: 'qwen-image-edit', name: 'Qwen-Image-Edit', kind: 'image', family: 'dashscope',
    modelId: 'Qwen/Qwen-Image-Edit-2509', renderMode: 'cloud',
    desc: '多图参考合成，角色/场景一致性最佳',
    resolutions: ['1K', '2K'], ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    cameraControl: 'prompt', estPerImage: 10,
  },
  {
    key: 'kolors', name: '可图 Kolors', kind: 'image', family: 'siliconflow',
    modelId: 'Kwai-Kolors/Kolors', renderMode: 'cloud',
    desc: '快手可图，中文国风/人像出色',
    resolutions: ['1K', '2K'], ratios: ['16:9', '9:16', '1:1'],
    cameraControl: 'prompt', estPerImage: 6,
  },
  {
    key: 'hunyuan-image', name: '混元生图', kind: 'image', family: 'hunyuan',
    modelId: 'hunyuan-image', renderMode: 'cloud',
    desc: '腾讯混元，中文语义与多模态好',
    resolutions: ['1K', '2K'], ratios: ['16:9', '9:16', '1:1', '4:3'],
    cameraControl: 'prompt', estPerImage: 8,
  },
  {
    key: 'sd3.5', name: 'Stable Diffusion 3.5', kind: 'image', family: 'siliconflow',
    modelId: 'stabilityai/stable-diffusion-3-5-large', renderMode: 'cloud',
    desc: 'Stability 最新开源，构图精准',
    resolutions: ['1K', '2K'], ratios: ['16:9', '9:16', '1:1'],
    cameraControl: 'prompt', estPerImage: 10,
  },
  // ── 本地 ComfyUI ──────────────────────────────────────
  {
    key: 'sdxl', name: 'SDXL（本地）', kind: 'image', family: 'comfyui',
    modelId: 'sd_xl_base_1.0.safetensors', renderMode: 'comfyui',
    desc: '本地 ComfyUI SDXL 底座，不限次数',
    resolutions: ['1K'], ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    cameraControl: 'prompt', estPerImage: 0,
  },
]

export function videoPreset(key: string): MediaPreset | undefined {
  return VIDEO_PRESETS.find((p) => p.key === key)
}
export function imagePreset(key: string): MediaPreset | undefined {
  return IMAGE_PRESETS.find((p) => p.key === key)
}
export function findPreset(key: string, kind: 'video' | 'image'): MediaPreset | undefined {
  return kind === 'video' ? videoPreset(key) : imagePreset(key)
}

// 比例 → 像素尺寸（云端 native image_size / ComfyUI 宽高）
export function ratioToSize(ratio: string, resolution: string = '1K'): string {
  const r = ratio || '16:9'
  if (resolution === '4K') {
    return { '16:9': '3840x2160', '9:16': '2160x3840', '1:1': '3072x3072', '4:3': '3072x2304', '3:4': '2304x3072' }[r] || '3840x2160'
  }
  if (resolution === '2K') {
    return { '16:9': '2048x1152', '9:16': '1152x2048', '1:1': '1536x1536', '4:3': '1536x1152', '3:4': '1152x1536' }[r] || '2048x1152'
  }
  return { '16:9': '1280x720', '9:16': '720x1280', '1:1': '1024x1024', '4:3': '1024x768', '3:4': '768x1024' }[r] || '1024x1024'
}

// 视频分辨率 → 高度（native 用）
export function resolutionToP(resolution: string): string {
  return resolution === '1080p' ? '1080p' : '720p'
}

// 匹配已配置 Provider（模型库候选：id=profile id，name 含平台·模型名）：按 family 关键词扫描
export function matchProvider(preset: MediaPreset, providers: { id: string; name: string; endpoint?: string }[]): string {
  if (preset.renderMode === 'comfyui') return ''
  if (!providers.length) return 'auto'
  const fam = preset.family.toLowerCase()
  const hit = providers.find((p) => {
    const hay = `${p.id} ${p.name} ${p.endpoint ?? ''}`.toLowerCase()
    return fam.split(/[-_]/).some((seg) => seg && hay.includes(seg))
  })
  return hit ? hit.id : 'auto'
}

// 根据模型能力把 UI 参数翻译成「提示词 + 模型专属字段(native)」
// camera/lighting/lens 若模型不支持 native 运镜，则拼进提示词
export interface NativeResult {
  prompt: string
  native: Record<string, unknown>
}

export function buildNative(
  preset: MediaPreset,
  base: {
    prompt: string
    camera?: string
    lightDirection?: string
    lightBrightness?: number
    colorTemp?: number
    lens?: string
    focal?: string
    aperture?: string
    cameraBody?: string
    resolution?: string
    ratio?: string
  },
): NativeResult {
  const native: Record<string, unknown> = {}
  let prompt = base.prompt || ''

  // 运镜：native 或 prompt 落地
  if (base.camera && base.camera !== 'static') {
    if (preset.cameraControl === 'native') {
      native[preset.family === 'minimax' || preset.family === 'pixverse' ? 'camera_movement' : 'camera_control'] = base.camera
    } else {
      prompt = [prompt, `镜头运镜：${cameraZh(base.camera)}`].filter(Boolean).join('，')
    }
  }

  // 打光 / 摄像机：一律拼进提示词（主流 API 无结构化字段）
  const lighting: string[] = []
  if (base.lightDirection) lighting.push(`${LIGHT_DIRECTIONS.find((d) => d.value === base.lightDirection)?.zh || base.lightDirection}`)
  if (base.colorTemp) lighting.push(`色温 ${base.colorTemp}K`)
  if (base.lightBrightness != null && base.lightBrightness !== 50) lighting.push(`亮度 ${base.lightBrightness}%`)
  if (lighting.length) prompt = [prompt, `打光：${lighting.join('、')}`].filter(Boolean).join('，')

  const cam: string[] = []
  if (base.cameraBody) cam.push(base.cameraBody)
  if (base.lens) cam.push(base.lens)
  if (base.focal) cam.push(`焦距${base.focal}`)
  if (base.aperture) cam.push(base.aperture)
  if (cam.length) prompt = [prompt, `摄影机：${cam.join(' ')}`].filter(Boolean).join('，')

  // 分辨率：视频转 height/720p，图片转 image_size
  if (preset.kind === 'video' && base.resolution) {
    native['height'] = resolutionToP(base.resolution)
  }
  if (preset.kind === 'image' && base.resolution && base.ratio) {
    native['image_size'] = ratioToSize(base.ratio, base.resolution)
  }

  return { prompt, native }
}
