/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 主题语义色：CSS 变量驱动，支持明暗切换（见 styles/index.css）
        canvas: 'var(--lw-canvas)',
        'canvas-dot': 'var(--lw-canvas-dot)',
        panel: 'var(--lw-panel)',
        'panel-2': 'var(--lw-panel-2)',
        edge: 'var(--lw-edge)',
        ink: 'var(--lw-ink)',
        'ink-2': 'var(--lw-ink-2)',
        'ink-3': 'var(--lw-ink-3)',
        soft: 'var(--lw-soft)',
        input: 'var(--lw-input-bg)',
        // 品牌强调色：克制的紫/蓝渐变
        brand: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
        // 节点状态色
        status: {
          idle: '#9ca3af',
          running: '#3b82f6',
          completed: '#10b981',
          failed: '#ef4444',
        },
      },
      boxShadow: {
        node: '0 2px 8px rgba(0,0,0,0.08)',
        'node-dark': '0 2px 10px rgba(0,0,0,0.35)',
        drawer: '-8px 0 24px rgba(0,0,0,0.12)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      keyframes: {
        breathe: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(0.85)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        breathe: 'breathe 1.2s ease-in-out infinite',
        'fade-in': 'fade-in 0.18s ease-out',
      },
    },
  },
  plugins: [],
}
