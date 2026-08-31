// 画布弹窗状态：提示词 composer（生成前确认）+ 裁剪对话框
// 对标 PixVerse：点「生成」不是立刻跑，而是弹出 composer 改完提示词/模型/参数再提交。
import { create } from 'zustand'

interface PvDialogState {
  /** composer 打开着的节点 id（null=关闭） */
  composerNodeId: string | null
  /** 裁剪对话框打开着的节点 id（null=关闭） */
  cropNodeId: string | null
  openComposer: (nodeId: string) => void
  closeComposer: () => void
  openCrop: (nodeId: string) => void
  closeCrop: () => void
}

export const usePvDialogs = create<PvDialogState>((set) => ({
  composerNodeId: null,
  cropNodeId: null,
  openComposer: (nodeId) => set({ composerNodeId: nodeId }),
  closeComposer: () => set({ composerNodeId: null }),
  openCrop: (nodeId) => set({ cropNodeId: nodeId }),
  closeCrop: () => set({ cropNodeId: null }),
}))
