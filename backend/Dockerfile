FROM python:3.12.5-slim-bookworm AS builder

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai

RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.12.5-slim-bookworm

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/root/.local/bin:$PATH \
    DATA_DIR=/app/data \
    DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai

RUN apt-get update && apt-get install -y --no-install-recommends libpq5 ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data

COPY --from=builder /root/.local /root/.local
COPY app ./app
COPY skills ./skills
COPY init_db.sql ./init_db.sql

EXPOSE 8000

USER root
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
