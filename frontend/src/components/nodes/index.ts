import { InputNode } from './InputNode'
import { LLMNode } from './LLMNode'
import { PromptNode } from './PromptNode'
import { SkillNode } from './SkillNode'
import { OutputNode } from './OutputNode'
import { RenderNode } from './RenderNode'

// 与后端 agent/engine.py 的节点 type 对齐
export const nodeTypes = {
  input: InputNode,
  llm: LLMNode,
  prompt_template: PromptNode,
  skill: SkillNode,
  output: OutputNode,
  render: RenderNode,
}
