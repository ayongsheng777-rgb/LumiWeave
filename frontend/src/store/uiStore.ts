import { create } from 'zustand'

export type CanvasMode = 'workflow' | 'infinite'

interface UiState {
  mode: CanvasMode
  theme: 'dark' | 'light'
  projectName: string
  drawerOpen: boolean // 右侧智能体控制台（Agent 抽屉）
  chatOpen: boolean // AI 助手侧栏
  managementOpen: boolean // 管理面板（模型/计费/技能…）
  lightbox: string | null // 资产灯箱预览图地址
  setMode: (m: CanvasMode) => void
  toggleMode: () => void
  setTheme: (t: 'dark' | 'light') => void
  toggleTheme: () => void
  setProjectName: (n: string) => void
  setDrawerOpen: (v: boolean) => void
  toggleDrawer: () => void
  setChatOpen: (v: boolean) => void
  toggleChat: () => void
  setManagementOpen: (v: boolean) => void
  openLightbox: (src: string) => void
  closeLightbox: () => void
  initTheme: () => void
}

function applyTheme(theme: 'dark' | 'light') {
  const root = document.documentElement
  if (theme === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

const STORE_KEY = 'lumiweave_ui'

function load(): Partial<UiState> {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

const saved = load()

export const useUiStore = create<UiState>((set, get) => ({
  mode: (saved.mode as CanvasMode) || 'workflow',
  theme: (saved.theme as 'dark' | 'light') || 'dark',
  projectName: saved.projectName || '未命名作品',
  drawerOpen: saved.drawerOpen ?? true,
  chatOpen: saved.chatOpen ?? true,
  managementOpen: false,
  lightbox: null,

  setMode: (m) => {
    persist(set, get, { mode: m })
  },
  toggleMode: () => {
    const next: CanvasMode = get().mode === 'workflow' ? 'infinite' : 'workflow'
    persist(set, get, { mode: next })
  },
  setTheme: (t) => {
    applyTheme(t)
    persist(set, get, { theme: t })
  },
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    persist(set, get, { theme: next })
  },
  setProjectName: (n) => persist(set, get, { projectName: n }),
  setDrawerOpen: (v) => persist(set, get, { drawerOpen: v }),
  toggleDrawer: () => persist(set, get, { drawerOpen: !get().drawerOpen }),
  setChatOpen: (v) => persist(set, get, { chatOpen: v }),
  toggleChat: () => persist(set, get, { chatOpen: !get().chatOpen }),
  setManagementOpen: (v) => set({ managementOpen: v }),
  openLightbox: (src) => set({ lightbox: src }),
  closeLightbox: () => set({ lightbox: null }),

  initTheme: () => applyTheme(get().theme),
}))

function persist(set: (p: Partial<UiState>) => void, get: () => UiState, patch: Partial<UiState>) {
  set(patch)
  const s = get()
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        mode: s.mode,
        theme: s.theme,
        projectName: s.projectName,
        drawerOpen: s.drawerOpen,
        chatOpen: s.chatOpen,
      }),
    )
  } catch {
    /* localStorage 不可用时忽略 */
  }
}
