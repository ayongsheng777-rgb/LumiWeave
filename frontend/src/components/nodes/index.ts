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
import { ImageInputNode }       from './ImageInputNode'
import { FilmVideoNode }        from './FilmVideoNode'
import { AudioNode }            from './AudioNode'
import { SubtitleNode }         from './SubtitleNode'
import { LayoutNode }           from './LayoutNode'
import { ExportNode }           from './ExportNode'
// ── 通用辅助节点 ───────────────────────────────────────────────
import { PromptNode }           from './PromptNode'
import { SkillNode }            from './SkillNode'

export const nodeTypes = {
  // ── 影视创作节点 ─────────────────────────────────────────────
  story:       StoryNode,
  image_input: ImageInputNode,
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
  skill:       SkillNode,
}
