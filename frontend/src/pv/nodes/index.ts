// PixVerse 风格通用画布 · 节点组件注册表
// 只有三个组件，覆盖无穷多种用法：
//   pv_asset    —— 素材（图/视频/音频），画布的原料
//   pv_generate —— 生成（选模型跑一次），画布的能力
//   pv_text     —— 文本便签
import type { NodeTypes } from '@xyflow/react'
import { AssetNode } from './AssetNode'
import { GenerateNode } from './GenerateNode'
import { TextNode } from './TextNode'

export const pvNodeTypes: NodeTypes = {
  pv_asset: AssetNode,
  pv_generate: GenerateNode,
  pv_text: TextNode,
}
