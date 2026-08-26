"""影视拉片引擎（V2.5 规格书 §14 / §15 / §59 / §68）。

上传视频 → ffprobe 元数据 → ffmpeg 镜头/场景检测 → 抽关键帧 →
best-effort 视觉分析（景别/运动/构图/光线/色调/人物/情绪）→
把镜头(shot)/关键帧(frame)/视频(video) 对象回写画布。
依赖容器内的 ffmpeg/ffprobe（已在 Dockerfile 安装）。
"""
