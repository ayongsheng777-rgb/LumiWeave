# LumiWeave V2 UI/UX 重构与现代化升级指南

## 一、 核心视觉理念：专业、沉浸、极简

LumiWeave 作为 AI 创客工作台，其 UI 设计应舍弃传统的“信息堆砌式网页”风格，转向**“沉浸式画布 + 悬浮控制面板”**的现代生产力工具布局（参考 Figma、Notion、RunningHub）。

### 1. 技术栈升级要求
为实现高质感 UI 且保持开发效率，前端需引入以下基础库：
*   **CSS 框架:** `Tailwind CSS` (原子化 CSS，精准控制边距与阴影)
*   **UI 组件库:** `shadcn/ui` 或 `Radix UI` (无头组件库，彻底告别原生 HTML 控件的廉价感)
*   **图标库:** `lucide-react` (提供统一、线条一致的现代化 SVG 图标)
*   **画布引擎:** `React Flow` (继续保留，但全面启用 Custom Nodes 自定义节点)

### 2. 色彩与主题 (Color Palette)
*   **深色模式 (Dark Mode) 优先：** 建议将画布底色设为 `#121212`，点阵颜色设为 `#333333`。如果使用浅色模式，底色应为非常淡的冷灰色 `#F8F9FA`。
*   **品牌强调色：** 选择一种克制的亮色作为主视觉（如目前的紫/蓝渐变），仅用于激活状态、关键按钮（如“发送/运行”）和节点的输入输出连线点。

---

## 二、 全局布局重构设计

当前的布局空间利用率不足，需进行以下空间重分配：

### 1. 顶部导航 (Top Header)
*   **精简压缩：** 取消顶部的巨大留白，高度压缩至 `48px` - `56px`。
*   **功能收敛：** 左侧仅保留 Logo 和文件状态（如“自动保存”）；中间放一个迷你的项目名称输入框；右侧放导出、设置、退出按钮。

### 2. 左侧工具栏 (Floating Toolbar)
*   **形态改变：** 废弃顶部原有的 `+文本`, `+提示词` 标签。改为在画布左侧垂直居中悬浮的极简工具条（类似白板软件的笔触选择器）。
*   **交互：** 只展示 Icon，鼠标悬停时弹出 Tooltip 提示节点类型，拖拽 Icon 直接落入画布生成节点。

### 3. 右侧智能体控制台 (Right Drawer)
*   **形态改变：** 废弃生硬的白底侧边栏，改为右侧可侧滑收起的侧控面板 (Sidebar Drawer)，加微弱的左侧阴影与画布区分。
*   **卡片化重构：** 废弃原生 Radio 单选框，采用状态卡片设计。

---

## 三、 核心代码重构与落地

### 1. 现代化 Canvas 节点 (Custom Node) 重构
这是提升工作台专业感的核心。使用 Tailwind CSS 为 React Flow 编写精密的自定义节点。

**文件路径:** `frontend/src/components/nodes/PromptNode.tsx`

```tsx
import React from 'react';
import { Handle, Position } from 'reactflow';
import { MessageSquareText, Settings2 } from 'lucide-react';

export const PromptNode = ({ data, selected }: { data: any, selected: boolean }) => {
  return (
    <div 
      className={`
        w-80 bg-white dark:bg-gray-900 rounded-xl shadow-md border transition-all duration-200
        ${selected ? 'border-indigo-500 shadow-indigo-100 dark:shadow-none' : 'border-gray-200 dark:border-gray-700 hover:shadow-lg'}
      `}
    >
      {/* 节点 Header：极简、带状态指示 */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 rounded-t-xl">
        <div className="flex items-center gap-2">
          <MessageSquareText className="w-[18px] h-[18px] text-indigo-500"/>
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">系统提示词</span>
        </div>
        <button className="text-gray-400 hover:text-gray-600 transition-colors">
          <Settings2 className="w-4 h-4"/>
        </button>
      </div>

      {/* 节点 Body：去掉臃肿的边框，融入背景 */}
      <div className="p-4">
        <textarea
          className="w-full h-28 p-3 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-transparent rounded-lg resize-none focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 transition-all"
          placeholder="输入系统预设指令..."
          defaultValue={data.text}
          onChange={(e) => data.onChange?.(e.target.value)}
        />
      </div>

      {/* 节点 Handles：精确设计的连接点 */}
      <Handle className="w-3 h-3 bg-white border-2 border-indigo-500 rounded-full" position="{Position.Left}" type="target"/>
      <Handle className="w-3 h-3 bg-indigo-500 border-2 border-white rounded-full" position="{Position.Right}" type="source"/>
    </div>
  );
};

```

### 2. 智能体选择卡片重构

告别原生表单控件，提升 AI 助手的科技感。

**文件路径:** `frontend/src/components/panels/AgentSelector.tsx`

```tsx
import React, { useState } from 'react';
import { Bot, Sparkles, Zap } from 'lucide-react';

const agents = [
  { id: 'router', name: '自动路由', icon: Sparkles, desc: '智能分析并分发任务' },
  { id: 'default', name: '默认 Agent', icon: Bot, desc: '基础对话助手' },
  { id: 'claude', name: 'Claude', icon: Zap, desc: '复杂逻辑与代码编写' },
];

export const AgentSelector = () => {
  const [selected, setSelected] = useState('router');

  return (
    <div className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-medium text-gray-500 mb-2">选择智能体引擎</h3>
      {agents.map((agent) => {
        const Icon = agent.icon;
        const isSelected = selected === agent.id;
        
        return (
          <div
            key={agent.id}
            onClick={() => setSelected(agent.id)}
            className={`
              flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border
              ${isSelected 
                ? 'bg-indigo-50 border-indigo-200 shadow-sm' 
                : 'bg-white border-gray-100 hover:border-gray-300'}
            `}
          >
            <div className={`p-2 rounded-md ${isSelected ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-50 text-gray-500'}`}>
              <Icon className="w-5 h-5"/>
            </div>
            <div className="flex flex-col">
              <span className={`text-sm font-medium ${isSelected ? 'text-indigo-900' : 'text-gray-700'}`}>
                {agent.name}
              </span>
              <span className="text-xs text-gray-400">{agent.desc}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

```

### 3. 画布注册与挂载

确保 React Flow 使用重构后的节点并关闭默认边框。

**文件路径:** `frontend/src/components/WorkflowCanvas.tsx`

```tsx
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import { PromptNode } from './nodes/PromptNode';

// 注册自定义节点
const nodeTypes = {
  promptNode: PromptNode,
};

export const WorkflowCanvas = () => {
  return (
    <div className="w-full h-full bg-[#F8F9FA]">
      <ReactFlow */} ... edges fitView nodeTypes="{nodeTypes}" nodes onEdgesChange="{/*" onNodesChange="{/*" state your>
        {/* 点阵背景，调低透明度让视觉更干净 */}
        <Background color="#ccc" gap="{16}" size="{1}"/>
        {/* 隐藏边框，使用更轻量的控制器 */}
        <Controls className="border-none shadow-lg rounded-lg" showInteractive="{false}"/>
      </ReactFlow>
    </div>
  );
};

```

---
## 四、 实施路径规划（完整展开版）

为了确保重构过程不影响现有核心逻辑的运转，建议采用“先骨架、后组件、再状态、终反馈”的五步走策略。预计耗时 5-7 个工作日（依个人开发节奏而定）。

### Phase 1: 基础设施与全局骨架搭设 (Day 1)
**目标**：剥离旧样式，替换底层样式库，搭建出现代化工作台的“空壳排版”。
* **引入基础依赖**：安装 `tailwindcss`, `lucide-react`，并可选配置 `shadcn/ui` 提取最基础的 Button、Card 组件。
* **主容器重排 (App.tsx)**：废弃传统的标准网页流布局，全面改为绝对定位（Absolute/Fixed）或全屏 Flex 布局。
  * **底层**：全屏占满的 Canvas 画布区。
  * **顶层**：高度 `48px` 的极简透明顶部导航栏。
  * **左侧**：悬浮工具条（Floating Toolbar）。
* **抽屉面板开发**：重构右侧面板，实现面板的弹出/收起平滑动画，彻底告别原本生硬的白底侧边栏。

### Phase 2: React Flow 自定义节点与连线重制 (Day 2-3)
**目标**：消除画布的廉价感，实现高质感、高信息密度的节点渲染。
* **Node 样式重构**：废弃 React Flow 默认节点。编写自定义的 `PromptNode`、`LLMNode`、`RenderNode` 等组件。加入细致的卡片阴影 (`shadow-sm`)、圆角 (`rounded-xl`) 和类型图标。
* **Handles (连接点) 精确控制**：调整输入/输出点的样式，悬浮时增加动效。连线（Edges）样式改为平滑的贝塞尔曲线 (`smoothstep`)，并根据数据流类型设定不同的连线颜色。
* **画布底色与原生控件**：将 `Background` 的底色改为冷灰或暗黑模式的点阵。重写缩放、全屏等 `Controls` 控件，使其以半透明悬浮面板的形式固定在左下角。

### Phase 3: Zustand 状态接管与数据流打通 (Day 4)
**目标**：前端 UI 变化必须严格映射为底层 JSON，为发送给后端 DAG 引擎做好准备。
* **状态中心接管**：创建 `useWorkflowStore`，完全接管 React Flow 的 `nodes` 和 `edges` 状态。
* **节点表单双向绑定**：确保节点内的 `textarea` 或下拉框内容修改时，能实时同步到 Store 中的节点 `data` 对象里。
* **JSON 组装与拦截**：编写导出器，在点击“运行”时，提取 Store 数据并清洗为后端需要的纯净 `WorkflowDAG` JSON 格式。

### Phase 4: 智能面板与对话流重构 (Day 5)
**目标**：提升 AI 助手控制台的交互沉浸感与现代感。
* **引擎选择器卡片化**：用带有 Icon 和简短描述的“流式卡片”替换掉现有的原生单选框（Radio Button），选中时增加边框高亮。
* **Chat 气泡布局重构**：
  * **用户消息**：气泡靠右，主色调背景（如 Indigo-500），白字。
  * **AI 消息**：气泡靠左，浅灰背景，黑字，并引入 `react-markdown` 支持格式化渲染。
* **输入区优化**：底部聊天输入框支持多行自动撑开（Auto-resize），增加快速发送逻辑（Enter 发送，Shift+Enter 换行）。

### Phase 5: 异构算力状态回显与细节打磨 (Day 6-7)
**目标**：针对后端的“本地 GTX 1080Ti + 云端 API”双引擎调度，在前端做完善的运行状态反馈。
* **渲染状态指示器 (Status Badges)**：在画布节点右上角增加状态标签，精准反馈后端推过来的 WebSocket 状态（如：`本地排队中`、`云端算力生成中`、`渲染完成`），并辅以呼吸灯动效。
* **媒体资产预览 (Lightbox)**：针对返回的图片或视频结果，开发一个点击可全屏查看、右键可保存的灯箱预览层。
* **空状态与水印引流**：当画布没有任何节点时，居中显示友好的半透明操作提示：“从左侧拖拽能力节点，或向 AI 助手输入指令以开始创作”。



```

```