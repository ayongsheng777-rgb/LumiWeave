# 视频专用：视频类型识别与逻辑分流详细规则（前置分流器·强制执行）

本规则为视频模态的前置分流器，必须在字段拆解之前首先执行。

---

## 四类识别标准

| 类别 | 定义 | 示例 |
|-----|------|------|
| **A·实拍电影/广告** | 真实物理世界的光影、材质、运动规律 | 电影片段、产品广告、自然纪录片 |
| **B·动画/CG** | 二次元/3D/定格等，运动可夸张风格化 | 动漫、皮克斯风、国风水墨 |
| **C·创意/实验影像** | 抽象视觉、超现实、混合媒介 | 扭曲变形、流体艺术、循环概念 |
| **D·信息图/科学视频** | 流程动画、数据可视化、时间轴、教学演示 | 以传递知识/数据为目的的动态图示 |

---

## 分流执行表

| 识别结果 | 加载规则 | 特殊要求 |
|---------|---------|---------|
| **A类** | 完整执行所有规则 | 强调物理逻辑、材质真实感、镜头平滑度 |
| **B类** | 启用「动画专属生成逻辑」 | 字段替换（见下方B类详情） |
| **C类** | 灵活混用A+B组件 | 必须明确"创意运动逻辑" |
| **D类** | 启用「信息视频专属逻辑」 | 信息准确优先、禁用干扰运动 |

---

## B类 · 动画专属生成逻辑（详细）

### 字段替换映射

| 原字段 | 替换为 | 示例 |
|-------|--------|------|
| 镜头 | **运镜方式** | "镜头环绕""推近""跟随角色" |
| 光影 | **动画光影风格** | "赛璐璐平涂""皮克斯全局光照""体积光" |
| 物理逻辑 | **动画运动规律** | "夸张弹性形变""预备与缓冲""弧线运动" |
| 画质 | **动画画质参数** | "高精度渲染""大师级动画""线条流畅" |

### 动画风格细分速查

| 细分 | 关键词 |
|-----|--------|
| 日式二次元 | anime style, cel shading, fluid character animation, expressive eyes |
| 皮克斯/迪士尼3D | Pixar style, 3D animation, exaggerated expressions, smooth bouncy |
| 定格动画 | stop-motion style, claymation, tactile textures, jerky charming |
| 国风水墨 | Chinese ink wash animation, flowing brushstrokes, elegant motion |

---

## D类 · 信息图/科学视频专属逻辑（详细）

### D1 核心原则
- **信息准确优先** > 视觉效果（严禁编造虚假信息）
- 层级清晰：主体信息 > 次级信息 > 标注细节
- 视觉引导：箭头/连线/编号/色块引导阅读顺序
- 标注系统：所有关键节点必须有文字标签
- **运动逻辑服务于信息传达**（避免干扰性复杂运动，以平移/缩放/出现消失/路径流动为主）

### D2 专用字段池（11项）

| 字段 | 说明 |
|------|------|
| 视频主题类型 | 流程动画/数据可视化/时间轴/科学演示/教学动画 |
| 核心概念 | 主要知识内容 |
| 信息层级 | 主标题→核心图元→次级标注→细节 |
| 标注语言 | 中文/英文/双语，字体风格，位置 |
| 色彩编码 | 不同层级不同色系，对比度要求 |
| 箭头/流向 | 方向、线型、粗细、颜色、运动方式 |
| 背景类型 | 纯色/网格/渐变/透明/场景化 |
| 渲染风格 | 写实3D/扁平矢量/手绘/线稿/科技感/羊皮纸 |
| 材质质感 | 纸张/玻璃/金属/发光/哑光 |
| 空间纵深 | 2D平面/2.5D等距/3D透视/剖面层次 |
| 运动节奏 | 信息元素出现的节奏（顺序/同时/渐变） |
| 时长感 | 信息展示所需感知时长 |

### D3 组合描述模板（强制执行）
> 见 `build-rules.md` 的 D 类模板部分

### D4 专用关键词库

| 维度 | 关键词 |
|------|--------|
| 渲染风格 | flat illustration, vector animation, isometric 3D, realistic 3D render, hand-drawn sketch, technical blueprint, neon wireframe... |
| 标注系统 | labeled animation, callout lines, text annotations, legend box, numbered parts, leader lines... |
| 流向元素 | directional arrows, animated flow lines, circular arrows, sequential numbering... |
| 材质质感 | paper texture, matte finish, glass material, metallic sheen, luminous glow, grainy paper |
| 空间纵深 | 2D flat, 2.5D isometric, cross-section view, exploded view, layered depth |
| 运动节奏 | sequential reveal, smooth transition, synchronized appearance, gradual fade-in |
| 笔触 | clean line art, sketchy lines, no outlines, thick contours, fine details, minimal blur |

### D5 知识准确性约束（强制执行）
- 科学/地理/生物/物理：未提供精确内容 → `"⚠️ 以下为通用示意图，请以专业教材为准"`
- 数据类：必须用户提供原始数据 → 否则占位符+"请补充具体数值"
- 禁止编造不存在概念

---

*来源：video-prompt 第四条完整保留*
