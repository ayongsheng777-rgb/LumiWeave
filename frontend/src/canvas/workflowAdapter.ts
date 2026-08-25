import type { Node, Edge } from '@xyflow/react'
import type { WorkflowGraphPayload } from '../api'

// 把画布上的 nodes + edges 转成后端 WorkflowEngine 可执行的 WorkflowGraph
export function canvasToWorkflow(nodes: Node[], edges: Edge[]): WorkflowGraphPayload {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: (node.type || 'text') as string,
      data: { ...(node.data as Record<string, unknown>) },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
    })),
  }
}
