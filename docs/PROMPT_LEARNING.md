# Prompt Learning / RAG 架构（Phase 7）

## 目标（spec #71）
```
Source → Fetcher → Parser → Prompt Extractor → Embedding → Prompt DB → Retriever → 动态注入
```

## 组件

### Source / Fetcher（`app/prompt_learning/source.py`）
- `fetch_text(uri)`：URL（httpx）或本地文件
- `fetch_github(repo)`：拉取 `owner/name` 的 README（main/master）
- 先实现 Markdown / GitHub / Manual，Feishu Wiki 后续接入（避免第三方授权阻塞）

### Parser / Extractor（`extractor.py`）
`extract_prompt_blocks(text)` 按 Markdown 标题切分为知识块 `{title, content}`。

### Embedding（`embedder.py`）
- 配置了 `EMBEDDING_BASE_URL + EMBEDDING_API_KEY` → 走 OpenAI 兼容 `/embeddings`（语义向量）
- 否则降级为**本地确定性哈希向量**（256 维，离线可复现，零依赖）——保证 docker 从零启动（rule #18）

### Store（`store.py`）
`prompt_knowledge(id, source, title, content, embedding float8[], created_at)`。**不用 pgvector 扩展**，向量存 `float8[]`，余弦相似度在 Python 计算。

### Retriever（`retriever.py`）
`retrieve(query, k)` → 计算余弦相似度 → 返回 top-k。

### 动态注入（spec #71，非朴素 appendSystemContext）
Agent 请求带 `learn_prompt: true` 时，`/api/agents/chat` 检索知识库并把命中块注入 system prompt，事件记 `prompt_learned`。

## 接口
- `POST /api/prompt-kb/sources` — `{kind, uri}` 添加并同步
- `POST /api/prompt-kb/add` — 手动添加
- `GET /api/prompt-kb/list` / `GET /api/prompt-kb/search?q=&k=`
- `POST /api/prompt-kb/sync` — 全量重同步

## 验证证据
- `kb_add` 返回 200 并生成 `pk_*`，`kb_list` 返回 embedding 向量。
- `kb_search` 返回命中结果。
- Agent 带 `learn_prompt` 时事件 `prompt_learned: {"hits": 3}` 正确落库。
