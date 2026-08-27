# LumiWeave 画布 UI/UX 全面重做任务清单（支持明暗主题）

> 范围：**C 全面重做**（画布壳层 + 共享节点外壳 + 节点内部表单）
> 核心原则：**只改样式不改逻辑** —— CSS class 结构与交互行为零变更，颜色值换变量、质感换令牌。
> 涉及两套画布：工作流画布（`components/WorkflowCanvas.tsx` + `components/nodes/*`）+ 无限/场景画布（`canvas/*` + `scene/*`）。
> 基线已存在：`src/styles/index.css` 的 `--lw-*` 变量 + `.dark` 类 + tailwind `darkMode:'class'` + 顶栏主题切换。

---

## Phase 0 · 风险防护与基线（先做，全程受益）

| 编号 | 任务 | 涉及文件 | 验收标准 | 回归风险 / 规避 |
|---|---|---|---|---|
| T0.1 | 创建分支 `feature/canvas-uiux` + 打基线 tag | git | 分支/标签存在，随时可回滚 | 全程每 Phase 独立 commit，坏一处回滚一处 |
| T0.2 | 基线行为清单（写死进任务单）：节点拖拽/缩放/连线/选中/删除/锁定/生成中/结果展示/主题切换 9 项 | — | 每 Phase 完成后按清单回归 | 防止"改样式带崩交互" |

## Phase 1 · 全局色彩与主题变量重构（Design Tokens）

| 编号 | 任务 | 涉及文件 | 验收标准 | 回归风险 / 规避 |
|---|---|---|---|---|
| T1.1 | **补齐令牌集**（明暗两组）：`--lw-node-bg`（节点底）、`--lw-node-inner`（内描边）、`--lw-node-shadow`（明色软影）、`--lw-edge-active`（选中线）、`--lw-accent-soft`（品牌柔色）、`--lw-toast-bg`、`--lw-glass`（玻璃底）、`--lw-glow`（暗色发光） | `src/styles/index.css` | 明暗两套值齐全，HTML 可引用 | 纯新增变量，不动旧变量，零风险 |
| T1.2 | **39 处写死颜色变量化**（按分布逐文件）：nodeRegistry 14 / lingjingNodes 7 / sceneStore 3 / WorkflowCanvas 3 / objectNodes 3 / 双 NodeShell 3 / SceneCanvas / SceneBottomBar / TokenPanel / SettingsModal / Popover / MediaNodeShell | `canvas/nodeRegistry.ts`、`canvas/lingjingNodes.tsx`、`store/sceneStore.ts`、`components/WorkflowCanvas.tsx`、`canvas/objectNodes.tsx`、`canvas/NodeShell.tsx`、`components/nodes/NodeShell.tsx` 等 | 全项目无裸 hex/rgba（除 index.css 定义区）；明暗切换全部跟随 | 只换值不换结构；每文件改完 tsc 过 |
| T1.3 | **主色降饱和 + 微渐变**（明色模式）：品牌紫由高饱和调整，增加细渐变 token | `index.css`、tailwind `brand` 色板 | 明色大背景下不刺眼；暗色保持现有亮紫 | 渐变仅作用于强调态（按钮/选中），不铺满 |
| T1.4 | **网格线弱化**：明色 `--lw-canvas-dot` 降到极浅灰（≈#E5E7EB），暗色点阵更暗 | `index.css` | 明色画布干净有呼吸感 | 纯色值 |

## Phase 2 · 节点与连线渲染优化

| 编号 | 任务 | 涉及文件 | 验收标准 | 回归风险 / 规避 |
|---|---|---|---|---|
| T2.1 | **连线改实线贝塞尔**：废弃流动虚线（`animated`），`smoothstep`→贝塞尔/大圆角；选中加深加粗；暗色同色系微发光（`filter: drop-shadow`） | `components/WorkflowCanvas.tsx`、`canvas/CanvasCore.tsx`、`store/workflowStore.ts`、`store/canvasStore.ts` | 明色素雅实线+选中加粗；暗色柔和发光；连线后节点接龙等逻辑不变 | ⚠️ 连线样式在 store 层生成，改样式不动 `onConnect`/`addEdge` 逻辑；验收连新线+重载场景 |
| T2.2 | **节点卡片去边框**：明色白底+柔和底层大阴影；暗色浅阶底（比画布亮一级）+1px 半透明内描边（`inset`），不用外阴影 | 双 `NodeShell.tsx`、`MediaNodeShell.tsx`、`canvas/NodeShell.tsx` | 明/暗两套质感达标；选中态可辨识 | 外壳样式集中改，子节点组件不逐个碰 |
| T2.3 | 节点**选中态统一**：品牌色柔和描边/光晕（替代目前硬边框） | 双 NodeShell + SceneObjectNode | 选中醒目但不喧宾 | 与 T2.2 同批 |

## Phase 3 · 布局与控件悬浮化

| 编号 | 任务 | 涉及文件 | 验收标准 | 回归风险 / 规避 |
|---|---|---|---|---|
| T3.1 | **场景画布工具栏悬浮化**：固定侧栏 → 悬浮胶囊组件（对齐工作流 FloatingToolbar 观感），可折叠 | `scene/SceneToolbar.tsx`、`scene/SceneCanvas.tsx` | 场景画布中心操作区最大化；拖节点/加节点流程不变 | 工具栏按钮事件原样保留 |
| T3.2 | **侧栏/抽屉玻璃化**：SceneSidebar / SceneInspector / CanvasInspector / LayerPanel 改半透明 + `backdrop-blur`（明色白玻璃、暗色深玻璃） | 上述 4 文件 | 明暗两套融入网格不突兀 | 抽屉开合状态逻辑不动 |
| T3.3 | **MiniMap/Controls 玻璃化**：工作流画布统一 Controls/MiniMap 玻璃底；无限画布按需加回轻量 MiniMap | `components/WorkflowCanvas.tsx`、`canvas/CanvasCore.tsx` | 磨砂玻璃观感 | 控件功能（缩放/适配）不动 |

## Phase 4 · 信息密度与异常状态处理

| 编号 | 任务 | 涉及文件 | 验收标准 | 回归风险 / 规避 |
|---|---|---|---|---|
| T4.1 | **长文本节点折叠**：文本节点/剧情正文默认收起为 3 行摘要，节点头带展开/折叠按钮（接 NodeShell 现有 collapsed 机制） | `scene/SceneTextWriter.tsx`、`scene/SceneObjectNode.tsx`（StoryEditor）、`components/nodes/StoryNode.tsx` | 默认 3 行摘要；点开全文；编辑仍可用 | ⚠️ 涉及默认行为变化：先做"可折叠"再加"默认收起"，分两步提交 |
| T4.2 | **报错 UI 封装**：新建全局 `ErrorBanner` 组件（警告图标 + 易懂文案 + 「查看详情」折叠原始报错）；替换 403/生硬红色报错点（图片生成 errMsg、各节点错误提示、LogPanel 错误行） | 新建 `components/ErrorBanner.tsx`；改 `scene/SceneImageEditor.tsx`、`components/LogPanel.tsx` 等 | 报错不再裸暴露 HTTP 码；详情可点开 | ⚠️ 改 LogPanel 先加组件后替换，保留日志数据 |
| T4.3 | 运行中状态统一：节点 running 态、按钮 loading 态用同一令牌 | 双 NodeShell、各生成按钮 | 明暗两套 loading 可辨 | 纯视觉 |

## Phase 5 · 节点内部表单（全面重做收尾）

| 编号 | 任务 | 涉及文件 | 验收标准 | 回归风险 / 规避 |
|---|---|---|---|---|
| T5.1 | **通用控件变体**：抽取 input/select/button/checkbox/textarea 变体（明暗两套），供全部表单引用 | 新建 `components/ui/controls.tsx` | 控件风格统一 | 新组件，旧控件逐步替换 |
| T5.2 | 工作流 14 节点表单接入新控件 | `components/nodes/*.tsx`（14 个节点 + GenerationModeField + PromptOptimize/Translate 等） | 表单观感统一、明暗可用 | 每节点替换后 tsc + 手动过一遍 |
| T5.3 | 场景节点表单接入新控件 | `scene/SceneObjectNode.tsx`、`SceneFieldPopover.tsx`、`SceneImageEditor.tsx`、`SceneTextWriter.tsx` | 同上 | 同上 |

## Phase 6 · 回归防护与上线

| 编号 | 任务 | 验收标准 |
|---|---|---|
| T6.1 | 每 Phase 结束：`tsc --noEmit` + vite build + 容器重建 + HTTP 200 | 构建零错误 |
| T6.2 | 每 Phase 按 T0.2 九项行为清单回归（拖拽/连线/选中/锁定/生成/结果/主题切换等） | 行为零回归 |
| T6.3 | 明暗双主题各过一遍（切换 3 次以上） | 两套观感均达标 |
| T6.4 | 每 Phase 独立 commit + 推分支；全部完成后合并 master | 每个 commit 可回滚 |

---

## 回归风险规避策略（重点）

1. **分支隔离**：`feature/canvas-uiux` 分支全程独立，master 不受影响；每 Phase 一个 commit，坏哪滚哪。
2. **样式不动逻辑铁律**：颜色换变量、质感换令牌；`className` 结构与 `onClick`/`onChange` 等行为代码零改动。凡涉及行为变化（T4.1 折叠默认态、T4.2 报错封装）一律"先加新组件/新态 → 验证 → 再切换默认"，拆两步提交。
3. **构建防线**：每个 Phase 结束即 tsc + 构建 + 容器上线验证，不积压到最后一口气改完。
4. **双主题矩阵**：任何改动都要在明/暗两种主题下验证，防止"修暗色坏明色"。
5. **交互回归清单**（T0.2）：节点拖拽、缩放、连线、选中、删除、锁定、生成中动画、结果展示、主题切换——9 项每 Phase 全测。
6. **可回滚点**：合并 master 前保留分支；上线后如发现问题，`git revert` 单 Phase commit 即可。

## 实施顺序建议

Phase 0 → Phase 1（令牌地基）→ Phase 2（节点连线质感）→ Phase 3（悬浮化）→ Phase 4（折叠+报错）→ Phase 5（表单）→ Phase 6（验收合并）

> Phase 1 是全部后续的地基，必须先落；Phase 2/3 可并行推进；Phase 4 涉及行为变化，放中间稳妥位置。
