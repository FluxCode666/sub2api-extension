# =============================================================================
# Sub2API Extension - Repository Makefile
# =============================================================================
# 整个项目的本地 Docker 开发部署入口。后端独立开发与测试目标仍位于
# backend/Makefile。
#
# 常用命令：
#   make dev-config  — 校验开发 Compose 配置
#   make dev-up      — 构建并启动开发环境，等待服务健康
#   make dev-status  — 查看容器状态
#   make dev-health  — 从容器内检查后端健康端点
#   make dev-logs    — 跟踪后端日志
#   make dev-down    — 停止开发环境（保留数据库和资源卷）
# =============================================================================

.DEFAULT_GOAL := help

PROJECT_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
DEV_COMPOSE_FILE ?= $(PROJECT_ROOT)/deploy/docker-compose.dev.yml
DEV_ENV_FILE ?= $(PROJECT_ROOT)/deploy/.env.dev
DEV_COMPOSE = docker compose -f "$(DEV_COMPOSE_FILE)" --env-file "$(DEV_ENV_FILE)"

.PHONY: help check-dev-env dev-config dev-build dev-up dev-status dev-health dev-logs dev-down dev-restart backend-test frontend-test

help:
	@printf '%s\n' \
		'make dev-config    校验开发 Compose 与环境变量' \
		'make dev-build     构建开发镜像' \
		'make dev-up        构建并启动开发环境，等待健康' \
		'make dev-status    查看开发容器状态' \
		'make dev-health    检查 aux-backend 容器健康端点' \
		'make dev-logs      跟踪 aux-backend 日志' \
		'make dev-restart   重启 aux-backend' \
		'make dev-down      停止开发环境并保留数据卷' \
		'make backend-test  运行后端单元测试' \
		'make frontend-test 运行前端测试'

check-dev-env:
	@test -f "$(DEV_ENV_FILE)" || { \
		echo "缺少 $(DEV_ENV_FILE)" >&2; \
		echo "请先执行: cp deploy/.env.dev.example deploy/.env.dev" >&2; \
		exit 1; \
	}

dev-config: check-dev-env
	@$(DEV_COMPOSE) config -q
	@echo "开发 Compose 配置有效"

dev-build: dev-config
	$(DEV_COMPOSE) build

dev-up: dev-config
	$(DEV_COMPOSE) up -d --build --wait --wait-timeout 180
	@$(MAKE) --no-print-directory dev-health

dev-status: check-dev-env
	$(DEV_COMPOSE) ps -a

dev-health: check-dev-env
	@$(DEV_COMPOSE) exec -T aux-backend \
		wget -q -T 5 -O - http://localhost:8787/health
	@printf '\n'

dev-logs: check-dev-env
	$(DEV_COMPOSE) logs --tail=200 -f aux-backend

dev-restart: check-dev-env
	$(DEV_COMPOSE) restart aux-backend
	$(DEV_COMPOSE) up -d --wait --wait-timeout 60 aux-backend
	@$(MAKE) --no-print-directory dev-health

dev-down: check-dev-env
	$(DEV_COMPOSE) down

backend-test:
	$(MAKE) -C "$(PROJECT_ROOT)/backend" test-unit

frontend-test:
	cd "$(PROJECT_ROOT)/frontend" && pnpm test
