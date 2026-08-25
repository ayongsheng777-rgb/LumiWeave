"""工作流结果回写画布（规格书 §21/§22）。

Workflow 执行完成后，把生成结果落成 canvas_objects，让用户能在画布上
看到「这张图/这段文字是哪个节点、哪次任务、哪个模型产出的」。

回写规则：
  - render 节点：每个图片落一个 image 对象 + 一个 ai_result 汇总对象
  - llm / agent / output / skill 节点：落一个 ai_result（文本）对象
  - 每个对象 metadata 保留 task_id / workflow_id / node_id / source，
    content 保留 prompt / model / provider，实现全链路可追溯。
"""
from __future__ import annotations

from typing import Any

from app.canvas import service


def _extract_text(output: Any) -> str:
    if isinstance(output, dict):
        for key in ("content", "text", "result", "prompt"):
            if output.get(key):
                return str(output[key])
        return ""
    return str(output or "")


async def write_results_to_canvas(
    project_id: str,
    graph: dict[str, Any],
    node_results: dict[str, Any],
    *,
    task_id: str = "",
    workflow_id: str = "",
) -> list[str]:
    """把 node_results 回写成 canvas_objects，返回创建的 object id 列表。"""
    if not project_id:
        return []

    node_map: dict[str, dict[str, Any]] = {
        n.get("id"): n for n in (graph.get("nodes") or []) if isinstance(n, dict)
    }
    created: list[str] = []

    for node_id, result in node_results.items():
        if not isinstance(result, dict) or not result.get("ok"):
            continue
        node = node_map.get(node_id, {})
        ntype = node.get("type", "")
        data = node.get("data") or {}
        output = result.get("output")

        meta = {
            "source": ntype,
            "task_id": task_id,
            "workflow_id": workflow_id,
            "node_id": node_id,
        }
        trace = {
            "task_id": task_id,
            "workflow_id": workflow_id,
            "node_id": node_id,
            "prompt": data.get("prompt", ""),
            "model": data.get("model", ""),
            "provider": "",
        }

        if ntype == "render":
            render = output.get("render") if isinstance(output, dict) else None
            images = (render or {}).get("images") or []
            for img in images:
                if not isinstance(img, dict):
                    continue
                oid = await service.create_object(
                    project_id, "image",
                    content={
                        "url": img.get("url", ""),
                        "filename": img.get("filename", ""),
                        **trace,
                    },
                    metadata=meta,
                )
                created.append(oid)
            # 汇总 ai_result 对象
            oid = await service.create_object(
                project_id, "ai_result",
                content={"kind": "image", "images": images, **trace},
                metadata=meta,
            )
            created.append(oid)
        elif ntype in ("llm", "agent", "output", "skill", "prompt_template"):
            oid = await service.create_object(
                project_id, "ai_result",
                content={"kind": "text", "text": _extract_text(output), **trace},
                metadata=meta,
            )
            created.append(oid)

    return created
