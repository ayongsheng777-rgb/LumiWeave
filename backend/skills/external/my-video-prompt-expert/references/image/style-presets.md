# 图片专用：风格预设库（混合架构·本地索引+云端RAG+自学习缓存）

---

## 1. 架构总则

三层混合架构：
- **第一层**：本地轻量预设索引（即时响应）
- **第二层**：云端RAG增强检索（本地未命中时触发，2秒超时降级）
- **第三层**：自学习缓存写入（用户满意/主动保存/同请求≥3次触发）

---

## 2. 第一层：本地内置预设（25个）

| 编号 | 名称 | 类别 | 核心关键词 |
|------|------|------|-----------|
| 001 | 碧蓝航线风格 | B·日系手游立绘 | cel shading, vibrant colors, anime key visual |
| 002 | 原神风格 | B·开放世界 | Genshin Impact style, cel shading, element aura |
| 003 | 明日方舟风格 | B·机能风暗调 | dark anime, tactical character, low saturation |
| 004 | FGO风格 | B·韩系厚涂古典 | Fate series, volumetric lighting, rich detail |
| 005 | 星穹铁道风格 | B·科幻二次元 | sci-fi anime, tech glow, futuristic |
| 006 | 少前风格 | B·军事机能 | military anime, tactical gear |
| 007 | 阴阳师风格 | B·日式和风 | Japanese traditional anime, mystical atmosphere |
| 008 | 赛博朋克风格 | C·创意混合 | neon lights, futuristic city, rain-slicked streets |
| 009 | 吉卜力风格 | B·手绘动画 | hand-drawn animation, watercolor background |
| 010 | 新海诚风格 | B·写实动画 | hyper-detailed background, volumetric light |
| 011 | 油画古典 | A·写实摄影 | classical oil painting, Renaissance, chiaroscuro |
| 012 | 极简扁平插画 | B·扁平插画 | flat illustration, minimal design |
| 013 | 暗黑哥特 | B·暗黑幻想 | gothic style, dramatic lighting |
| 014 | 水彩绘本 | B·水彩手绘 | watercolor illustration, soft edges |
| 015 | 蒸汽朋克 | C·创意混合 | steampunk, brass, victorian fashion |
| 016 | 日系人像写真 | A·写实人像 | Japanese portrait, film grain, soft light |
| 017 | 电商白底产品 | A·产品摄影 | white background, shadowless soft light |
| 018 | 国家地理风光 | A·风光摄影 | landscape photography, dramatic light |
| 019 | 商业建筑摄影 | A·建筑摄影 | two-point perspective, vertical lines corrected |
| 020 | 美食静物 | A·美食摄影 | food photography, soft side light |
| 021 | 大气循环示意图 | D·科学信息图 | atmospheric circulation, flat illustration, labeled arrows |
| 022 | 水循环信息图 | D·地理信息图 | water cycle diagram, isometric, blue tones |
| 023 | 细胞结构图 | D·生物信息图 | cell anatomy, realistic 3D, cross-section |
| 024 | 流程图模板 | D·流程信息图 | flowchart, minimal, clean lines |
| 025 | 时间轴信息图 | D·时间线 | timeline infographic, vintage style |

---

## 3. 第二层：云端RAG增强检索

### 触发
本地预设无匹配时自动启用

### 流程
1. 提取实体词（游戏名/动画名/画师名/作品名/摄影师名）
2. 构造查询：`[实体词] + 画风特点 + art style keywords`
3. RAG向量语义召回 Top-3 候选

### 超时降级（强制执行）
- **超时阈值**：2秒
- 未返回或置信度<0.6 → 自动降级为默认规则
- 输出提示（≤20字）："未找到该风格参考，已按通用生成"
- **禁止因等待而阻塞生成流程**

### 结果注入规范
- 关键词必须去重、去冲突、权重分配后整合
- **禁止原始文本直接注入**

---

## 4. 第三层：自学习缓存写入

- **触发**：用户满意 / 主动保存 / 同一风格请求≥3次
- **容量上限**：100条
- **淘汰策略**：超出时淘汰最少使用的"云端缓存"条目（系统内置+用户自建永不淘汰）

---

## 5. 用户自建预设快捷指令

用户输入以下格式时触发保存：
- "把这个风格保存为'[名称]'"
- "保存为个人预设：[名称]"

**执行流程**：
1. 提取当前风格特征（类别、关键词、色彩倾向、权重方案）
2. 写入本地预设索引，标记为"用户自建"
3. 输出："已保存为个人预设'[名称]'，下次输入该名称即可调用。"

---

*来源：image-prompt 第七条完整保留*
