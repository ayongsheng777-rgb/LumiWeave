"""Text-to-Image / Text-to-Video 工作流构建器。

负责把前端的简化参数 {prompt, negative, seed, steps, width, height}
转换成 ComfyUI 所需的完整 workflow JSON。
"""
from __future__ import annotations

import random
import uuid
from typing import Any


def _seed_val(seed: str | int | None) -> int:
    """统一转成整数 seed，供 KSampler /andom Ctrl 使用。"""
    if seed is None:
        return random.randint(0, 2**31 - 1)
    try:
        return int(seed)
    except (ValueError, TypeError):
        return random.randint(0, 2**31 - 1)


def _ratio_to_wh(ratio: str, base: int = 512) -> tuple[int, int]:
    """解析 ratio 字符串（如 '16:9'、'1:1'、'9:16'）→ (width, height)。"""
    ratio = str(ratio or "1:1").strip()
    w, h = base, base
    if ":" in ratio:
        parts = ratio.split(":")
        if len(parts) == 2:
            try:
                rw, rh = float(parts[0]), float(parts[1])
                scale = rw / rh
                if scale >= 1.5:  # 横屏
                    w, h = int(base * scale), base
                elif scale < 0.7:  # 竖屏
                    w, h = base, int(base / scale)
                else:
                    w = h = base
            except (ValueError, ZeroDivisionError):
                w = h = base
    return w, h


def build_text_to_image_workflow(params: dict[str, Any]) -> dict[str, Any]:
    """构建 SD 1.5/SDXL Text-to-Image 工作流（标准节点串联）。

    节点链: EmptyLatentImage → ModelLoader → CLIPTextEncode → CLIPTextEncode
            → KSampler → VAEDecode → SaveImage

    参数（前端传入）：
        prompt         str      正向提示词
        negative       str      负向提示词（可选）
        seed           int/str  随机种子（可选）
        steps          int      采样步数（默认 30）
        width          int      宽度（可选，自动从 ratio 计算）
        height         int      高度（可选，自动从 ratio 计算）
        ratio          str      宽高比（可选，如 '16:9'）
        cfg            float    CFG 强度（默认 7.0）
        sampler_name   str      采样器名（默认 'euler'）
        scheduler      str      调度器（默认 'normal'）
        model          str      模型文件名（可选，默认 'sd_xl_base_1.0.safetensors'）

    返回：ComfyUI workflow JSON（可直接 POST /prompt）
    """
    prompt    = str(params.get("prompt", ""))
    negative  = str(params.get("negative", ""))
    seed      = _seed_val(params.get("seed"))
    steps     = int(params.get("steps", 30))
    cfg       = float(params.get("cfg", 7.0))
    sampler   = str(params.get("sampler_name", "euler"))
    scheduler = str(params.get("scheduler", "normal"))
    ratio     = str(params.get("ratio", "1:1"))
    model     = str(params.get("model", "sd_xl_base_1.0.safetensors"))

    # 宽高：优先用显式值，否则从 ratio 推算
    w = int(params.get("width", 0)) or _ratio_to_wh(ratio)[0]
    h = int(params.get("height", 0)) or _ratio_to_wh(ratio)[1]
    # ComfyUI SD 要求 8 的倍数
    w, h = (w // 8) * 8, (h // 8) * 8

    # 节点 ID 前缀（保证同一 workflow 内不冲突）
    p = "t2i_"

    workflow: dict[str, Any] = {
        "version": "1.0",
        "nodes": {

            # ── 1. 模型加载器（支持传入 model 参数指定具体模型）────────────
            f"{p}model_loader": {
                "class_type": "UNETLoader",
                "inputs": {
                    "ckpt_name": model,
                },
            },

            # ── 2. CLIP 编码器（正向提示词）────────────────────────────────────────────
            f"{p}clip_pos": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": [f"{p}model_loader", 1],   # [node_id, output_slot]
                },
            },

            # ── 3. CLIP 编码器（负向提示词）────────────────────────────────────────────
            f"{p}clip_neg": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative,
                    "clip": [f"{p}model_loader", 1],
                },
            },

            # ── 4. 空潜空间图像（决定尺寸）────────────────────────────────────────────
            f"{p}latent": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": w,
                    "height": h,
                    "batch_size": 1,
                },
            },

            # ── 5. KSampler（采样器）──────────────────────────────────────────────────
            f"{p}sampler": {
                "class_type": "KSampler",
                "inputs": {
                    "model": [f"{p}model_loader", 0],
                    "positive": [f"{p}clip_pos", 0],
                    "negative": [f"{p}clip_neg", 0],
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": sampler,
                    "scheduler": scheduler,
                    "latent_image": [f"{p}latent", 0],
                },
            },

            # ── 6. VAE 解码（潜空间 → 像素空间）──────────────────────────────────────
            f"{p}vae": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": [f"{p}sampler", 0],
                    "vae": [f"{p}model_loader", 2],
                },
            },

            # ── 7. 保存图像────────────────────────────────────────────────────────────
            f"{p}save": {
                "class_type": "SaveImage",
                "inputs": {
                    "filename_prefix": f"LumiWeave_t2i_{uuid.uuid4().hex[:6]}",
                    "images": [f"{p}vae", 0],
                },
            },

        },
        "links": [
            # [link_id, src_node, src_slot, dst_node, dst_slot, type]
            # model_loader → clip_pos (clip)
            [1, f"{p}model_loader", 1, f"{p}clip_pos", 0, "CLIP"],
            # model_loader → clip_neg (clip)
            [2, f"{p}model_loader", 1, f"{p}clip_neg", 0, "CLIP"],
            # model_loader → sampler (model)
            [3, f"{p}model_loader", 0, f"{p}sampler", 0, "MODEL"],
            # latent → sampler (LATENT)
            [4, f"{p}latent", 0, f"{p}sampler", 3, "LATENT"],
            # sampler → vae (LATENT)
            [5, f"{p}sampler", 0, f"{p}vae", 0, "LATENT"],
            # vae → save (IMAGE)
            [6, f"{p}vae", 0, f"{p}save", 0, "IMAGE"],
            # model_loader → vae (VAE) — 注意 VAEDecode 第二个输入是 VAE
            [7, f"{p}model_loader", 2, f"{p}vae", 1, "VAE"],
        ],
    }
    return workflow


def build_text_to_video_workflow(params: dict[str, Any], model: str = "") -> dict[str, Any]:
    """构建 Text-to-Video 工作流（SVD / Wan / AnimateDiff）。

    参数在 text-to-image 基础上增加：
        video_frames  int   视频帧数（默认 24）
        fps           int   帧率（默认 8）
        model         str   模型文件名（默认 'svd_xt.safetensors'）
    """
    prompt  = str(params.get("prompt", ""))
    negative = str(params.get("negative", ""))
    seed     = _seed_val(params.get("seed"))
    steps    = int(params.get("steps", 30))
    cfg      = float(params.get("cfg", 7.0))
    frames   = int(params.get("video_frames", 24))
    fps      = int(params.get("fps", 8))
    ratio    = str(params.get("ratio", "16:9"))
    video_model = model or str(params.get("model", "svd_xt.safetensors"))

    w = int(params.get("width", 0)) or _ratio_to_wh(ratio)[0]
    h = int(params.get("height", 0)) or _ratio_to_wh(ratio)[1]
    w, h = (w // 8) * 8, (h // 8) * 8

    p = "t2v_"

    # 视频工作流链: EmptyLatentVideo → ModelLoader → CLIPTextEncode×2
    #               → KSampler → VAEDecode → SaveAnimated
    workflow: dict[str, Any] = {
        "version": "1.0",
        "nodes": {

            f"{p}model_loader": {
                "class_type": "UNETLoader",
                "inputs": {
                    "ckpt_name": video_model,
                },
            },

            f"{p}clip_pos": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": [f"{p}model_loader", 1],
                },
            },

            f"{p}clip_neg": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative,
                    "clip": [f"{p}model_loader", 1],
                },
            },

            f"{p}latent": {
                "class_type": "EmptyLatentVideo",
                "inputs": {
                    "width": w,
                    "height": h,
                    "frames": frames,
                    "batch_size": 1,
                },
            },

            f"{p}sampler": {
                "class_type": "KSampler",
                "inputs": {
                    "model": [f"{p}model_loader", 0],
                    "positive": [f"{p}clip_pos", 0],
                    "negative": [f"{p}clip_neg", 0],
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": "euler_ancestral",
                    "scheduler": "normal",
                    "latent_image": [f"{p}latent", 0],
                },
            },

            f"{p}vae": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": [f"{p}sampler", 0],
                    "vae": [f"{p}model_loader", 2],
                },
            },

            f"{p}save": {
                "class_type": "SaveAnimated",
                "inputs": {
                    "filename_prefix": f"LumiWeave_t2v_{uuid.uuid4().hex[:6]}",
                    "images": [f"{p}vae", 0],
                    "fps": fps,
                },
            },

        },
        "links": [
            [1, f"{p}model_loader", 1, f"{p}clip_pos", 0, "CLIP"],
            [2, f"{p}model_loader", 1, f"{p}clip_neg", 0, "CLIP"],
            [3, f"{p}model_loader", 0, f"{p}sampler", 0, "MODEL"],
            [4, f"{p}latent", 0, f"{p}sampler", 3, "LATENT"],
            [5, f"{p}sampler", 0, f"{p}vae", 0, "LATENT"],
            [6, f"{p}vae", 0, f"{p}save", 0, "IMAGE"],
            [7, f"{p}model_loader", 2, f"{p}vae", 1, "VAE"],
        ],
    }
    return workflow


def build_ltx_video_workflow(params: dict[str, Any]) -> dict[str, Any]:
    """构建 LTX-Video (Lightricks) Text-to-Video 工作流。

    LTX2.5 是 Lightricks 开源的 DiT 视频模型（类 Sora 架构），
    使用专用节点：LTXVideoEncode / LTXVideoDecode。

    参数：
        prompt         str      正向提示词
        negative       str      负向提示词（可选）
        seed           int/str  随机种子（可选）
        steps          int      采样步数（默认 20）
        video_frames   int      视频帧数（默认 25）
        fps            int      帧率（默认 24）
        ratio          str      宽高比（默认 '16:9'）
        cfg            float    CFG（默认 3.5，LTX 建议偏低）

    返回：ComfyUI workflow JSON
    """
    prompt   = str(params.get("prompt", ""))
    negative = str(params.get("negative", ""))
    seed     = _seed_val(params.get("seed"))
    steps    = int(params.get("steps", 20))
    frames   = int(params.get("video_frames", 25))
    fps      = int(params.get("fps", 24))
    ratio    = str(params.get("ratio", "16:9"))
    cfg      = float(params.get("cfg", 3.5))

    w = int(params.get("width", 0)) or _ratio_to_wh(ratio)[0]
    h = int(params.get("height", 0)) or _ratio_to_wh(ratio)[1]
    w, h = (w // 8) * 8, (h // 8) * 8

    p = "ltx_"

    # LTX-Video DiT 节点链：
    # EmptyLatentVideo → LTXVideoEncode → KSampler → LTXVideoDecode → SaveImage/MP4
    workflow: dict[str, Any] = {
        "version": "1.0",
        "nodes": {

            f"{p}model": {
                "class_type": "LTXVideoModelInjection",   # 加载 LTX2.5 DiT 模型
                "inputs": {
                    "model_name": "LTX-Video-2b-1k-deek.yaml",   # 配置文件路径（ComfyUI manager 安装后路径）
                },
            },

            f"{p}clip_pos": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": [f"{p}model", 1],
                },
            },

            f"{p}clip_neg": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative,
                    "clip": [f"{p}model", 1],
                },
            },

            f"{p}latent": {
                "class_type": "EmptyLatentVideo",
                "inputs": {
                    "width": w,
                    "height": h,
                    "frames": frames,
                    "batch_size": 1,
                },
            },

            f"{p}sampler": {
                "class_type": "KSampler",
                "inputs": {
                    "model": [f"{p}model", 0],
                    "positive": [f"{p}clip_pos", 0],
                    "negative": [f"{p}clip_neg", 0],
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "latent_image": [f"{p}latent", 0],
                },
            },

            f"{p}decode": {
                "class_type": "LTXVideoDecode",   # DiT 潜空间 → 像素视频
                "inputs": {
                    "samples": [f"{p}sampler", 0],
                },
            },

            f"{p}save": {
                "class_type": "SaveAnimated",
                "inputs": {
                    "filename_prefix": f"LumiWeave_ltx_{uuid.uuid4().hex[:6]}",
                    "images": [f"{p}decode", 0],
                    "fps": fps,
                },
            },

        },
        "links": [
            [1, f"{p}model", 1, f"{p}clip_pos", 0, "CLIP"],
            [2, f"{p}model", 1, f"{p}clip_neg", 0, "CLIP"],
            [3, f"{p}model", 0, f"{p}sampler", 0, "MODEL"],
            [4, f"{p}latent", 0, f"{p}sampler", 3, "LATENT"],
            [5, f"{p}sampler", 0, f"{p}decode", 0, "LATENT"],
            [6, f"{p}decode", 0, f"{p}save", 0, "IMAGE"],
        ],
    }
    return workflow


def build_workflow(params: dict[str, Any], mode: str = "text2image", model: str = "") -> dict[str, Any]:
    """根据 mode 选择工作流类型，返回 ComfyUI workflow JSON。

    参数：
        mode  str   'text2image' | 'text2video' | 'ltx-video'
        model str   模型文件名（放进 params 透传给具体 builder）
    """
    mode = str(mode or "text2image").lower()
    # 把 model 参数注入 params，供各 builder 内部使用
    if model:
        params = {**params, "model": model}
    if mode == "ltx-video":
        return build_ltx_video_workflow(params)
    if mode in ("text2video", "video", "t2v"):
        return build_text_to_video_workflow(params)
    return build_text_to_image_workflow(params)
