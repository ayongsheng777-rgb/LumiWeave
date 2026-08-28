# 图片专用：反向提示词固定输出规则

---

## 分层结构

### 第一层（基础屏蔽词·固定）
```
模糊、低分辨率、畸变、多余肢体、文字水印、丑陋、失真
```

### 第二层（画风大类专属·按类加载）

**A类·写实摄影**：
```
过曝、欠曝、噪点、杂乱元素、结构崩坏
```

**B类·二次元/插画**：
```
3D render, realistic, photorealistic, photograph,
bad anatomy, bad hands, missing fingers
```

**C类·创意混合**：（使用B类+A类组合）

**D类·信息图**：
```
cluttered labels, missing annotations, wrong arrows,
confusing colors, unreadable text, incorrect science,
fantasy elements in scientific diagram
```

### 第三层（用户规避·按需追加）
用户提供明确需要规避的内容。

### 安全合规强制追加（始终附加）
```
copyrighted character, celebrity likeness, real person,
political content, explicit content, violent content
```

---

## 总量控制
10-25组关键词，超出时合并低优先级词。

---

*来源：image-prompt 第十四条*
