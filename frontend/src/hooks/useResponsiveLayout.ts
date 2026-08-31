// =====================================================================
// 响应式布局判定 hook（§49）
//
// 提供 isMobile / isTablet / isDesktop 三档，与 Tailwind 断点对齐。
// 浏览器尺寸变化时实时更新；SSR 安全（默认按 desktop）。
//
// 用法：
//   const { isMobile } = useResponsiveLayout()
//   <div className={isMobile ? 'p-2' : 'p-4'}>...</div>
//   {isMobile && <MobileOnlyDrawer />}
// =====================================================================
import { useEffect, useState } from 'react'
import { breakpoint } from '../styles/tokens'

export type LayoutMode = 'mobile' | 'tablet' | 'desktop'

export interface ResponsiveLayout {
  /** < 768px（手机） */
  isMobile: boolean
  /** 768-1023px（平板） */
  isTablet: boolean
  /** ≥ 1024px（桌面） */
  isDesktop: boolean
  /** 当前模式（一档） */
  mode: LayoutMode
  /** 视口宽度（px） */
  width: number
}

const detect = (w: number): LayoutMode => {
  if (w < breakpoint.md) return 'mobile'
  if (w < breakpoint.lg) return 'tablet'
  return 'desktop'
}

export function useResponsiveLayout(): ResponsiveLayout {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return breakpoint.lg
    return window.innerWidth
  })

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const mode = detect(width)
  return {
    isMobile: mode === 'mobile',
    isTablet: mode === 'tablet',
    isDesktop: mode === 'desktop',
    mode,
    width,
  }
}
