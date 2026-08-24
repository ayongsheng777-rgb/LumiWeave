FROM node:22.6.0-alpine AS builder

WORKDIR /app

# 构建代理（宿主机代理，由 compose build args 传入；国内镜像源走 NO_PROXY 直连）
ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    NO_PROXY=registry.npmmirror.com,localhost,127.0.0.1

# 国内镜像源（package-lock.json 的 resolved 已指向 npmmirror，此处保持一致）
RUN npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund

COPY . .
RUN npm run build

FROM nginx:1.27.1-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
