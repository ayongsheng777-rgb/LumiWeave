import { create } from 'zustand'

interface LayoutState {
  isCanvasOpen: boolean
  toggleCanvas: () => void
  setCanvasOpen: (v: boolean) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  isCanvasOpen: true,
  toggleCanvas: () => set((s) => ({ isCanvasOpen: !s.isCanvasOpen })),
  setCanvasOpen: (v) => set({ isCanvasOpen: v }),
}))
