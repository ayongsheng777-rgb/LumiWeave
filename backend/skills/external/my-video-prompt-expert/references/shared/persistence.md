# 持久化能力声明（运行环境适配）

本模块定义 prompt-master 在不同部署环境下对数据持久化的能力需求和降级策略。模板本身只声明接口和期望，不绑定具体实现方案。

---

## 1. 持久化场景清单

| 场景 | 数据类型 | 更新频率 | 当前依赖 |
|------|---------|---------|---------|
| 风格预设扩展 | 新增预设条目、用户自建指令 | 中频（用户主动添加） | `references/[image|video]/style-presets.md` |
| 用户偏好学习 | 常用风格、默认平台、画质偏好 | 低频（逐步积累） | 会话内临时记忆 / 未来KV存储 |
| 反馈归因统计 | 错误类型分布、修正成功率 | 高频（每次反馈时） | `references/shared/feedback-mapping.md` 静态映射 |
| 敏感词库更新 | 新增屏蔽词、调整审核强度 | 低频（运营维护） | `references/shared/safety-rules.md` |
| 教学案例积累 | A-D类缓存案例、E类综合条目 | 中频（持续积累） | 用户本地缓存 / 未来云端知识库 |
| 微调版本历史 | 同一会话内的版本迭代 | 高频（每次微调时） | 会话内临时记忆（context-memory.md） |

---

## 2. 双模式架构

### 动态模式（首选）

当运行环境支持以下能力时启用：

| 能力 | 实现方式 | 效果 |
|------|---------|------|
| **键值存储** | 平台 KV 接口 / 云端数据库 | 预设库实时同步、跨会话持久化偏好 |
| **知识库检索** | RAG 接口 / 向量数据库 | 教学案例智能匹配、E类自动提炼 |
| **统计分析** | 产品端分析接口 | 反馈归因自动化、错误分布可视化 |
| **配置热更新** | 远程配置推送 | 敏感词库无需重新部署即可更新 |

**动态模式下**，`references/` 目录下的文件作为**初始化默认值**和**离线兜底**，运行时数据优先从动态存储读取。

### 静态模式（兜底）

当动态能力不可用时自动降级：

| 场景 | 静态兜底方案 | 局限性 |
|------|-------------|--------|
| 预设库扩展 | 编辑 `references/*/style-presets.md` 文件 | 需手动维护，不支持运行时添加 |
| 用户偏好 | 存储在会话内临时记忆中（静态模式下无持久化文件） | 仅文件级持久化，无学习能力 |
| 反馈归因 | 使用 `feedback-mapping.md` 的静态映射表 | 无统计积累，无法发现新模式 |
| 敏感词更新 | 编辑 `safety-rules.md` 后重新上传 SKILL | 有延迟，需人工介入 |
| 教学案例 | 用户自行维护本地 YAML/Markdown 文件 | 无自动积累，完全靠手工 |
| 版本历史 | 仅限当前会话内存，会话结束即丢失 | 无法跨会话追溯 |

### 降级检测逻辑

```
启动时检测：
    ↓
动态存储可用？──Yes──→ 启用动态模式，references/ 作为默认值
    │
    No
    ↓
启用静态模式，全部依赖 references/ 本地文件
    ↓
输出警告（内部日志，不对用户展示）：
"[persistence] 运行在静态模式，部分功能受限"
```

---

## 3. 各模块持久化接口规范

### 3.1 风格预设（style-presets.md）

```yaml
# 接口声明（不实现，由运行环境决定如何存储）
interface StylePresetStore:
  read(preset_id: string) -> PresetData
  list(category?: string) -> PresetData[]
  create(data: PresetData) -> string  # 返回新ID
  update(preset_id: string, data: Partial[PresetData]) -> bool
  delete(preset_id: string) -> bool
  search(query: string) -> PresetData[]  # RAG语义搜索
  
# 静态模式实现：
#   → 直接读写 references/*/style-presets.md 中的YAML列表
# 动态模式实现：
#   → 调用平台 KV/RAG 接口
```

### 3.2 教学案例库（tutorial.md 引用的缓存）

```yaml
interface ExampleCache:
  read(example_id: string) -> ExampleData
  list_by_category(category: A|B|C|D|E) -> ExampleData[]
  create(data: ExampleData) -> string
  rate(example_id: string, feedback: useful|irrelevant|outdated) -> bool
  synthesize_E(category: string, min_sources: int=3) -> EExampleData | null
  cleanup(max_per_category: int=100) -> int  # 返回清理数量

# 静态模式实现：
#   → 用户维护本地 examples.yaml 文件
#   → E类合成需手动编写
# 动态模式实现：
#   → 自动从优质对话中提取案例
#   → E类自动合成（满足≥3源条件时）
```

### 3.3 上下文记忆（context-memory.md）

```yaml
interface SessionMemory:
  get_last_output() -> OutputRecord | null
  save_output(record: OutputRecord) -> void
  get_version_history() -> VersionRecord[]
  is_finetune_request(user_input: string) -> bool
  reset_session() -> void

# 静态模式实现：
#   → 会话内存中的临时变量（会话结束即丢失）
# 动态模式实现：
#   → 会话级 KV 存储，支持同用户跨会话恢复
```

---

## 4. 配置文件预留（静态模式可选创建）

若用户需要在静态模式下持久化个性化配置，可在 `references/shared/` 下创建：

### 用户配置文件（可选，用户自行创建）

```yaml
# 用户个性化配置（静态模式下的偏好持久化）
user_preferences:
  default_platform: "midjourney"     # 默认输出平台
  default_language: "auto"           # auto/zh/en
  default_quality: "high"            # low/medium/high
  auto_save_style: false             # 是否自动保存用户自定义风格
  
tutorial_config:
  local_cache_path: "user-local-cache/"  # 本地案例目录（用户自行创建，非SKILL内置）
  e_class_min_sources: 3              # E类最少源案例数
  max_cache_per_category: 100         # 单类缓存上限
```

> 此文件为可选创建项。不存在时不影响任何功能，所有值使用内置默认值。

---

## 5. 安全与隐私声明

| 数据类型 | 是否含用户个人信息 | 静态模式处理 | 动态模式要求 |
|---------|------------------|------------|------------|
| 风格预设 | 通常不含 | 明文存本地文件 | 需加密存储 |
| 用户偏好 | 可能含偏好指纹 | 明文存用户配置文件 | 符合GDPR/个人信息保护法 |
| 反馈归因 | 不含 | 静态映射表 | 匿名聚合统计 |
| 教学案例 | 可能含用户创作 | 用户本地管理 | 用户独占空间 |
| 版本历史 | 可能含创作过程 | 会话结束清除 | 用户可控保留期 |

---

*来源：思想碰撞沉淀 — 动态/静态双模式持久化架构 + 接口规范 + 降级方案*
