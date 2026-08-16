# aux-system · sub2api 附属内容承载系统

[![Go](https://img.shields.io/badge/Go-1.26.5-00ADD8?logo=go)]() [![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)]() [![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript)]()

独立部署的 web 应用，作为 [sub2api](../sub2api) 的内容源。通过 sub2api 现有的 iframe 机制嵌入，**零代码改动 sub2api**（全部对接走 sub2api 后台配置项）。

## 它解决什么问题

sub2api 需要一个承载动态内容与页面分析的子系统，但不能为了它修改自身代码。aux-system 以独立服务的形式提供：

- **硬编码动态页面** —— 通过 sub2api 的 `home_content`（官网首页）与 `custom_menu_items`（控制台菜单）经 iframe 加载
- **页面分析/埋点** —— 匿名采集页面访问与功能点击，管理仪表盘展示「存在哪些页面、访问量、功能使用度」
- **管理员转发验证** —— 管理端页面经 sub2api iframe token 换取附属会话，无需重复登录

## 架构

```
┌─────────────────── sub2api（外部宿主，不改代码）─────────────────────┐
│  官网首页                          控制台菜单                          │
│  home_content → 裸 iframe          custom_menu_items → 带 token iframe │
│  （不传 token，纯公开）            （传 token，转发验证）               │
└───────────┬──────────────────────────────────┬─────────────────────────┘
            ▼                                  ▼
┌──────────────── aux-system（独立部署）─────────────────────────────────┐
│  前端 React SPA                     后端 Go + Gin + Ent                │
│  /         公开首页                 /api/aux/*          公开 + 埋点上报 │
│  /admin/*  管理端（需会话）         /api/aux/admin/*    受 AdminGuard   │
│                                     转发验证 → sub2api /auth/me        │
│                                     Admin API Key → sub2api /admin/*   │
│                                          │                            │
│                                          ▼                            │
│                                   自有 PostgreSQL                     │
│                                   (page_view / feature_click)         │
└───────────────────────────────────────────────────────────────────────┘
```

**两条嵌入路径的关键差异：**

| 路径 | 宿主配置 | 传 token | 附属系统页面 | 认证 |
|------|----------|----------|--------------|------|
| 官网首页 | `home_content` | 否（裸 iframe） | `/` 公开首页 | 无 |
| 控制台菜单 | `custom_menu_items` | 是 | `/admin/*` 管理端 | iframe token → 转发验证 |

## 核心特性

- **零侵入 sub2api** —— 所有对接走 sub2api 现有后台配置（`home_content`、`custom_menu_items`、`admin_api_key`），CSP `frame-src` 由 sub2api 自动注入
- **管理员会话守卫** —— `AdminGuard` 组件用 iframe 传入的 sub2api token 转发验证，签发附属系统自有 JWT（`X-Aux-Session` 头）
- **匿名埋点** —— 公开写入面（不经守卫），per-IP 令牌桶限流 + 4KB body 限制，防滥用
- **分析仪表盘** —— 聚合页面访问量与功能使用度，按计数降序排序，孤儿页标注
- **刷新竞态防护** —— 动态页用递增请求 ID 丢弃过期响应
- **标准 API 信封** —— `{code, message, data?}` 成功 / `{code, message, reason?}` 错误
- **单镜像部署** —— 多阶段 Docker 构建，后端同源托管前端 dist，无 CORS
- **CI/CD 流水线** —— GitHub Actions 三条工作流（CI 测试 / 安全扫描 / 生产部署），多架构镜像构建推送 GHCR，SSH 单机部署

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Go 1.26.5 · Gin · Ent ORM · PostgreSQL · golang-jwt/v5 · viper · x/time/rate |
| 前端 | React 18 · Vite 5 · TypeScript 5.6 · Tailwind CSS · React Router 6 |
| 测试 | 后端 `go test` · 前端 Vitest + @testing-library/react |
| 部署 | Docker 多阶段构建 · docker-compose |

## 目录结构

```
aux-system/
├── backend/
│   ├── cmd/server/              # 程序入口 + VERSION 文件
│   ├── internal/
│   │   ├── config/              # 配置（环境变量 + viper）
│   │   ├── handler/             # HTTP handler（auth/proxy/telemetry/admin）
│   │   ├── service/             # 业务逻辑（auth/proxy/telemetry/analytics）
│   │   ├── integration/         # sub2api 客户端（转发验证/Admin API）
│   │   ├── server/              # Gin 路由装配 + middleware（AdminGuard/TelemetryGuard）
│   │   ├── pkg/response/        # 标准信封工具
│   │   └── web/                 # 健康检查
│   ├── ent/                     # Ent ORM 生成代码（schema 输入在 ent/schema/）
│   └── Makefile                 # build/test/vet/fmt 入口（CI 直接调用）
├── frontend/
│   └── src/
│       ├── components/          # AdminGuard（会话守卫）
│       ├── layouts/             # 公开/管理端布局
│       ├── lib/                 # admin-auth/api-client/telemetry-sdk/page-registry...
│       └── pages/               # HomePage/SampleDynamicPage/admin/DashboardPage
├── deploy/
│   ├── docker-compose.yml       # 开发用（含 postgres，从源码 build）
│   ├── docker-compose.prod.yml  # 生产用（仅 aux-backend，GHCR 镜像，无数据库）
│   ├── .env.example             # 开发环境变量示例
│   ├── .env.prod.example        # 生产环境变量示例
│   └── build-and-push.sh        # 手动构建推送镜像脚本
├── .github/
│   ├── workflows/               # CI / security-scan / deploy 三条工作流
│   └── CICD.md                  # ← CI/CD 完整文档（流水线/Secrets/部署/回滚）
├── docs/
│   └── INTEGRATION.md           # ← sub2api 侧集成配置指南（必读）
├── Dockerfile                   # 多阶段构建（前端 + 后端 → 单镜像）
└── .dockerignore
```

## 快速开始（Docker 开发部署）

**前置条件：** sub2api 已通过其 `deploy/docker-compose.yml` 部署，`sub2api-network` 已存在。

```bash
cd deploy
cp .env.example .env
```

编辑 `.env`，至少设置三个必需项：

```bash
AUX_POSTGRES_PASSWORD=<强密码>          # 附属系统自有 PostgreSQL
SUB2API_ADMIN_API_KEY=<64字符hex密钥>   # 在 sub2api 后台「安全」tab 生成
AUX_JWT_SECRET=$(openssl rand -hex 32) # 附属系统会话签名密钥
```

启动并验证：

```bash
docker compose up -d
curl http://localhost:8787/health
# 预期: {"status":"ok","service":"aux-system"}
```

开发用 compose 含 `aux-postgres` 服务并从源码构建镜像。附属系统启动后，在 sub2api 后台配置 `home_content` 与 `custom_menu_items` 指向它即可完成嵌入。**完整集成步骤见 [docs/INTEGRATION.md](docs/INTEGRATION.md)。**

### 生产部署

生产用 `deploy/docker-compose.prod.yml`，仅运行 `aux-backend`（从 GHCR 拉取镜像），**不含数据库镜像**——PostgreSQL 由外部提供。

```bash
cd deploy
cp .env.prod.example .env.prod
# 填入: AUX_IMAGE / AUX_IMAGE_TAG / DATABASE_* / SUB2API_* / AUX_JWT_SECRET
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

生产部署通过 GitHub Actions 手动触发：构建多架构镜像（amd64+arm64）→ 推送 GHCR → SSH 到单机服务器拉取并重启。**完整流水线、Secrets 配置与首次部署指南见 [.github/CICD.md](.github/CICD.md)。**

## 本地开发

开发环境用命令直接启动后端和前端，不依赖 Docker 部署。**数据库与中间件需自行用本地 docker 启动**（本仓库不负责拉起 PostgreSQL）。

### 前置：启动 PostgreSQL 并建库

后端连接 PostgreSQL（默认 `localhost:5432`，库名 `auxdb`，用户 `aux`）。自行用 docker 起一个：

```bash
docker run -d --name aux-pg -e POSTGRES_USER=aux -e POSTGRES_PASSWORD=aux \
  -e POSTGRES_DB=auxdb -p 5432:5432 postgres:18-alpine
```

### 后端

```bash
cd backend
go mod download

# 1) 一次性建表（ent 自动迁移，幂等可重复执行）
make migrate

# 2) 启动开发服务器（debug 模式，监听 8090）
make dev
```

`make dev` 通过环境变量注入开发配置：

| 变量 | 默认 | 说明 |
|------|------|------|
| `DEV_SERVER_PORT` | `8090` | 后端监听端口（与前端 vite 代理一致） |
| `DEV_DATABASE_HOST` | `localhost` | PG 地址 |
| `DEV_DATABASE_PORT` | `5432` | PG 端口 |
| `DEV_DATABASE_USER` | `aux` | PG 用户 |
| `DEV_DATABASE_PASSWORD` | — | PG 密码（需通过环境变量提供） |
| `DEV_DATABASE_DBNAME` | `auxdb` | PG 库名 |
| `JWT_SECRET` | `dev-secret-not-for-production` | 开发用签名密钥 |

> `SUB2API_BASE_URL` / `SUB2API_ADMIN_API_KEY` 可选——不配则管理端转发验证不可用，但公开首页与埋点正常。要联调管理端，在 `make dev` 前导出这两个变量。

PG 密码有特殊字符时，直接导出环境变量再 `make dev`：

```bash
export DEV_DATABASE_PASSWORD='your@password'
make dev
```

### 前端

```bash
cd frontend
pnpm install
pnpm dev        # 开发服务器 http://localhost:3100
```

前端 dev server 监听 `3100`，已配置 `/api` 代理到 `http://localhost:8090`（即后端 `make dev` 的端口）。浏览器访问 `http://localhost:3100` 即可。

### 端口约定

| 服务 | 开发端口 | 说明 |
|------|----------|------|
| 前端 vite | `3100` | 浏览器访问入口 |
| 后端 | `8090` | 前端代理目标，`make dev` 默认 |
| PostgreSQL | `5432` | 本地 docker 容器映射 |

## 测试

```bash
# 后端（Makefile 封装，CI 直接调用这些目标）
cd backend
make vet                 # go vet
make test-unit           # 单元测试（-race，跳过集成测试）
make build               # 编译验证

# 集成测试（需要真实 PostgreSQL，无 DATABASE_HOST 时自动 t.Skip）
DATABASE_HOST=127.0.0.1 DATABASE_PORT=15433 DATABASE_USER=aux \
DATABASE_PASSWORD=xxx DATABASE_DBNAME=auxdb make test-integration

# 前端
cd frontend
pnpm test            # vitest run
pnpm typecheck       # tsc --noEmit
pnpm build           # tsc -b && vite build
```

当前基线：后端 7 个测试包全过，前端 93 个测试全过。

## 配置

环境变量（完整说明见 `deploy/.env.example`）：

| 变量 | 说明 | 默认 |
|------|------|------|
| `AUX_SERVER_PORT` | 宿主机映射端口 | `8787` |
| `AUX_POSTGRES_PASSWORD` | 自有 PG 密码（**必需**） | — |
| `SUB2API_BASE_URL` | sub2api 后端地址 | `http://sub2api:8080` |
| `SUB2API_ADMIN_API_KEY` | sub2api Admin API Key（**必需**） | — |
| `AUX_JWT_SECRET` | 会话签名密钥（**必需**） | — |
| `AUX_JWT_EXPIRE_HOUR` | 会话有效期（小时） | `24` |
| `SERVER_MODE` | `release` / `debug` | `release` |
| `TZ` | 时区 | `Asia/Shanghai` |

## 约束与边界

- **不修改 sub2api 代码** —— 所有集成通过 sub2api 现有接缝完成
- **`home_content` 路径不传 token** —— 经官网首页嵌入的公开页收不到访问者身份，只能承载纯公开内容；需身份验证的页面必须经 `custom_menu_items` 嵌入
- **自有数据库** —— aux-system 使用独立 PostgreSQL，不复用 sub2api 的数据库
- **Ent 生成代码** —— `backend/ent/` 是 `ent/schema/*.go` 的生成产物，修改 schema 后需 `go generate ./ent`

## 文档

- **[docs/INTEGRATION.md](docs/INTEGRATION.md)** —— sub2api 侧集成配置的完整指南（架构、部署、`home_content`/`custom_menu_items` 配置、CSP、验收清单、故障排查）
- **[.github/CICD.md](.github/CICD.md)** —— CI/CD 完整文档（三条工作流、Secrets 配置、首次部署指南、手动构建、回滚、故障排除）
