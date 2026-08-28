# 视频专用：反向提示词固定输出规则（跨平台通用）

采用固定分层结构，直接罗列，无权重，总量控制 **10-20组**。

---

## 第一层（基础视觉伪影·固定）
```
模糊、低分辨率、抖动、闪烁、画面撕裂、鬼影、变形、多余的肢体、文字水印、丑陋
```

## 第二层（运动与逻辑伪影·固定）
```
不自然的运动、物体凭空消失、物体穿模、物理逻辑错误、
动作僵硬、帧率不稳定、主体畸变、画面卡顿
```

## 第三层（视频类型专属·按类加载）

**A类·实拍**：
```
不真实的材质、卡通渲染、CG感过强、僵硬的光影、缓慢的帧率
```

**B类·动画**：
```
3D渲染（针对2D）、真实照片纹理、僵硬表情、
不流畅运动、线条抖动
```

**C类·创意**：
```
单调、无变化、缺乏动感
```

**D类·信息图/科学视频**：
```
cluttered labels, missing annotations, wrong arrows,
confusing colors, unreadable text, incorrect science,
fantasy elements in scientific diagram,
distracting motion, over-complicated animation
```

## 第四层（用户明确规避·按需追加）
用户提供的内容。

---

*来源：video-prompt 第十一条完整保留*
