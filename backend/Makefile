# =============================================================================
# Sub2API Extension - Backend Makefile
# =============================================================================
# 常用开发与测试入口。CI 流水线（.github/workflows/ci.yml）直接调用这些目标。
#
# 版本号来源：./cmd/server/VERSION（CI 部署时由 GitHub Actions 注入 build-arg 覆盖）。
#
# 开发环境启动：
#   make dev        — 以 debug 模式启动后端，监听 8004（与前端 vite 代理一致）
#   make migrate    — 一次性迁移本地 sub2api 数据库中的扩展表，需 PG 已可达
#
# 完整 Docker 开发部署请在仓库根目录执行 make dev-up。
# =============================================================================

.PHONY: build test test-unit test-integration vet fmt tidy dev migrate check-dev-database check-dev-sub2api-database check-dev-sub2api-public-url

BACKEND_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
PROJECT_ROOT := $(abspath $(BACKEND_DIR)/..)
DEV_ENV_FILE ?= $(PROJECT_ROOT)/deploy/.env.dev

# 复用 Docker 开发部署的本地环境文件。命令行传入的 DEV_* 变量仍具有最高优先级。
# 宿主机直接运行 go run 时，DATABASE_* 和 SUB2API_DATABASE_* 都连接已经运行的
# sub2api PostgreSQL；容器内地址（postgres、aux-postgres）不会直接用于宿主机执行。
-include $(DEV_ENV_FILE)

VERSION ?= $(shell tr -d '\r\n' < ./cmd/server/VERSION 2>/dev/null || echo 0.1.0-dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
DATE    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS ?= -s -w -X main.Version=$(VERSION) -X main.Commit=$(COMMIT) -X main.Date=$(DATE)

# ---- 开发环境变量 ----
# 后端开发监听 8004（与 frontend/vite.config.ts 的 proxy target 一致）。
# DATABASE_* 是扩展 Ent 表的连接。本地 go run 与 sub2api 共用 PostgreSQL，
# 使用 sub2api Compose 暴露的宿主机端口和 POSTGRES_* 凭据。命令行传入
# DEV_* 变量仍可覆盖这些默认值；Docker Compose 的 aux-postgres 配置不受影响。
DEV_SERVER_PORT ?= 8004
DEV_DATABASE_HOST ?= $(or $(POSTGRES_HOST),127.0.0.1)
DEV_DATABASE_PORT ?= $(or $(POSTGRES_PORT),15432)
DEV_DATABASE_USER ?= $(or $(POSTGRES_USER),sub2api)
DEV_DATABASE_PASSWORD ?= $(or $(POSTGRES_PASSWORD),$(SUB2API_DATABASE_PASSWORD),123456)
DEV_DATABASE_DBNAME ?= $(or $(POSTGRES_DB),sub2api)
DEV_DATABASE_SSLMODE ?= disable

# sub2api 对接。开发环境默认连接宿主机 8003 端口，可通过
# SUB2API_BASE_URL 或 DEV_SUB2API_BASE_URL 覆盖。
# deploy/.env.dev 中的 SUB2API_BASE_URL 是容器地址 http://sub2api:8080，
# 宿主机 go run 必须使用宿主机映射端口，因此这里不直接复用该值。
DEV_SUB2API_BASE_URL ?= http://127.0.0.1:8003

# 首字延迟看板直接读取 Sub2API PostgreSQL。宿主机默认通过 Sub2API Compose
# 暴露的 127.0.0.1:15432 连接，不调用 Sub2API HTTP 数据接口。
DEV_SUB2API_DATABASE_HOST ?= $(DEV_DATABASE_HOST)
DEV_SUB2API_DATABASE_PORT ?= $(DEV_DATABASE_PORT)
DEV_SUB2API_DATABASE_USER ?= $(DEV_DATABASE_USER)
DEV_SUB2API_DATABASE_PASSWORD ?= $(DEV_DATABASE_PASSWORD)
DEV_SUB2API_DATABASE_DBNAME ?= $(DEV_DATABASE_DBNAME)
DEV_SUB2API_DATABASE_SSLMODE ?= $(or $(SUB2API_DATABASE_SSLMODE),disable)
DEV_SUB2API_EXTENSION_PUBLIC_URL ?= http://localhost:3100
DEV_JWT_SECRET ?= $(or $(SUB2API_EXTENSION_JWT_SECRET),dev-secret-not-for-production)
DEV_ASSET_DIR ?= data/assets

check-dev-database: export DATABASE_PASSWORD := $(DEV_DATABASE_PASSWORD)
check-dev-database:
	@test -n "$${DATABASE_PASSWORD:-}" || { \
		echo "DEV_DATABASE_PASSWORD 未设置（本地 sub2api PostgreSQL）" >&2; \
		exit 1; \
	}

check-dev-sub2api-database: export SUB2API_DATABASE_PASSWORD := $(DEV_SUB2API_DATABASE_PASSWORD)
check-dev-sub2api-database:
	@test -n "$${SUB2API_DATABASE_PASSWORD:-}" || { \
		echo "DEV_SUB2API_DATABASE_PASSWORD 未设置（本地 sub2api PostgreSQL）" >&2; \
		exit 1; \
	}

check-dev-sub2api-public-url: export SUB2API_EXTENSION_PUBLIC_URL := $(DEV_SUB2API_EXTENSION_PUBLIC_URL)
check-dev-sub2api-public-url:
	@test -n "$${SUB2API_EXTENSION_PUBLIC_URL:-}" || { \
		echo "DEV_SUB2API_EXTENSION_PUBLIC_URL 未设置（页面上架菜单需要浏览器可访问地址）" >&2; \
		exit 1; \
	}

# 使用 target-specific export，避免把密码展开到终端命令行中。
dev migrate: export SERVER_PORT := $(DEV_SERVER_PORT)
dev migrate: export DATABASE_HOST := $(DEV_DATABASE_HOST)
dev migrate: export DATABASE_PORT := $(DEV_DATABASE_PORT)
dev migrate: export DATABASE_USER := $(DEV_DATABASE_USER)
dev migrate: export DATABASE_PASSWORD := $(DEV_DATABASE_PASSWORD)
dev migrate: export DATABASE_DBNAME := $(DEV_DATABASE_DBNAME)
dev migrate: export DATABASE_SSLMODE := $(DEV_DATABASE_SSLMODE)
dev migrate: export JWT_SECRET := $(DEV_JWT_SECRET)
dev migrate: export SUB2API_BASE_URL := $(DEV_SUB2API_BASE_URL)

dev: export SERVER_MODE := debug
dev: export SUB2API_EXTENSION_ASSET_DIR := $(DEV_ASSET_DIR)
dev: export SUB2API_DATABASE_HOST := $(DEV_SUB2API_DATABASE_HOST)
dev: export SUB2API_DATABASE_PORT := $(DEV_SUB2API_DATABASE_PORT)
dev: export SUB2API_DATABASE_USER := $(DEV_SUB2API_DATABASE_USER)
dev: export SUB2API_DATABASE_PASSWORD := $(DEV_SUB2API_DATABASE_PASSWORD)
dev: export SUB2API_DATABASE_DBNAME := $(DEV_SUB2API_DATABASE_DBNAME)
dev: export SUB2API_DATABASE_SSLMODE := $(DEV_SUB2API_DATABASE_SSLMODE)
dev: export SUB2API_EXTENSION_PUBLIC_URL := $(DEV_SUB2API_EXTENSION_PUBLIC_URL)

# dev: 以 debug 模式启动后端开发服务器。
# 必需: sub2api PostgreSQL 密码、数据库可达、扩展表已完成 make migrate。
dev: check-dev-database check-dev-sub2api-database check-dev-sub2api-public-url
	go run ./cmd/server

# migrate: 迁移本地 sub2api 数据库中的扩展表。建表幂等，重复执行无副作用。
migrate: check-dev-database
	go run ./cmd/server -migrate

# 编译后端二进制（纯 Go，CGO 关闭，便于交叉编译）
build:
	CGO_ENABLED=0 go build -ldflags="$(LDFLAGS)" -trimpath -o bin/aux-server ./cmd/server

# 默认测试 = 单元测试（不含需要真实 PostgreSQL 的集成测试）
test: test-unit

# 单元测试：不带 build tag，自动跳过 //go:build integration 的文件
test-unit:
	go test -race -count=1 ./...

# 集成测试：需要真实 PostgreSQL（无 DATABASE_HOST 时测试内部自行 t.Skip）
# 用法: DATABASE_HOST=127.0.0.1 DATABASE_PORT=15432 DATABASE_USER=sub2api \
#       DATABASE_PASSWORD=xxx DATABASE_DBNAME=sub2api make test-integration
test-integration:
	go test -tags=integration -race -count=1 ./...

# go vet 静态检查
vet:
	go vet ./...

# 格式化
fmt:
	gofmt -s -w .

# 整理依赖
tidy:
	go mod tidy
