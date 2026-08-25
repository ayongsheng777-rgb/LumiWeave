// 运镜/镜头类型中英对照表（分镜、视频节点的下拉显示中英双文，value 仍存英文）

export const CAMERA_ZH: Record<string, string> = {
  'wide shot': '远景/广角',
  'medium shot': '中景',
  'close-up': '特写',
  'extreme close-up': '大特写',
  'birds-eye view': '鸟瞰/俯拍',
  'worm-eye view': '仰拍/虫视',
  'low angle': '低角度仰拍',
  'high angle': '高角度俯拍',
  'dolly in': '推近',
  'dolly out': '拉远',
  'dolly': '移动车',
  'pan left': '左摇',
  'pan right': '右摇',
  'tilt up': '上摇',
  'tilt down': '下摇',
  'tracking': '跟拍',
  'handheld': '手持',
  'orbit': '环绕',
  'static': '静止',
  'slow push-in': '慢推近',
  'zoom-in': '推近',
  'zoom-out': '拉远',
  'over-the-shoulder': '过肩镜头',
  'dutch angle': '倾斜镜头',
  'aerial view': '航拍',
}

// 中文 → 英文（LLM 生成的中文镜头名，尽量映射回英文 value）
export const CAMERA_EN: Record<string, string> = {
  '远景': 'wide shot',
  '广角': 'wide shot',
  '中景': 'medium shot',
  '特写': 'close-up',
  '大特写': 'extreme close-up',
  '鸟瞰': 'birds-eye view',
  '俯拍': 'high angle',
  '仰拍': 'low angle',
  '推近': 'dolly in',
  '拉远': 'dolly out',
  '左摇': 'pan left',
  '右摇': 'pan right',
  '跟拍': 'tracking',
  '手持': 'handheld',
  '环绕': 'orbit',
  '静止': 'static',
  '过肩': 'over-the-shoulder',
  '倾斜': 'dutch angle',
  '航拍': 'aerial view',
}

// 显示用：英文镜头名 → "wide shot · 远景/广角"；中文镜头名 → 原样
export function cameraLabel(c: string): string {
  if (!c) return ''
  const zh = CAMERA_ZH[c] || CAMERA_ZH[c.replace(/-/g, ' ')]
  if (zh) return `${c} · ${zh}`
  return c
}

// 规范化：中文镜头名尽量转英文 value（用于下拉回填/后端参数）
export function normalizeCamera(c: string): string {
  if (!c) return c
  if (CAMERA_ZH[c]) return c // 已是英文
  // 中文名包含关键词则映射回英文
  for (const [zhKey, en] of Object.entries(CAMERA_EN)) {
    if (c.includes(zhKey)) return en
  }
  return c
}
