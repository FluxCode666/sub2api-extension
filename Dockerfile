# syntax=docker/dockerfile:1.7
# =============================================================================
# Aux Content System Multi-Stage Dockerfile
# =============================================================================
# 附属内容承载系统。零侵入 sub2api，独立部署。
#
# Stage 1: 构建前端 (React + Vite + pnpm)
# Stage 2: 构建后端 (Go + Gin)
# Stage 3: 最终运行时镜像（后端内嵌前端 dist，单进程同源托管）
#
# 镜像风格参考 sub2api/Dockerfile（多阶段 + 缓存挂载 + 非根用户）。
# 后端在运行时通过 AUX_FRONTEND_DIST 环境变量指向 /app/frontend/dist，
# 由 router.go 的 registerFrontendStatic 托管 SPA（同源，避免 CORS）。
# =============================================================================

ARG NODE_IMAGE=node:24-alpine
ARG GOLANG_IMAGE=golang:1.26.5-alpine
ARG ALPINE_IMAGE=alpine:3.21
ARG GOPROXY=https://goproxy.cn,direct
ARG GOSUMDB=sum.golang.google.cn
ARG NPM_CONFIG_REGISTRY=

# -----------------------------------------------------------------------------
# Stage 1: Frontend Builder
# -----------------------------------------------------------------------------
# --platform=$BUILDPLATFORM: 前端产物为 JS（架构无关），在宿主架构上构建以避免 QEMU 模拟。
FROM --platform=${BUILDPLATFORM} ${NODE_IMAGE} AS frontend-builder
ARG NPM_CONFIG_REGISTRY

WORKDIR /app/frontend

# 安装 pnpm（pinned v9，与 sub2api 一致，构建可复现）
RUN corepack enable && corepack prepare pnpm@9 --activate

# 先装依赖（利用层缓存）
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN --mount=type=cache,id=aux-pnpm-store,target=/root/.local/share/pnpm/store \
    if [ -n "${NPM_CONFIG_REGISTRY}" ]; then pnpm config set registry "${NPM_CONFIG_REGISTRY}"; fi && \
    pnpm install --frozen-lockfile --prefer-offline

# 复制前端源码并构建
COPY frontend/ ./
RUN pnpm run build
# 产物在 /app/frontend/dist

# -----------------------------------------------------------------------------
# Stage 2: Backend Builder
# -----------------------------------------------------------------------------
# --platform=$BUILDPLATFORM: Go 工具链在宿主架构运行，交叉编译到目标架构。
# CGO_ENABLED=0 纯 Go 编译，无需 QEMU 模拟 go mod download。
FROM --platform=${BUILDPLATFORM} ${GOLANG_IMAGE} AS backend-builder

ARG VERSION=0.1.0-dev
ARG COMMIT=docker
ARG DATE
ARG GOPROXY
ARG GOSUMDB
ARG TARGETOS
ARG TARGETARCH

ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=${GOSUMDB}

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /app/backend

# 先复制 go mod 文件（利用层缓存）
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,id=aux-gomod,target=/go/pkg/mod \
    go mod download

# 复制后端源码
COPY backend/ ./

# 构建二进制（纯 Go，交叉编译）
RUN --mount=type=cache,id=aux-gomod,target=/go/pkg/mod \
    --mount=type=cache,id=aux-gobuild,target=/root/.cache/go-build \
    DATE_VALUE="${DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" && \
    CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build \
    -ldflags="-s -w -X main.Version=${VERSION} -X main.Commit=${COMMIT} -X main.Date=${DATE_VALUE}" \
    -trimpath \
    -o /app/aux-server \
    ./cmd/server

# -----------------------------------------------------------------------------
# Stage 3: Final Runtime Image
# -----------------------------------------------------------------------------
FROM ${ALPINE_IMAGE}

LABEL maintainer="aux-system"
LABEL description="Aux Content System - sub2api auxiliary content carrier"

# 运行时依赖：ca-certificates + tzdata + libpq（后端用 lib/pq 连 PostgreSQL）
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    libpq \
    && rm -rf /var/cache/apk/*

# 创建非根用户
RUN addgroup -g 1000 aux && \
    adduser -u 1000 -G aux -s /bin/sh -D aux

WORKDIR /app

# 复制后端二进制
COPY --from=backend-builder --chown=aux:aux /app/aux-server /app/aux-server

# 复制前端构建产物（后端同源托管）
COPY --from=frontend-builder --chown=aux:aux /app/frontend/dist /app/frontend/dist

# 创建数据目录
RUN mkdir -p /app/data && chown aux:aux /app/data

# 暴露端口（默认 8787，与 config 默认一致）
EXPOSE 8787

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -q -T 5 -O /dev/null http://localhost:${SERVER_PORT:-8787}/health || exit 1

# 切换非根用户
USER aux

# 运行时环境变量：后端静态托管前端 dist
ENV AUX_FRONTEND_DIST=/app/frontend/dist

ENTRYPOINT ["/app/aux-server"]
