# 部署说明

## 从零启动（rule #18）
```bash
cd 绵绣LumiWeave
cp .env.example .env        # 按需填 AI_API_KEY / OTP_SECRET 等
docker compose up -d --build
```
- postgres: `localhost:5435`（内网 5432）
- redis: `localhost:6385`（内网 6379）
- backend: `localhost:8900`（内网 8000）
- frontend: `localhost:3010`

## 改代码后的部署（rule：改源码仅重启，改依赖/环境才 --build）
```bash
# 仅改 app/*.py / skills/* -> 重建 backend 镜像（无 bind mount）
docker compose build backend && docker compose up -d backend

# 新增表 / 幂等迁移到已存在的卷
docker compose exec -T postgres psql -U lumiweave -d lumiweave -f /docker-entrypoint-initdb.d/01_init.sql
```

## 关键环境变量（.env）
| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | postgresql://lumiweave:lumiweave2026@postgres:5432/lumiweave | 库连接 |
| `OTP_SECRET` | 空（自动生成） | 固定 TOTP 密钥 |
| `SESSION_SECRET` | 空（自动生成） | 会话签名密钥 |
| `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL` | deepseek | 默认模型 |
| `AI_MODELS_JSON` | `[]` | 多模型配置 |
| `EMBEDDING_BASE_URL`/`EMBEDDING_API_KEY` | 空 | 语义向量（空则本地哈希降级） |
| `SKILLS_DIR` | /app/skills | 技能目录 |

## Dockerfile 要点
- 多阶段：builder 装依赖（gcc/libpq-dev），运行层只装 libpq5。
- `COPY app ./app` + `COPY skills ./skills` + `COPY init_db.sql ./init_db.sql`。
- 依赖锁版本于 `requirements.txt`（禁 latest）。

## 健康检查
- backend：`GET /api/health`（urllib 探测）。
- postgres：`pg_isready`；redis：`redis-cli ping`。
