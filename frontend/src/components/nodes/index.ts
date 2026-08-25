// =====================================================================
// 影视创作节点系统 V2 — 节点类型注册表
// 与后端 app/workflow/node_registry.py 的节点 type 完全对齐
// =====================================================================
import { StoryNode }           from './StoryNode'
import { CharacterNode }        from './CharacterNode'
import { SceneNode }            from './SceneNode'
import { PropNode }             from './PropNode'
import { StoryboardNode }       from './StoryboardNode'
import { ImageNode }            from './ImageNode'
import { FilmVideoNode }        from './FilmVideoNode'
import { AudioNode }            from './AudioNode'
import { SubtitleNode }         from './SubtitleNode'
import { LayoutNode }           from './LayoutNode'
import { ExportNode }           from './ExportNode'
// ── 保留通用辅助节点 ───────────────────────────────────────────────
import { PromptNode }           from './PromptNode'
import { SkillNode }            from './SkillNode'
import { OutputNode }           from './OutputNode'
// ── 兼容旧 type（废弃但不掉线）───────────────────────────────────
import { InputNode }            from './InputNode'
import { LLMNode }              from './LLMNode'
import { RenderNode }           from './RenderNode'

export const nodeTypes = {
  // ── 13 个影视创作节点 ─────────────────────────────────────────
  story:       StoryNode,
  character:   CharacterNode,
  scene:       SceneNode,
  prop:        PropNode,
  storyboard:  StoryboardNode,
  image:       ImageNode,
  video:       FilmVideoNode,
  audio:       AudioNode,
  subtitle:    SubtitleNode,
  layout:      LayoutNode,
  export:      ExportNode,
  // ── 通用辅助节点 ─────────────────────────────────────────────
  prompt:      PromptNode,
  asset:       PromptNode,       // asset 共用 PromptNode（可后续拆分）
  skill:       SkillNode,
  output:      OutputNode,
  // ── 兼容旧 type ─────────────────────────────────────────────
  input:       InputNode,
  llm:         LLMNode,
  render:      RenderNode,
  prompt_template: PromptNode,   // 兼容旧名
}
