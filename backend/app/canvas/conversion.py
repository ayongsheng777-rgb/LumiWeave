"""工作流 ↔ 画布 双向转换（type 映射 + content 适配 + 无损还原）。

两套画布底层都是「节点 + 连线」：
  - 工作流节点 {id, type, data, position}  （workflows 表）
  - 画布对象 {id, type, content, position, size, metadata}  （canvas_objects + canvas_edges）

转换时把影视节点 type 映射到画布已有对象类型（story→input、character/scene/prop→asset 等），
原始 type 与完整 data 存进 metadata（_wf_type / _wf_data），转回时无损还原。
"""
from __future__ import annotations

from typing import Any

# 工作流节点 type → 画布对象 type
# 🔴 必须对齐前端 src/canvas/objectNodes.tsx 的 objectNodeTypes 注册表，
# 否则转换后的对象在画布上渲染成空节点（如旧映射的 'input'/'asset' 在画布端无对应组件）。
WF_TO_CANVAS: dict[str, str] = {
    'story': 'story',
    'character': 'character',
    'scene': 'scene',
    'prop': 'prop',
    'storyboard': 'storyboard',
    'image': 'image',
    'video': 'video',
    'audio': 'audio',
    'subtitle': 'subtitle',
    'layout': 'layout',
    'export': 'export',
    'prompt': 'prompt',
    'skill': 'skill',
    # 兼容旧通用节点：朝画布端真实渲染组件靠拢
    'asset': 'character',
    'input': 'text', 'analyze': 'text', 'output': 'text', 'llm': 'text',
    'render': 'image',
    'text': 'text', 'note': 'note',
}

# 画布对象 type → 工作流节点 type（无 _wf_type 元数据时的兜底映射）
# 与 WF_TO_CANVAS 形成对偶；还原时优先用 metadata._wf_type，本表仅作兜底。
CANVAS_TO_WF: dict[str, str] = {
    'story': 'story', 'character': 'character', 'scene': 'scene', 'prop': 'prop',
    'storyboard': 'storyboard', 'image': 'image', 'video': 'video', 'audio': 'audio',
    'subtitle': 'subtitle', 'layout': 'layout', 'export': 'export', 'prompt': 'prompt',
    'skill': 'skill', 'input': 'story', 'asset': 'character',
    'analyze': 'analyze', 'output': 'output', 'text': 'text', 'note': 'note',
    'llm': 'llm', 'render': 'render',
}

_FILM_ASSET_LABEL = {'character': '角色', 'scene': '场景', 'prop': '道具'}


def _storyboard_text(data: dict[str, Any]) -> str:
    shots = data.get('shots') or []
    lines = []
    for s in shots:
        if not isinstance(s, dict):
            continue
        lines.append(
            f"{s.get('shot', '?')}. 【{s.get('camera', '')}】{s.get('duration', 3)}s — {s.get('description', '')}"
        )
    return '\n'.join(lines) or str(data)


def wf_content(ntype: str, data: dict[str, Any]) -> dict[str, Any]:
    """工作流 node.data → 画布 object.content（适配画布节点读取的字段）。"""
    if ntype in _FILM_ASSET_LABEL:
        return {
            'assetType': _FILM_ASSET_LABEL[ntype],
            'name': data.get('name', ''),
            'prompt': data.get('prompt', ''),
            'url': data.get('url', ''),
        }
    if ntype == 'story':
        return {'text': data.get('text', '')}
    if ntype == 'storyboard':
        return {'text': _storyboard_text(data), 'shots': data.get('shots', [])}
    if ntype == 'image':
        return {'prompt': data.get('prompt', ''), 'url': data.get('url', ''), 'ratio': data.get('ratio', '')}
    if ntype == 'video':
        return {
            'prompt': data.get('prompt', ''),
            'url': data.get('video_url') or data.get('url', ''),
            'camera': data.get('camera', 'static'),
            'duration': data.get('duration', 10),
            'ratio': data.get('ratio', '16:9'),
            'style': data.get('style', ''),
        }
    if ntype == 'audio':
        return {'assetType': '声音', 'script': data.get('script', ''), 'audio_url': data.get('audio_url', '')}
    if ntype in ('subtitle', 'layout', 'export'):
        return {'text': str(data.get('content') or data.get('template') or data.get('format') or '')}
    return dict(data)


def wf_to_canvas(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    objects: list[dict[str, Any]] = []
    # 是否存在独立的 storyboard 节点（有则不再从 story 节点重复生成）
    has_storyboard_node = any(str(n.get('type', '')) == 'storyboard' for n in nodes)

    for n in nodes:
        ntype = str(n.get('type', 'text'))
        ctype = WF_TO_CANVAS.get(ntype, 'text')
        data = n.get('data') or {}
        if not isinstance(data, dict):
            data = {}
        pos = n.get('position') or {'x': 0, 'y': 0}

        # story 节点：分镜数据可能存于 data.storyboard / data.shots（StoryNode 解析产物），
        # 转画布时若没有独立 storyboard 节点，则额外生成一个 storyboard 对象，避免分镜丢失
        if ntype == 'story' and not has_storyboard_node:
            shots = data.get('storyboard') or data.get('shots') or []
            if shots:
                objects.append({
                    'id': f"{n.get('id')}_storyboard",
                    'type': 'storyboard',
                    'content': {'text': _storyboard_text({'shots': shots}), 'shots': shots},
                    'position': {'x': pos.get('x', 0) + 400, 'y': pos.get('y', 0)},
                    'size': {},
                    'metadata': {'_wf_type': 'storyboard', '_wf_data': {'shots': shots}},
                })

        objects.append({
            'id': n.get('id'),
            'type': ctype,
            'content': wf_content(ntype, data),
            'position': pos,
            'size': n.get('size') or {},
            'metadata': {'_wf_type': ntype, '_wf_data': data},
        })
    edges_out = [
        {
            'id': e.get('id'), 'source': e.get('source'), 'target': e.get('target'),
            'source_handle': e.get('source_handle'), 'target_handle': e.get('target_handle'),
        }
        for e in edges
    ]
    return objects, edges_out


def canvas_to_wf(objects: list[dict[str, Any]], edges: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    nodes: list[dict[str, Any]] = []
    for o in objects:
        ctype = str(o.get('type', 'text'))
        meta = o.get('metadata') or {}
        if not isinstance(meta, dict):
            meta = {}
        wf_type = meta.get('_wf_type') or CANVAS_TO_WF.get(ctype, ctype)

        content = o.get('content') or {}
        if not isinstance(content, dict):
            content = {'text': str(content)}

        _wf_data = meta.get('_wf_data') or {}

        # storyboard 特殊处理：content.shots 是 canvas 侧保存的完整数据，
        # 优先级高于 _wf_data（_wf_data 可能是早期转换的旧格式，只有 text 无 shots）
        if ctype == 'storyboard' and 'shots' in content:
            _wf_data = dict(_wf_data, shots=content['shots'])

        # 最终 node.data：优先用 _wf_data，content 作兜底
        data = dict(_wf_data) if _wf_data else {}
        if not data:
            data = dict(content)
        if not isinstance(data, dict):
            data = {'text': str(data)}

        # storyboard 双保险：若最终 data 仍无 shots 而 content 有，补进去
        if ctype == 'storyboard' and 'shots' in content and 'shots' not in data:
            data = dict(data, shots=content['shots'])

        nodes.append({
            'id': o.get('id'),
            'type': wf_type,
            'data': data,
            'position': o.get('position') or {'x': 0, 'y': 0},
        })
    edges_out = [
        {
            'id': e.get('id'), 'source': e.get('source'), 'target': e.get('target'),
            'source_handle': e.get('source_handle'), 'target_handle': e.get('target_handle'),
        }
        for e in edges
    ]
    return nodes, edges_out
