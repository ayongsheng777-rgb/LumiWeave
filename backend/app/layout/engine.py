"""专业排版引擎（V2 Issue #008）：对齐/分布/网格 + 海报/小红书/PPT/电商/杂志模板。"""
from __future__ import annotations

from typing import Any

# 每个模板：画布尺寸 + 归一化槽位（name/type/x/y/w/h，坐标按比例 0~1）
TEMPLATES: dict[str, dict[str, Any]] = {
    "poster": {
        "width": 1080, "height": 1920,
        "slots": [
            {"name": "title", "type": "text", "x": 0.06, "y": 0.05, "w": 0.88, "h": 0.12},
            {"name": "main", "type": "image", "x": 0.08, "y": 0.20, "w": 0.84, "h": 0.42},
            {"name": "sub", "type": "text", "x": 0.10, "y": 0.66, "w": 0.80, "h": 0.10},
            {"name": "cta", "type": "text", "x": 0.25, "y": 0.88, "w": 0.50, "h": 0.06},
        ],
    },
    "xiaohongshu": {
        "width": 1080, "height": 1440,
        "slots": [
            {"name": "title", "type": "text", "x": 0.05, "y": 0.04, "w": 0.90, "h": 0.14},
            {"name": "main", "type": "image", "x": 0.06, "y": 0.22, "w": 0.88, "h": 0.46},
            {"name": "selling", "type": "text", "x": 0.06, "y": 0.72, "w": 0.88, "h": 0.14},
            {"name": "cta", "type": "text", "x": 0.20, "y": 0.90, "w": 0.60, "h": 0.06},
        ],
    },
    "ppt": {
        "width": 1920, "height": 1080,
        "slots": [
            {"name": "title", "type": "text", "x": 0.08, "y": 0.08, "w": 0.84, "h": 0.16},
            {"name": "body", "type": "text", "x": 0.08, "y": 0.30, "w": 0.50, "h": 0.60},
            {"name": "image", "type": "image", "x": 0.62, "y": 0.30, "w": 0.32, "h": 0.60},
        ],
    },
    "ecommerce": {
        "width": 1200, "height": 1200,
        "slots": [
            {"name": "main", "type": "image", "x": 0.06, "y": 0.06, "w": 0.88, "h": 0.60},
            {"name": "title", "type": "text", "x": 0.08, "y": 0.70, "w": 0.84, "h": 0.10},
            {"name": "selling", "type": "text", "x": 0.08, "y": 0.82, "w": 0.84, "h": 0.14},
        ],
    },
    "magazine": {
        "width": 1600, "height": 2000,
        "slots": [
            {"name": "hero", "type": "image", "x": 0.05, "y": 0.04, "w": 0.90, "h": 0.45},
            {"name": "title", "type": "text", "x": 0.08, "y": 0.52, "w": 0.84, "h": 0.10},
            {"name": "col_l", "type": "text", "x": 0.08, "y": 0.66, "w": 0.40, "h": 0.28},
            {"name": "col_r", "type": "text", "x": 0.52, "y": 0.66, "w": 0.40, "h": 0.28},
        ],
    },
}


def align(objects: list[dict[str, Any]], mode: str) -> list[dict[str, Any]]:
    """对齐：left/right/top/bottom/center_h/center_v。"""
    if not objects:
        return objects
    xs = [o["position"]["x"] for o in objects]
    ys = [o["position"]["y"] for o in objects]
    ws = [o.get("size", {}).get("width", 200) for o in objects]
    hs = [o.get("size", {}).get("height", 200) for o in objects]
    for o, w, h in zip(objects, ws, hs):
        if mode == "left":
            o["position"]["x"] = min(xs)
        elif mode == "right":
            o["position"]["x"] = max(xs) + max(ws) - w
        elif mode == "top":
            o["position"]["y"] = min(ys)
        elif mode == "bottom":
            o["position"]["y"] = max(ys) + max(hs) - h
        elif mode == "center_h":
            o["position"]["x"] = (min(xs) + max(xs) + max(ws)) / 2 - w / 2
        elif mode == "center_v":
            o["position"]["y"] = (min(ys) + max(ys) + max(hs)) / 2 - h / 2
    return objects


def distribute(objects: list[dict[str, Any]], axis: str = "x", gap: float = 20) -> list[dict[str, Any]]:
    """等间距分布（axis: x 或 y）。"""
    if len(objects) < 2:
        return objects
    objs = sorted(objects, key=lambda o: o["position"][axis])
    total_gap = gap * (len(objs) - 1)
    if axis == "x":
        cursor = objs[0]["position"]["x"]
        for o in objs:
            o["position"]["x"] = cursor
            cursor += o.get("size", {}).get("width", 200) + gap
    else:
        cursor = objs[0]["position"]["y"]
        for o in objs:
            o["position"]["y"] = cursor
            cursor += o.get("size", {}).get("height", 200) + gap
    return objs


def grid(objects: list[dict[str, Any]], cols: int = 3, gap: float = 20,
         cell_w: float = 200, cell_h: float = 200) -> list[dict[str, Any]]:
    for i, o in enumerate(objects):
        r, c = divmod(i, cols)
        o["position"] = {"x": c * (cell_w + gap), "y": r * (cell_h + gap)}
        o["size"] = {"width": cell_w, "height": cell_h}
    return objects


def apply_template(objects: list[dict[str, Any]], template: str) -> dict[str, Any]:
    """把对象按专业模板排版，返回 {width,height,objects}。"""
    tpl = TEMPLATES.get(template, TEMPLATES["poster"])
    width, height = tpl["width"], tpl["height"]
    slots = list(tpl["slots"])
    # 先按类型匹配，再按顺序填充
    result: list[dict[str, Any]] = []
    used: set[int] = set()
    for o in objects:
        otype = o.get("type", "text")
        slot_idx = None
        for i, s in enumerate(slots):
            if i in used:
                continue
            if s["type"] == otype or (otype in ("image", "video") and s["type"] == "image"):
                slot_idx = i
                break
        if slot_idx is None:
            for i, s in enumerate(slots):
                if i not in used:
                    slot_idx = i
                    break
        if slot_idx is None:
            break
        used.add(slot_idx)
        s = slots[slot_idx]
        o["position"] = {"x": s["x"] * width, "y": s["y"] * height}
        o["size"] = {"width": s["w"] * width, "height": s["h"] * height}
        result.append(o)
    return {"width": width, "height": height, "objects": result}
