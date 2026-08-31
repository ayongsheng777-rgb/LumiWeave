// =====================================================================
// 设计令牌（Design Tokens）· 集中查表
//
// 颜色与字面值来源：`src/styles/index.css` 的 CSS 变量。
// 这里只做「人看 + TS 类型」，不在 JS 端写死颜色；CSS 仍是单一真值源。
//
// 配套使用方式：
//   - Tailwind 类名：`text-ink-2` `bg-soft` `border-edge` → 自动引用变量（保持现状）
//   - 行内 style / 像素差： `style={{ color: tokens.color.ink }}`
//   - CSS 文件内联：       `var(--lw-ink)` （与 tokens.color.ink 同名）
//
// ⚠️ 注意：本文件不导出实际颜色字面量；只导出 var() 引用串，避免与 CSS 双源不同步。
// =====================================================================

/** 设计令牌：颜色（与 index.css --lw-* 一一对应）。 */
export const color = {
  /** 画布底色（明 #f4f5f7 / 暗 #121212） */
  canvas: 'var(--lw-canvas)',
  /** 画布点阵色（弱化呼吸感） */
  canvasDot: 'var(--lw-canvas-dot)',
  /** 面板/侧栏底 */
  panel: 'var(--lw-panel)',
  /** 次面板/节点底 */
  panel2: 'var(--lw-panel-2)',
  /** 边框 */
  edge: 'var(--lw-edge)',
  /** 选中态边框（紫） */
  edgeActive: 'var(--lw-edge-active)',
  /** 主文字 */
  ink: 'var(--lw-ink)',
  /** 次文字 */
  ink2: 'var(--lw-ink-2)',
  /** 弱文字（placeholder 等） */
  ink3: 'var(--lw-ink-3)',
  /** 输入框底 */
  inputBg: 'var(--lw-input-bg)',
  /** 悬浮背景 */
  hover: 'var(--lw-hover)',
  /** 微表面 */
  soft: 'var(--lw-soft)',
  /** 节点底 */
  nodeBg: 'var(--lw-node-bg)',
  /** 节点细边（选中态） */
  nodeBorder: 'var(--lw-node-border)',
  /** 节点柔和大阴影 */
  nodeShadow: 'var(--lw-node-shadow)',
  /** 节点悬浮态阴影 */
  nodeShadowHover: 'var(--lw-node-shadow-hover)',
  /** 品牌柔色底（按钮 hover / chip） */
  accentSoft: 'var(--lw-accent-soft)',
  /** 焦点环 */
  accentRing: 'var(--lw-accent-ring)',
  /** 玻璃底（弱） */
  glassBg: 'var(--lw-glass-bg)',
  /** 玻璃边 */
  glassEdge: 'var(--lw-glass-edge)',
  /** 强玻璃底（弹窗/悬浮条） */
  glassStrongBg: 'var(--lw-glass-strong-bg)',
  /** 强玻璃边 */
  glassStrongEdge: 'var(--lw-glass-strong-edge)',
  /** Toast 报错条底 */
  toastBg: 'var(--lw-toast-bg)',
} as const

/** 品牌色（500 走主题变量；其它档位静态色阶）。 */
export const brand = {
  /** 品牌强调 500（明/暗主题自适应） */
  500: 'var(--brand)',
  /** 品牌强调 600（深一档，hover 用） */
  600: 'var(--brand-dark)',
  /** 品牌渐变 */
  gradient: 'var(--brand-grad)',
  /** 品牌色上文字 */
  ink: 'var(--brand-ink)',
} as const

/** 节点运行态色（与 tailwind config 中 status.* 对齐）。 */
export const status = {
  idle: '#9ca3af',
  running: '#3b82f6',
  completed: '#10b981',
  failed: '#ef4444',
} as const

/** 形状与尺寸令牌（与 CSS 变量 / tailwind 默认对齐）。 */
export const radius = {
  /** 节点圆角（明 16px / 暗 14px 由 CSS 变量决定） */
  node: 'var(--lw-node-rounded)',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '20px',
  full: '9999px',
} as const

/** 间距（4 像素网格）。 */
export const space = {
  0: '0',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
} as const

/** 字号阶梯（紧凑到宽松）。 */
export const fontSize = {
  /** 9px · 节点角标 / 极小标签 */
  xxs: ['9px', { lineHeight: '12px' }],
  /** 10px · 紧凑 chip */
  xs: ['10px', { lineHeight: '14px' }],
  /** 11px · 默认紧凑正文 */
  sm: ['11px', { lineHeight: '16px' }],
  /** 12px · 默认正文 */
  base: ['12px', { lineHeight: '18px' }],
  /** 13px · 标题/重要标签 */
  md: ['13px', { lineHeight: '20px' }],
  /** 15px · 模块标题 */
  lg: ['15px', { lineHeight: '22px' }],
  /** 18px · 大标题 */
  xl: ['18px', { lineHeight: '26px' }],
} as const

/** 毛玻璃模糊半径（从 CSS 变量读）。 */
export const blur = {
  glass: 'var(--lw-jelly-blur)',
  /** 抽屉/弹窗深模糊 */
  drawer: '20px',
} as const

/** 断点（与 tailwind 默认对齐，响应式布局用）。 */
export const breakpoint = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const

/** 一组导出汇总，方便一次性 `import { tokens } from '@/styles/tokens'`。 */
export const tokens = { color, brand, status, radius, space, fontSize, blur, breakpoint } as const

export type ColorToken = keyof typeof color
export type BrandToken = keyof typeof brand
export type StatusToken = keyof typeof status
export type RadiusToken = keyof typeof radius
export type SpaceToken = keyof typeof space
export type FontSizeToken = keyof typeof fontSize
