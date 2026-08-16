# =============================================================================
# Aux Content System - Backend Makefile
# =============================================================================
# 常用开发与测试入口。CI 流水线（.github/workflows/ci.yml）直接调用这些目标。
#
# 版本号来源：./cmd/server/VERSION（CI 部署时由 GitHub Actions 注入 build-arg 覆盖）。
#
# 开发环境启动：
#   make dev        — 以 debug 模式启动后端，监听 8090（与前端 vite 代理一致）
#   make migrate    — 一次性建表（ent 自动迁移），需 PG 已可达
#
# 数据库/中间件需自行用本地 docker 启动，本 Makefile 不负责拉起 PG。
# =============================================================================

.PHONY: build test test-unit test-integration vet fmt tidy dev migrate

VERSION ?= $(shell tr -d '\r\n' < ./cmd/server/VERSION 2>/dev/null || echo 0.1.0-dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
DATE    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS ?= -s -w -X main.Version=$(VERSION) -X main.Commit=$(COMMIT) -X main.Date=$(DATE)

# ---- 开发环境变量 ----
# 后端开发监听 8090（与 frontend/vite.config.ts 的 proxy target 一致）。
# 数据库连接由开发者本地 docker 提供，此处只给默认值，可用环境变量覆盖。
# deploy/docker-compose.yml 中独立 aux-postgres 的宿主机映射端口为 15433。
DEV_SERVER_PORT ?= 8090
DEV_DATABASE_HOST ?= localhost
DEV_DATABASE_PORT ?= 15433
DEV_DATABASE_USER ?= aux
# 仅本地开发默认值；与 README 的 aux-pg 容器一致。生产环境必须显式设置密码。
DEV_DATABASE_PASSWORD ?= aux
DEV_DATABASE_DBNAME ?= auxdb

# sub2api 对接（可选，不配则公开页/埋点正常，管理端转发验证与 sub2api 数据代理不可用）。
# 联调管理端时导出这两个变量再 make dev:
#   export SUB2API_BASE_URL=http://localhost:8003   # sub2api 容器映射的宿主机端口
#   export SUB2API_ADMIN_API_KEY=<在 sub2api 后台「安全」tab 生成>
DEV_SUB2API_BASE_URL ?= $(SUB2API_BASE_URL)
DEV_SUB2API_ADMIN_API_KEY ?= $(SUB2API_ADMIN_API_KEY)

# dev: 以 debug 模式启动后端开发服务器。
# 必需: JWT_SECRET（开发用任意值）、PG 已可达、建表已完成(make migrate)。
# 可选: SUB2API_BASE_URL / SUB2API_ADMIN_API_KEY（不配则管理端转发验证不可用，公开页正常）。
dev:
	SERVER_MODE=debug \
	SERVER_PORT=$(DEV_SERVER_PORT) \
	DATABASE_HOST=$(DEV_DATABASE_HOST) \
	DATABASE_PORT=$(DEV_DATABASE_PORT) \
	DATABASE_USER=$(DEV_DATABASE_USER) \
	DATABASE_PASSWORD=$(DEV_DATABASE_PASSWORD) \
	DATABASE_DBNAME=$(DEV_DATABASE_DBNAME) \
	JWT_SECRET=$(or $(JWT_SECRET),dev-secret-not-for-production) \
	SUB2API_BASE_URL=$(DEV_SUB2API_BASE_URL) \
	SUB2API_ADMIN_API_KEY=$(DEV_SUB2API_ADMIN_API_KEY) \
	go run ./cmd/server

# migrate: 一次性建表（ent 自动迁移）。需 PG 已可达且 DATABASE_* 指向正确库。
# 用同样的开发连接参数。建表幂等，重复执行无副作用。
migrate:
	SERVER_PORT=$(DEV_SERVER_PORT) \
	DATABASE_HOST=$(DEV_DATABASE_HOST) \
	DATABASE_PORT=$(DEV_DATABASE_PORT) \
	DATABASE_USER=$(DEV_DATABASE_USER) \
	DATABASE_PASSWORD=$(DEV_DATABASE_PASSWORD) \
	DATABASE_DBNAME=$(DEV_DATABASE_DBNAME) \
	JWT_SECRET=$(or $(JWT_SECRET),dev-secret-not-for-production) \
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
# 用法: DATABASE_HOST=127.0.0.1 DATABASE_PORT=15433 DATABASE_USER=aux \
#       DATABASE_PASSWORD=xxx DATABASE_DBNAME=auxdb make test-integration
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
