#!/usr/bin/env bash
# =============================================================================
# Aux Content System - 手动构建并推送镜像到 GHCR
# =============================================================================
# 使用 docker buildx 构建多架构单镜像（前端 + 后端合一）并推送到 GitHub Container Registry。
#
# 用法:
#   ./deploy/build-and-push.sh 1.0.0            # 构建并推送
#   ./deploy/build-and-push.sh 1.0.0 --no-push  # 仅构建，不推送
#   ./deploy/build-and-push.sh 1.0.0 --local    # 仅构建本机架构，不推送（开发调试）
#
# 前提条件:
#   1. 已通过 `docker login ghcr.io` 登录 GHCR（需 write:packages 权限的 PAT）
#   2. 已安装并启用 Docker Buildx
#
# 环境变量:
#   GHCR_OWNER    - GHCR 仓库所有者 (默认: 从 git remote 自动检测)
#   PLATFORMS     - 目标平台 (默认: linux/amd64,linux/arm64)
#   GOPROXY       - Go 模块代理 (默认: https://goproxy.cn,direct)
#   GOSUMDB       - Go checksum 数据库 (默认: sum.golang.google.cn)
#   NPM_CONFIG_REGISTRY - npm 镜像 (默认: 空，使用官方源)
# =============================================================================

set -euo pipefail

# ---- 颜色输出 ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---- 路径 ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---- 参数解析 ----
VERSION=""
NO_PUSH=false
LOCAL_ONLY=false

for arg in "$@"; do
    case "$arg" in
        --no-push)  NO_PUSH=true ;;
        --local)    LOCAL_ONLY=true; NO_PUSH=true ;;
        --help|-h)
            head -25 "$0" | tail -19
            exit 0
            ;;
        *)
            if [[ -z "$VERSION" && "$arg" =~ ^[0-9] ]]; then
                VERSION="$arg"
            else
                error "未知参数: $arg"
                exit 1
            fi
            ;;
    esac
done

# ---- 版本号（必填） ----
if [[ -z "$VERSION" ]]; then
    error "请指定版本号，例如: $0 1.0.0"
    exit 1
fi

# ---- GHCR 配置 ----
if [[ -z "${GHCR_OWNER:-}" ]]; then
    GHCR_OWNER=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null \
        | sed -E 's#.*[:/]([^/]+)/[^/]+(.git)?$#\1#' \
        | tr '[:upper:]' '[:lower:]')
    if [[ -z "$GHCR_OWNER" ]]; then
        error "无法从 git remote 检测仓库所有者，请设置 GHCR_OWNER 环境变量"
        exit 1
    fi
fi

IMAGE="ghcr.io/${GHCR_OWNER}/aux-system"
COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo docker)"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
GOSUMDB="${GOSUMDB:-sum.golang.google.cn}"
NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-}"

info "镜像:       ${IMAGE}:${VERSION}"
info "Commit:     ${COMMIT}"
info "构建时间:   ${BUILD_DATE}"
info "目标平台:   ${PLATFORMS}"

# ---- 切换到仓库根目录 ----
cd "$REPO_ROOT"

# ---- 构建参数 ----
BUILD_ARGS=(
    --file "Dockerfile"
    --build-arg "VERSION=${VERSION}"
    --build-arg "COMMIT=${COMMIT}"
    --build-arg "DATE=${BUILD_DATE}"
    --build-arg "GOPROXY=${GOPROXY}"
    --build-arg "GOSUMDB=${GOSUMDB}"
)

if [[ -n "$NPM_CONFIG_REGISTRY" ]]; then
    BUILD_ARGS+=(--build-arg "NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY}")
fi

# ---- 构建模式 ----
if [[ "$LOCAL_ONLY" == "true" ]]; then
    # 仅本机架构，加载到本地 Docker
    info "本地构建（仅本机架构，不推送）..."
    docker buildx build \
        --load \
        --tag "${IMAGE}:${VERSION}" \
        --tag "${IMAGE}:latest" \
        "${BUILD_ARGS[@]}" \
        .
    ok "本地构建完成: ${IMAGE}:${VERSION} (已加载到本地 Docker)"
    exit 0
fi

if [[ "$NO_PUSH" == "true" ]]; then
    # 多架构构建，不推送
    info "多架构构建（不推送）..."
    docker buildx build \
        --platform "${PLATFORMS}" \
        --tag "${IMAGE}:${VERSION}" \
        --tag "${IMAGE}:latest" \
        "${BUILD_ARGS[@]}" \
        .
    ok "多架构构建完成（未推送）"
    exit 0
fi

# ---- 完整构建并推送 ----
info "多架构构建并推送到 GHCR..."

# 验证已登录 GHCR
if ! grep -q "ghcr.io" ~/.docker/config.json 2>/dev/null; then
    warn "未检测到 GHCR 登录凭证，请先执行: docker login ghcr.io -u ${GHCR_OWNER}"
fi

docker buildx build \
    --platform "${PLATFORMS}" \
    --push \
    --tag "${IMAGE}:${VERSION}" \
    --tag "${IMAGE}:latest" \
    "${BUILD_ARGS[@]}" \
    .

ok "构建并推送完成！"
echo ""
echo "  镜像: ${IMAGE}:${VERSION}"
echo "  镜像: ${IMAGE}:latest"
echo ""
echo "  在部署服务器拉取:"
echo "    docker pull ${IMAGE}:${VERSION}"
echo ""
echo "  或在 docker-compose.prod.yml 的 .env.prod 中设置:"
echo "    AUX_IMAGE=${IMAGE}"
echo "    AUX_IMAGE_TAG=${VERSION}"
