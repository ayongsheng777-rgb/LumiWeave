// colorUtils —— 果冻皮肤动态颜色工具（V2.9 Glassmorphism）
// 节点背景需按类型色动态变化并保持半透明，Tailwind 静态类无法表达，
// 统一走本工具生成 rgba 字符串（浅色 50% / 暗色更低透明度由调用方传 alpha）。

/**
 * 十六进制颜色 → 带透明度的 RGBA 字符串
 * @param hex   颜色代码，如 "#8A2BE2" / "8A2BE2" / 3 位短码 "#8AB"
 * @param alpha 透明度 (0-1)，浅色节点背景固定 0.5，暗色建议 0.16~0.22
 */
export const hexToRgba = (hex: string, alpha: number = 0.5): string => {
  let cleanHex = String(hex || '').replace('#', '').trim()
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (cleanHex.length !== 6) return `rgba(255, 255, 255, ${alpha})`
  const r = parseInt(cleanHex.substring(0, 2), 16)
  const g = parseInt(cleanHex.substring(2, 4), 16)
  const b = parseInt(cleanHex.substring(4, 6), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return `rgba(255, 255, 255, ${alpha})`
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 当前是否暗色模式（读 html.dark，供 JS 动态取色用；纯 CSS 场景优先用 --lw-tint-pct） */
export const isDarkTheme = (): boolean =>
  typeof document !== 'undefined' &&
  !!document.documentElement.classList.contains('dark')

/** 按当前主题返回节点背景透明度：浅色 0.5（手册），暗色 0.18 */
export const nodeTintAlpha = (): number => (isDarkTheme() ? 0.18 : 0.5)

export default hexToRgba
