# 视频专用：正向提示词构建规则（字段池对齐版 v2）

> 本文件是 `field-pools.md` 的**执行层**——字段池定义"拆什么"，本文件定义"怎么拼"。
> 所有模板槽位均直接引用 `field-pools.md` 中的字段ID，确保构建与拆解完全对齐。
> 最终输出目标：**2-5个自然句，300-600字**。

---

## 0. 字段引用速查表（构建时对照使用）

| 槽位 | 对应字段ID | 输出权重 | 占比目标 |
|------|-----------|---------|---------|
| **主体+运动** | `V-SUBJ` | 1.0-1.3（最高） | 25-35% |
| **镜头/运镜** | `V-CAM` | 0.9-1.1 | 10-15% |
| **环境/场景** | `V-ENV` | 0.8-1.0 | ~15% |
| **光影/色调** | `V-LIGHT` | 0.9-1.2 | 10-15% |
| **风格/氛围** | `V-STYL` | 0.7-0.9 | 5-10% |
| **物理/运动逻辑** | `V-PHYSICS` / `VB-MOTION` | 0.7-0.9 (A/B类升1.0) | 动词短语 |
| **质感/渲染** | `V-TEXTURE` / `VB-RENDER` | 0.6-0.8 | 各1-3词 |
| **空间纵深** | `V-DEPTH` | 0.5-0.7 | 一句话 |
| **时间/节奏** | `V-TIMING` | 0.6-0.8 | 融合在运镜/运动中 |
| **运动细化** | `V-MOTION-DTL` | 0.5-0.7 | 仅四级输入展开 |
| **特效** | `V-EFFECT` / `VC-ABERRATION` | 0.4-0.7 | 列举形式 |
| **画质** | `V-TECH` / `VB-QUALITY` | 0.2-0.3 | 固定尾缀，最先裁剪 |
| **比例** | `V-RATIO` | 0.0 | 仅作平台参数传递 |

> ⚠️ B类动画有5个字段替换映射（见 §6.2），使用 VB-* 替代 V-*。

---

## 1. 分类构建流程总览

```
用户输入 → input-mapping判定类型(A/B/C/D) + 输入等级(一~四级)
    ↓
field-pools按类型+等级激活对应字段集合
    ↓
  ┌─ A类实拍 → 使用VA-*扩展字段 + V-*通用字段
  ├─ B类动画 → V-*中5个字段被VB-*替换（见替换矩阵）+ VB-*独有追加
  ├─ C类创意 → 继承矩阵选择A/B字段 + VC-*独有
  └─ D类信息图 → 完整VD-*替换集
    ↓
本文件按分类模板将字段值组装为2-5个自然句
    ↓
字数检查(300-600字) → 超限则执行防膨胀裁剪(field-pools §六)
    ↓
输出最终提示词 + 来源标记
```

---

## 2. 通用组合描述规范（A/B/C/D 全类强制）

当主体和环境均非【无】且非特写聚焦时：

**必须使用**："主体 + 位于/处于 + 环境 + 环境细节" 句式
**自动分配空间占比**：

| 类型 | 占比选择 |
|-----|---------|
| 对比型（主体小环境大） | 主体15%-30%，广阔环境包裹 |
| 均衡型 | 主体居中偏位，环境围绕 |
| 聚焦型（特写） | 不添加占比描述 |

**词汇强制**：对比型背景含"远处""广阔""延伸""高耸"之一；对比型主体避免"巨大""充满画面"。

---

## 3. 纵深与透视描述强化规则（映射 V-DEPTH）

### 触发条件
镜头有推/拉/跟/摇运动 + 场景有深度层次；或用户描述含"纵深""透视""延伸"

### 三要素（至少包含两项）
- 前景元素 | 中景主体 | 背景环境

### 按类强制应用

| 类型 | 必须添加 | 默认值 |
|-----|---------|--------|
| 实拍类(A) | 景深描述（背景虚化/前景清晰/焦点切换rack focus暗示） | 人像→浅景深 / 风光→全景深 |
| 动画类(B) | 层次描述（前景飘落元素+中景主体+背景剪影） | 三层清晰分离 |
| 信息图类(D) | 明确空间纵深类型（2D/2.5D/3D剖面） | → 2.5D等距 |

### 构建行为
- 特写固定镜头 → `V-DEPTH` 标记N/A，不输出
- 有推/拉/跟运镜 → 自动激活，用一句话带过
- 用户强调纵深 → 权重临时提升至0.7

---

## 4. 笔触/渲染细节与质感材质规则

### 词库速查（按类别·注意B类字段名不同）

| 类别 | 渲染词库 | 材质词库 | 额外要素 |
|-----|---------|---------|---------|
| **A·实拍类** (`F-BRUSH`/`V-TEXTURE`) | `sharp focus, crisp details, fine texture, hyper-realistic rendering, no visible brushstrokes` | `skin pores, fabric weave, metal scratches, glass reflections, wood grain` | — |
| **B·动画类** (`VB-RENDER`) | `clean line art, thick contours, cel-shaded, gradient shading, vector crisp, subsurface scattering` | — | 运动：`smooth motion, fluid animation, bouncy movement, squash and stretch` |
| **C·创意混合** | 按 VC-FUSION 策略从A/B混合选取 | 允许混合材质 | 按 VC-CREATIVE 选择 |
| **D·信息图** (`FD-MATERIAL`) | `precise line work, consistent stroke width, technical drawing style` | `paper, glass, metal, glow, matte, digital screen` | 运动服务于信息传达 |

### 强制应用规则
- 任何物体表面 → 至少一种材质/渲染词
- 人像→皮肤 | 产品→表面材质 | 信息图→基底材质
- 艺术风格请求时笔触权重提升至1.4
- **动画类(B)必须包含运动细节**（这是视频区别于图片的核心）

---

## 5. 运动强化规则（映射 V-SUBJ / V-PHYSICS / VB-MOTION / V-MOTION-DTL）

按分类使用不同的运动描述语言：

### A类实拍 — 物理真实运动
- 主体运动：具体动词+轨迹（"快速向前奔跑""缓慢旋转飘落""沿街道平稳滑行"）
- `V-PHYSICS` 物理交互：因果描述（"足球撞击球门网，网子向后弹起并剧烈晃动"）
- 镜头运动：明确类型（"镜头缓慢推近""镜头从侧面跟随""镜头固定"）

### B类动画 — 动画运动规律（使用 VB-MOTION 字段）
- 基础规律自动注入：弹性形变(squash and stretch)、预备缓冲(anticipation)、弧线运动(arc)、跟随与重叠(follow-through)、渐入渐出(easing)
- 三级以上输入时主动注入相关原则
- **禁止使用**快门速度/ISO/帧率等实拍摄影术语

### C类创意 — 创意运动逻辑（使用 VC-CREATIVE 字段）
- 扭曲(distortion) / 流动(flow) / 生长(growth) / 循环(loop) / 形变(metamorphosis) / 粒化(dissolution)
- 允许并鼓励违反物理规律

### D类信息图 — 信息传达运动
- 所有运动**服务于信息传达**
- ✅ "元素依次出现""数据条依次增长""箭头顺序流动"
- ❌ "元素快速旋转飞舞""炫酷粒子爆发"
- 映射 `VD-RHYTHM` 字段的节奏设计

---

## 6. 四类分类构建模板

### 6.1 A类 · 实拍电影/广告类（映射：V-P0/P1/P2 + VA-*扩展）

**模板**：
```
[V-SUBJ 主体][具体运动描述]。[交互细节(V-PHYSICS, P0核心)]。
[V-CAM 镜头视角]下拍摄，[V-ENV 环境]。
[V-LIGHT 光影与色调](P0核心)，[V-TEXTURE 材质](A类强制高精度)。
[VA-SUBTYPE 实拍子类型]，[VA-LENS 镜头语言语义]，
[VA-GRADING 调色后期感](与V-LIGHT协调一致)。
[V-STYL 风格基调]，[V-TECH 画质技术词]。
```

**A类特殊构建规则**：
- `V-SUBJ` 必须包含"谁在动 + 怎么动"（视频必须有运动描述）
- `V-PHYSICS` 在A类升至P0——通过 **`VA-PHYSICS`(物理交互强化)** 表达更严格的因果关系，物理交互的因果链必须写清楚
- `V-LIGHT` 是P0核心（视频光影随时间动态变化，比图片更关键）
- `VA-GRADING` 的调色描述必须与 `V-LIGHT` 的光影描述协调一致
- `V-DEPTH` 在A类必须包含景深描述（归入V-DEPTH值域）
- `VA-RHYTHM` 剪辑节奏感（P2）——暗示镜头呼吸感和节奏感知（虽生成单镜头但可传递节奏），四级输入时激活
- 目标：300-600字，2-5自然句

**示例填充路径**：
> 用户："赛博朋克风格一个人在雨街跑步"
>
> - V-SUBJ → 穿着黑色风衣的人物在雨后霓虹街道上快速奔跑
> - V-PHYSICS → 溅起水花，脚步落地水面向外扩散
> - V-CAM → 侧跟镜头，保持人物画面中心，平视角度
> - V-ENV → 城市街道两侧霓虹灯牌，湿路面反射彩色灯光
> - V-LIGHT → 冷蓝霓虹主光源+橙暖窗口补光+湿地反射高对比电影布光
> - V-TEXTURE → wet asphalt texture, fabric rain-soaked, neon light reflections
> - VA-SUBTYPE → 电影感实拍
> - VA-LENS → 广角语义（环境包裹感强）
> - VA-GRADING → 青橙色调分级(teal & orange)，轻微胶片颗粒感
> - V-STYL → cyberpunk cinematic, high contrast
> - V-TECH → 8k, highly detailed, film grain
>
> **输出**：穿着黑色风衣的人物在雨后霓虹街道上快速奔跑，溅起水花脚落水面四散。侧跟镜头平视保持人物中心，两侧霓虹灯牌湿路面反射彩光掠过。冷蓝霓虹主光源配合橙暖补光湿地反射高对比电影布光，wet asphalt texture, rain-soaked fabric, neon reflections。电影感实拍广角视角，青橙色调分级轻微颗粒感。cyberpunk cinematic, high contrast, 8k, highly detailed.

---

### 6.2 B类 · 动画/CG类（⚠️ 字段替换矩阵 · 5个V字段→VB-*）

**B类字段替换对照表**（构建时必须使用右侧字段）：

| 原通用字段 | → 替换为 | 构建时使用的词库/语言体系 |
|-----------|---------|----------------------|
| `V-CAM` 镜头/运镜 | → **`VB-CAM` 运镜方式** | 环绕/推近/跟随/固定/变焦（不受物理限制） |
| `V-LIGHT` 光影 | → **`VB-LIGHT` 动画光影模式** | 赛璐珞平涂 / 皮克斯全局光 / 体积光 / 边缘光 / 动态光源 |
| `V-PHYSICS` 物理逻辑 | → **`VB-MOTION` 动画运动规律** | squash and stretch / anticipation / arc / follow-through / easing |
| `V-TEXTURE` 材质 | → **`VB-RENDER` 渲染特征** | line art quality / shading style / material render / effects particles |
| `V-TECH` 画质 | → **`VB-QUALITY` 动画画质参数** | high precision rendering / quality animation / smooth motion / frame-perfect |

**模板**：
```
[V-SUBJ 角色][动画动作描述][VB-CHAR-ACT 角色动画表现](表情/肢体/口型)。
[VB-CAM 运镜方式]下，[V-ENV 场景][VB-EFFECT 特效粒子]。
[VB-LIGHT 动画光影风格]笼罩全局，
[VB-MOTION 动画运动规律](三级+输入时主动注入)。
[VB-STYL 动画风格细分](P0核心)，[VB-RENDER 渲染特征]。
[VB-QUALITY 动画画质参数]。
```

**B类特殊构建规则**：
- `VB-STYL` 动画风格细分是P0核心——必须精确定位（如"日系二次元"/"皮克斯迪士尼3D"/"国风水墨"）
- `VB-MOTION` 的动画十二原则（或子集）在**三级及以上输入时主动注入**
- `V-MOTION-DTL` 在B类提升至P1（运动分解：预备→执行→缓冲三阶段）
- **禁止使用**焦段/景深/ISO/快门速度等实拍摄影术语
- 动画风格细分速查（见下表，构建时匹配选择）

**动画风格细分速查表**：

| 风格 | 关键词映射 | 强制字段组合 |
|-----|-----------|------------|
| 日式二次元 | anime style, cel shading, fluid character animation | VB-LIGHT=赛璐珞, VB-MOTION=弧线+跟随, VB-RENDER=clean lines |
| 皮克斯/迪士尼3D | Pixar style, 3D animation, exaggerated expressions, smooth motion | VB-LIGHT=体积全局光, VB-MOTION=挤压拉伸+预备, VB-RENDER=subsurface scattering |
| 定格动画 | stop-motion style, claymation, tactile textures, jerky but charming | VB-LIGHT=定向硬光模拟摄影棚, VB-MOTION=逐帧跳跃感, VB-RENDER=可见材质指纹 |
| 国风水墨 | Chinese ink wash painting animation, flowing brushstrokes, ethereal | VB-LIGHT=水墨留白, VB-MOTION=飘逸流动, VB-RENDER=笔触可见 |

**示例填充路径**：
> 用户："白发角色旋转挥剑，日式动画风格"
>
> - V-SUBJ → 白发角色双手持剑旋转挥舞
> - VB-CHAR-ACT → 表情专注坚定，身体重心随旋转转移，衣摆飞扬
> - VB-CAM → 环绕镜头跟随角色旋转半周
> - V-ENV → 日式庭院场景，花瓣飘散，地面落叶
> - VB-EFFECT → 剑身泛光粒子效果，花瓣飘散轨迹
> - VB-LIGHT → 柔和全局光照+角色轮廓边缘光（动态光源随剑移动）
> - VB-MOTION → 弧线运动路径 + squash and stretch(蓄力→爆发缓冲) + follow-through(剑势惯性)
> - VB-STYL → 日式二次元 anime style
> - VB-RENDER → clean line art, cel-shaded, gradient shading
> - VB-QUALITY → high precision rendering, smooth motion, quality animation
>
> **输出**：白发角色双手持剑旋转挥舞，表情专注坚定重心转移衣摆飞舞。环绕镜头跟旋半周，日式庭院场景花瓣飘散地面落叶，剑身泛光粒效。柔和全局光照笼罩角色轮廓边缘光随剑移动，弧线路径配合蓄力爆发缓冲及挥后剑势惯性。日式二次元anime style，clean line art, cel-shaded, gradient shading。high precision rendering, smooth motion, quality animation.

---

### 6.3 C类 · 创意/实验影像类（映射：继承矩阵 + VC-*独有）

**继承矩阵构建指引**：

| 继承来源 | 条件 | 采用的字段 | 覆盖调整 |
|---------|------|-----------|---------|
| **A类** | 含实拍基础素材 | `V-PHYSICS`(P1) + `VA-LENS`(P2) + `VA-GRADING`(P2) | 物理效果允许夸张/违反常规 |
| **B类** | 含动画/CG元素 | `VB-MOTION`(P1) + `VB-EFFECT`(P1) + `VB-RENDER`(P1) | 运动规律可以完全打破 |

**模板**：
```
[VC-FUSION 混合媒介声明](P0)：[描述不同媒介结合方式]
[V-SUBJ / 元素][VC-CREATIVE 创意运动逻辑](P0标识字段)。
[视角]下，[V-ENV 环境与互动]。
[V-LIGHT 光影色彩](允许艺术夸张)，
[V-TEXTURE/VB-RENDER 材质渲染](允许混合)。
[VC-ABERRATION 实验性参数](如适用)，[V-STYL 艺术风格]。
[V-TECH 画质技术词]。
```

**C类特殊构建规则**：
- **第一步**：通过继承矩阵确定从A和B各继承哪些字段
- **第二步**：`VC-FUSION` 和 `VC-CREATIVE` 作为开头前两句（C类的标识性声明）
- **第三步**：允许并鼓励违反物理规律的描述（这是C类核心价值）
- `V-PHYSICS` 在C中被替换为"创意因果逻辑"（视觉因果链而非物理因果）
- 总量放宽至40-80组（创意抽象概念需要更多描述词汇）

---

### 6.4 D类 · 信息图/科学视频类（映射：完整 VD-* 替换集）

**模板**（强制执行）：
```
[VD-TYPE 视频类型]展示[VD-CONCEPT 核心概念]，采用[VD-RENDER 映射自V-STYL 渲染风格]。
[主体图元完整描述]，
[VD-LABEL 标注系统](语言/字体/位置/出现时机)，
[VD-FLOW 流向连接](箭头/线型/粗细/颜色/**运动方式**:依次出现/同时流动/脉冲)。
色彩方案采用[VD-CSCHEME 主色+辅色+语义色]，
背景为[背景类型]。
材质呈现[VD-MATERIAL 材质质感]，
空间纵深[VD-SPACE 纵深类型]。
信息层级[VD-HIERARCHY 权重分布]，
运动节奏[VD-RHYTHM 服务于理解的节奏]。
整体画质要求[VD-DURATION 时长感知暗示]。
```

**D类特殊构建规则**：
- 通用字段池仅保留 `V-SUBJ`(映射到VD-CONCEPT) 和 `V-STYL`(映射到VD-TYPE+渲染风格)
- `V-CAM` 在D类退化为**视角/观察方式**（不再是传统运镜，而是"信息导航方式"：平移/缩放/聚焦/展开）
- `V-TECH` 移除（信息图的"质量"由清晰度和专业性体现）
- 总量放宽至50-100组（科学视频天然需要更多精确描述）
- **核心原则**：所有运动服务于信息传达，禁止纯装饰性运动

**示例填充路径**：
> 用户："大气循环演示视频"
>
> - VD-TYPE → 科学演示动画
> - VD-CONCEPT → 全球大气环流模式（哈德利/费雷尔/极地三圈环流）
> - VD-RENDER → 扁平矢量风格
> - 主体图元 → 地球剖面（倾斜23.5°轴），大气层分层可视化
> - VD-LABEL → 中文简体标签位于各环流带旁，白色无衬线字体逐个出现
> - VD-FLOW → 红/蓝粗实线箭头表示暖气流上升北上/冷气流下沉南回，**依次流动**
> - VD-CSCHEME → 浅蓝海洋+棕绿陆地+红(暖)/蓝(冷)语义色编码
> - 背景 → 浅蓝渐变背景+网格线辅助
> - VD-MATERIAL → 哑光纸质
> - VD-SPACE → 2.5D等距纵深
> - VD-HIERARCHY → 标题→地球剖面团→环流箭头→标签文字→图例（递减视觉权重）
> - VD-RHYTHM → 信息元素流畅出现，每个环流带展示完成后进入下一个
> - VD-DURATION → 约15-20秒感知时长
>
> **输出**：科学演示动画展示全球大气环流三圈循环机制，采用扁平矢量渲染风格。地球剖面（23.5°轴倾角）为主体，大气层分为对流层平流层中间层热层四层可视化。中文简体白色无衬线标签在各环流带旁边依次出现。红/蓝粗实线箭头表达暖空气上升向北流动、冷空气下沉向南回流，箭头沿环流路径依次流动出现。浅蓝海洋配棕绿陆地底图，红色=暖气流、蓝色=冷气流语义编码，浅蓝渐变背景加网格辅助。哑光纸质材质呈现，2.5D等距纵深空间。标题最突出→地球剖面团次之→三圈环流箭头→标签说明→底部图例逐级递减。信息元素流畅有序出现，每完成一圈环流展示再进入下一圈。整体约15-20秒感知时长，高清清晰度。

---

## 7. 防膨胀集成（构建后执行·强制）

最终提示词超出 **300-600字 / 2-5句** 时，按以下顺序裁剪（来自 `field-pools § 六`）：

### 第一步：移除P2增强字段
`V-TECH` / `VB-QUALITY` → `V-AUDIO-HINT` → `V-EFFECT` / `VC-ABERRATION` → `V-MOTION-DTL`

### 第二步：压缩P1扩展字段
从最低权重开始：`V-RATIO`(已排除) → `V-DEPTH` → `V-TIMING` → `V-TEXTURE` / `VB-RENDER` → `V-PHYSICS` / `VB-MOTION` → `V-STYL` → `V-LIGHT`
- 每"完整描述"压缩为"单关键词/短句"

### 第三步：精简P0核心字段（最后手段）
保留 `V-SUBJ`(主体+运动)完整性不动
压缩 `V-ENV`(环境→一句话) + `V-CAM`(运镜→术语短语)

### 禁止事项
- ❌ 永远不裁剪 `V-SUBJ` 主体与运动
- ❌ 永远不裁剪 `V-CAM` 运镜（没有运镜的视频不是视频，是图片序列）
- ❌ 不为凑字数填充 filler 词

---

## 8. 按输入等级的构建粒度控制

| 输入等级 | 构建粒度 | P0核心 | P1扩展 | P2增强 | 智能默认值使用 |
|---------|---------|--------|--------|--------|-------------|
| **一级极简** | 最简可用 | ✅ 全部激活（短句） | ⚠️ 仅自动激活项 | ❌ 全跳过 | ✅ 大量使用填补空白 |
| **二级**（风格+主体+基本运动） | 标准质量 | ✅ 全部激活 | ✅ 相关字段 | ❌ 全跳过 | ✅ 适度填充未提及P1 |
| **三级**（多维度） | 高质量丰富 | ✅ 全部激活 | ✅ 大部分 | ✅ 部分激活 | ⚠️ 最小化仅空白字段 |
| **四级**（完整精确） | 精确完整 | ✅ 全部激活 | ✅ 全部激活 | ✅ 全部激活 | ❌ 不使用以用户为准 |
| **教学模式** | N/A（走 tutorial.md 独立流程） | | | | |
| **反编译模式** | 全维度暴力拆解 | ✅ 全部 | ✅ 全部 | ✅ 全部 | ❌ 以实际内容为准 |

---

*来源：video-prompt 第十条完整保留 · v2升级版 — 字段ID完全对齐field-pools v2 + B类5字段替换矩阵显式融入模板 + 四分类独立构建模板 + 权重引导 + 防膨胀集成 + 动画风格细分速查 + 输入等级联动*
