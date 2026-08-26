// =====================================================================
// 运镜方案库 — 视频节点的镜头运动预设集合
// 每个方案含：中文名 / 英文提示词片段 / 一句话说明。
// 选中后由 ljEngine 自动把「中文名 + 英文运镜关键词」注入生成提示词。
// =====================================================================

export interface CameraMotion {
  name: string
  en: string
  desc: string
}

/** 运镜方案集合（可扩展，不改画布核心） */
export const CAMERA_MOTIONS: CameraMotion[] = [
  { name: '推镜', en: 'push in, camera slowly moves closer to subject', desc: '镜头向前推进，逼近主体' },
  { name: '拉镜', en: 'pull back, camera moves away from subject', desc: '镜头向后拉远，展现场景全貌' },
  { name: '环绕', en: 'orbit shot, camera circles around subject', desc: '围绕主体做环绕运动' },
  { name: '跟拍', en: 'tracking shot, camera follows the moving subject', desc: '跟随主体移动拍摄' },
  { name: '手持', en: 'handheld camera, subtle natural shake', desc: '手持感，轻微晃动更真实' },
  { name: '升降', en: 'crane shot, camera moves vertically up', desc: '升降机位，垂直上升/下降' },
  { name: '横移', en: 'dolly shot, camera moves laterally left or right', desc: '横向平移' },
  { name: '摇镜', en: 'pan shot, camera pans across the scene', desc: '固定机位左右/上下摇动' },
  { name: '变焦推近', en: 'zoom in, smooth focal length increase', desc: '平滑变焦拉近' },
  { name: '变焦拉远', en: 'zoom out, smooth focal length decrease', desc: '平滑变焦拉远' },
  { name: '甩镜', en: 'whip pan, fast camera swing between two points', desc: '快速甩动切换画面' },
  { name: '旋转', en: 'spin, camera rotates 360 degrees', desc: '旋转一周' },
  { name: '上升揭示', en: 'rise up reveal, camera tilts up from low to high', desc: '从低处升起揭示全貌' },
  { name: '俯冲', en: 'dive down, camera descends toward subject', desc: '从高处俯冲向下' },
  { name: '过肩', en: 'over the shoulder shot', desc: '过肩视角' },
  { name: '穿越', en: 'fly through, camera moves through objects or space', desc: '穿越物体/空间' },
  { name: '急推', en: 'crash zoom, sudden rapid zoom in', desc: '急促推近，制造冲击力' },
  { name: '微距', en: 'macro, extreme close-up slow move', desc: '微距特写慢移' },
  { name: '慢推', en: 'slow push in, very gradual forward move', desc: '极缓慢推进' },
  { name: '快摇', en: 'fast pan, rapid horizontal sweep', desc: '快速横扫' },
  { name: '一镜到底', en: 'long take, single continuous shot', desc: '不切镜头连续拍摄' },
  { name: '环绕跟拍', en: 'orbit tracking, circling while following subject', desc: '边环绕边跟随' },
  { name: '低角度跟随', en: 'low angle follow, tracking from low position', desc: '低位仰角跟随' },
  { name: '俯瞰下降', en: 'aerial descend, top-down camera lowering', desc: '俯拍视角缓缓下降' },
  { name: '静止', en: 'static camera, locked-off shot', desc: '固定机位不运动' },
]

export function cameraMotionByName(name: string): CameraMotion | undefined {
  return CAMERA_MOTIONS.find((c) => c.name === name)
}
