# =============================================================================
# Aux Content System - Backend Makefile
# =============================================================================
# 常用开发与测试入口。CI 流水线（.github/workflows/ci.yml）直接调用这些目标。
#
# 版本号来源：./cmd/server/VERSION（CI 部署时由 GitHub Actions 注入 build-arg 覆盖）。
# =============================================================================

.PHONY: build test test-unit test-integration vet fmt tidy

VERSION ?= $(shell tr -d '\r\n' < ./cmd/server/VERSION 2>/dev/null || echo 0.1.0-dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
DATE    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS ?= -s -w -X main.Version=$(VERSION) -X main.Commit=$(COMMIT) -X main.Date=$(DATE)

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
