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
WF_TO_CANVAS: dict[str, str] = {
    'story': 'input',
    'character': 'asset',
    'scene': 'asset',
    'prop': 'asset',
    'storyboard': 'text',
    'image': 'image',
    'video': 'video',
    'audio': 'asset',
    'subtitle': 'text',
    'layout': 'text',
    'export': 'text',
    'prompt': 'prompt',
    'asset': 'asset',
    # 兼容旧通用节点
    'input': 'input', 'analyze': 'analyze', 'skill': 'skill',
    'output': 'output', 'llm': 'llm', 'render': 'render',
    'text': 'text', 'note': 'note',
}

# 画布对象 type → 工作流节点 type（无 _wf_type 元数据时的兜底映射）
CANVAS_TO_WF: dict[str, str] = {
    'input': 'story', 'asset': 'character', 'image': 'image', 'video': 'video',
    'prompt': 'prompt', 'analyze': 'analyze', 'skill': 'skill', 'output': 'output',
    'text': 'text', 'note': 'note', 'llm': 'llm', 'render': 'render',
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
        return {'text': _storyboard_text(data)}
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
    for n in nodes:
        ntype = str(n.get('type', 'text'))
        ctype = WF_TO_CANVAS.get(ntype, 'text')
        data = n.get('data') or {}
        if not isinstance(data, dict):
            data = {}
        objects.append({
            'id': n.get('id'),
            'type': ctype,
            'content': wf_content(ntype, data),
            'position': n.get('position') or {'x': 0, 'y': 0},
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
        data = meta.get('_wf_data') or (o.get('content') or {})
        if not isinstance(data, dict):
            data = {'text': str(data)}
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
