# =============================================================================
# Sub2API Extension Multi-Stage Dockerfile
# =============================================================================
# 附属内容承载系统。零侵入 sub2api，独立部署。
#
# Stage 1: 构建前端 (React + Vite + pnpm)
# Stage 2: 构建后端 (Go + Gin)
# Stage 3: 最终运行时镜像（后端内嵌前端 dist，单进程同源托管）
#
# 镜像风格参考 sub2api/Dockerfile（多阶段 + 缓存挂载 + 非根用户）。
# Release 二进制通过 embed 标签内嵌前端；SUB2API_EXTENSION_FRONTEND_DIST
# 仅作为源码/开发构建的目录托管回退，由 router.go 的 registerFrontendStatic
# 托管 SPA（同源，避免 CORS）。
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
# Keep the production image honest: the console relies on Tailwind utilities
# (fixed sidebar, flex layout, responsive visibility). If PostCSS/Tailwind is
# accidentally omitted from the build context, fail the image build instead of
# shipping an unstyled console that looks like its menu is not clickable.
RUN pnpm run build && \
    grep -RqsF '.fixed{position:fixed' dist/assets/*.css && \
    grep -RqsF '.flex{display:flex' dist/assets/*.css
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
# 将生产前端放入 Go 包目录，由 release 构建以 embed 标签编译进单一二进制。
COPY --from=frontend-builder /app/frontend/dist ./internal/web/dist
# 客户端接入文档截图与客户端图标是统一资源目录(assets.dir)的种子资源：
# embed 构建时随二进制内嵌，运行时首启复制进持久卷，不依赖前端重新构建。
COPY backend/data/assets/client-docs ./internal/web/seed/client-docs
COPY backend/data/assets/client-icons ./internal/web/seed/client-icons

# 构建二进制（纯 Go，交叉编译）
RUN --mount=type=cache,id=aux-gomod,target=/go/pkg/mod \
    --mount=type=cache,id=aux-gobuild,target=/root/.cache/go-build \
    DATE_VALUE="${DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" && \
    CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build \
    -tags embed \
    -ldflags="-s -w -X main.Version=${VERSION} -X main.Commit=${COMMIT} -X main.Date=${DATE_VALUE}" \
    -trimpath \
    -o /app/aux-server \
    ./cmd/server

# -----------------------------------------------------------------------------
# Stage 3: Final Runtime Image
# -----------------------------------------------------------------------------
FROM ${ALPINE_IMAGE} AS app
ARG VERSION=0.1.0-dev
ARG COMMIT=docker
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.revision="${COMMIT}"
LABEL org.opencontainers.image.source="https://github.com/FluxCode666/sub2api-extension"

LABEL maintainer="sub2api-extension"
LABEL description="Sub2API Extension - sub2api auxiliary content carrier"

# 运行时依赖：ca-certificates + tzdata + libpq（后端用 lib/pq 连 PostgreSQL）
# su-exec 仅用于入口脚本修正挂载目录权限后降权运行服务。
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    libpq \
    su-exec \
    && rm -rf /var/cache/apk/*

# 创建非根用户
RUN addgroup -g 1000 aux && \
    adduser -u 1000 -G aux -s /bin/sh -D aux

WORKDIR /app

# 复制后端二进制
COPY --from=backend-builder --chown=aux:aux /app/aux-server /app/aux-server

# 复制前端构建产物（后端同源托管）
COPY --from=frontend-builder --chown=aux:aux /app/frontend/dist /app/frontend/dist

COPY --chmod=0755 deploy/docker-entrypoint.sh /app/docker-entrypoint.sh

# 创建图片数据目录（数据库只存资源相对路径）。/app 目录也必须由运行用户
# 可写，因为原地更新会在此目录内创建临时文件并原子替换当前二进制。
RUN mkdir -p /app/data/assets/photos && chown -R aux:aux /app

# 暴露端口（默认 8787，与 config 默认一致）
EXPOSE 8787

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -q -T 5 -O /dev/null http://localhost:${SERVER_PORT:-8787}/health || exit 1

# 运行时环境变量：后端静态托管前端 dist
ENV SUB2API_EXTENSION_FRONTEND_DIST=/app/frontend/dist

ENTRYPOINT ["/app/docker-entrypoint.sh"]
