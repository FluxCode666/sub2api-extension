# sub2api-extension · sub2api 附属内容承载系统

[![Go](https://img.shields.io/badge/Go-1.26.5-00ADD8?logo=go)]() [![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)]() [![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript)]()

独立部署的 web 应用，作为 [sub2api](../sub2api) 的内容源。通过 sub2api 现有的 iframe 机制嵌入，**零代码改动 sub2api**（全部对接走 sub2api 后台配置项）。

## 它解决什么问题

sub2api 需要一个承载动态内容与页面分析的子系统，但不能为了它修改自身代码。sub2api-extension 以独立服务的形式提供：

- **官网动态页面** —— 原 `HomePage.tsx` 已迁移到数据库页面 `home`，可通过 sub2api `home_content` 的 URL iframe 模式嵌入
- **Sub2API 官方页面** —— 保留在数据库页面 `sub2api-home`，可独立预览和编辑
- **独立管理页面** —— 通过 sub2api 的 `custom_menu_items`（控制台菜单）经 iframe 加载，也支持直接登录
- **页面分析/埋点** —— 采集当前管理页面的访问与功能点击，仪表盘展示「有哪些页面、访问量、功能使用度」
- **管理员转发验证** —— 管理端页面经 sub2api iframe token 换取附属会话，无需重复登录

## 架构

```
┌─────────────────── sub2api（外部宿主，不改代码）─────────────────────┐
│  控制台菜单 custom_menu_items → 带 token iframe                       │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────── sub2api-extension（独立部署）─────────────────────────────────┐
│  前端 React SPA                     后端 Go + Gin + Ent                │
│  /admin/dashboard  控制台首页        /api/aux/*          公开配置/埋点   │
│  /p/home           数据库官网页面    /api/aux/admin/*    受 AdminGuard   │
│  /admin/*  管理端（需会话）         转发验证 → sub2api /auth/me        │
│                                          │                            │
│                                          ▼                            │
│                                   自有 PostgreSQL                     │
│                            (system_meta / page_view / feature_click)  │
└───────────────────────────────────────────────────────────────────────┘
```

`/` 会跳转到 `/admin/dashboard` 控制台首页；原硬编码官网已迁移为数据库动态页面 `/p/home`，Sub2API 官方页面保留在 `/p/sub2api-home`。

## 核心特性

- **零侵入 sub2api** —— iframe 对接走 sub2api 现有 `custom_menu_items` 配置，CSP `frame-src` 由 sub2api 自动注入
- **双主题官网** —— 浅色为默认主题，支持手动切换暗色，并可通过 `?theme=light|dark` 初始化
- **动态伙伴列表** —— 配置为空时不展示，有配置时自动循环横向滚动并支持左右拖拽
- **管理员会话守卫** —— `AdminGuard` 组件用 iframe 传入的 sub2api token 转发验证，签发附属系统自有 JWT（`X-Aux-Session` 头）
- **匿名埋点** —— 公开写入面（不经守卫），per-IP 令牌桶限流 + 4KB body 限制，防滥用
- **分析仪表盘** —— 聚合当前注册页面的访问量与功能使用度，历史已删除页面的数据保留但不展示
- **三个示例页面** —— 静态内容、交互埋点、受保护 API 请求均可从 Dashboard 点击进入
- **标准 API 信封** —— `{code, message, data?}` 成功 / `{code, message, reason?}` 错误
- **单镜像部署** —— 多阶段 Docker 构建，后端同源托管前端 dist，无 CORS
- **CI/CD 流水线** —— GitHub Actions 四条工作流（CI / 安全扫描 / 测试部署 / 生产部署），多架构镜像构建推送 GHCR，SSH 部署、健康检查与自动回滚

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Go 1.26.5 · Gin · Ent ORM · PostgreSQL · golang-jwt/v5 · viper · x/time/rate |
| 前端 | React 18 · Vite 5 · TypeScript 5.6 · Tailwind CSS · React Router 6 |
| 测试 | 后端 `go test` · 前端 Vitest + @testing-library/react |
| 部署 | Docker 多阶段构建 · docker-compose |

## 目录结构

```
sub2api-extension/
├── backend/
│   ├── cmd/server/              # 程序入口 + VERSION 文件
│   ├── internal/
│   │   ├── config/              # 配置（环境变量 + viper）
│   │   ├── handler/             # HTTP handler（auth/telemetry/admin）
│   │   ├── service/             # 业务逻辑（auth/telemetry/analytics）
│   │   ├── integration/         # sub2api 客户端（登录与身份转发验证）
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
│       └── pages/               # 动态页面宿主、Dashboard 与示例页面
├── deploy/
│   ├── docker-compose.dev.yml   # 开发用（含 postgres，从源码 build）
│   ├── docker-compose.yml       # 生产用（仅 aux-backend，GHCR 镜像，无数据库）
│   ├── .env.dev.example         # 开发环境变量示例
│   ├── .env.test.example        # 测试环境变量示例
│   ├── .env.example             # 生产环境变量示例
│   ├── build-and-push.sh        # 手动构建推送镜像脚本
│   └── nginx/                   # 宿主机 NGINX HTTPS 反向代理配置
├── .github/
│   ├── workflows/               # CI / 安全扫描 / 测试部署 / 生产部署
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
cp .env.dev.example .env.dev
```

编辑 `.env.dev`，至少设置三个必需项：

```bash
SUB2API_EXTENSION_POSTGRES_PASSWORD=<强密码>          # 附属系统自有 PostgreSQL
SUB2API_EXTENSION_JWT_SECRET=$(openssl rand -hex 32) # 附属系统会话签名密钥
```

启动并验证：

```bash
docker compose -f docker-compose.dev.yml --env-file .env.dev up -d
curl http://localhost:8787/health
# 预期: {"status":"ok","service":"sub2api-extension"}
```

开发用 compose 含 `aux-postgres` 服务并从源码构建镜像。附属系统启动后，可将 `/p/home` 配置到 sub2api `home_content`，并用 `custom_menu_items` 添加 `/admin/dashboard` 与 `/admin/pages`。**完整集成步骤见 [docs/INTEGRATION.md](docs/INTEGRATION.md)。**

### 测试与生产部署

测试环境使用 `deploy/.env.test.example`，推送到 `test` 分支后由 GitHub Actions 自动部署：

```bash
cd deploy
cp .env.test.example .env.test
# 填入测试环境专用的数据库、sub2api、JWT、域名和端口配置
docker compose --project-name sub2api-extension-test \
  -f docker-compose.yml --env-file .env.test up -d
```

测试环境应使用独立数据库、JWT 密钥、sub2api 实例、域名和数据卷，禁止复用生产数据。

生产用 `deploy/docker-compose.yml`，仅运行 `aux-backend`（从 GHCR 拉取镜像），**不含数据库镜像**——PostgreSQL 由外部提供。

```bash
cd deploy
cp .env.example .env
# 填入: SUB2API_EXTENSION_IMAGE / SUB2API_EXTENSION_IMAGE_TAG / DATABASE_* / SUB2API_* / SUB2API_EXTENSION_JWT_SECRET
docker compose -f docker-compose.yml --env-file .env up -d
```

生产环境建议由宿主机 NGINX 对外提供 HTTPS，Compose 中的 aux-backend 默认只绑定
`127.0.0.1:8787`，避免公网绕过 TLS 直接访问应用端口。NGINX 配置和安装步骤见
[deploy/nginx/README.md](deploy/nginx/README.md)。

测试部署由 `test` 分支 push 自动触发；生产部署仅允许从 `main` 分支手动触发并填写版本号。两者都会先运行完整质量门禁，再构建 amd64/arm64 镜像、推送 GHCR、通过 SSH 更新 Compose，并执行健康检查；失败时尝试恢复上一镜像标签。**完整流水线、Secrets 配置与首次部署指南见 [.github/CICD.md](.github/CICD.md)。**

## 本地开发

开发环境用命令直接启动后端和前端，不依赖 Docker 部署。**数据库与中间件需自行用本地 docker 启动**（本仓库不负责拉起 PostgreSQL）。

### 前置：启动 PostgreSQL 并建库

后端连接 PostgreSQL（默认 `127.0.0.1:15433`，库名 `auxdb`，用户 `aux`）。自行用 docker 起一个：

```bash
docker run -d --name aux-pg -e POSTGRES_USER=aux -e POSTGRES_PASSWORD=aux \
  -e POSTGRES_DB=auxdb -p 127.0.0.1:15433:5432 postgres:18-alpine
```

### 后端

```bash
cd backend
go mod download

# 1) 一次性建表（ent 自动迁移，幂等可重复执行）
make migrate

# 2) 启动开发服务器（debug 模式，监听 8004）
make dev
```

`make migrate` 也会创建 `image_assets` 表；图片文件本身写入 `SUB2API_EXTENSION_ASSET_DIR`，数据库只保存相对路径。

`make dev` 通过环境变量注入开发配置：

> 项目展示名和镜像名已统一为 `sub2api-extension`。为兼容已有部署，Compose 服务名 `aux-backend`、配置变量 `AUX_*` 以及 `/api/aux/*` API 前缀暂时保持不变。

| 变量 | 默认 | 说明 |
|------|------|------|
| `DEV_SERVER_PORT` | `8004` | 后端监听端口（与前端 vite 代理一致） |
| `DEV_DATABASE_HOST` | `127.0.0.1` | PG 地址（与 Docker 的 IPv4 绑定一致） |
| `DEV_DATABASE_PORT` | `15433` | 独立 aux PostgreSQL 的宿主机端口 |
| `DEV_DATABASE_USER` | `aux` | PG 用户 |
| `DEV_DATABASE_PASSWORD` | `aux` | 本地 `aux-pg` 容器的开发密码；生产环境必须显式设置 |
| `DEV_DATABASE_DBNAME` | `auxdb` | PG 库名 |
| `JWT_SECRET` | `dev-secret-not-for-production` | 开发用签名密钥 |

> 本地 `SUB2API_BASE_URL` 默认是 `http://127.0.0.1:8003`，可通过环境变量覆盖；它用于账号密码登录和 iframe 管理员身份转发验证。

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

前端 dev server 监听 `3100`，已配置 `/api` 代理到 `http://127.0.0.1:8004`（即后端 `make dev` 的端口）。浏览器访问 `http://localhost:3100` 即可。

### 管理端登录

管理端页面（如 `/admin/pages`）需要通过 sub2api 管理员身份验证。本地开发环境默认管理员账号：

- **邮箱**: `admin@sub2api.local`
- **密码**: `123456`

登录 sub2api 控制台（`http://localhost:8003`）后，可通过 iframe token 自动转发验证到 sub2api-extension 管理端。

### 端口约定

| 服务 | 开发端口 | 说明 |
|------|----------|------|
| 前端 vite | `3100` | 浏览器访问入口 |
| 后端 | `8004` | 前端代理目标，`make dev` 默认 |
| PostgreSQL | `15433` | 独立 aux PostgreSQL 的本地 docker 容器映射 |

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

当前基线：后端全量测试通过，前端 119 个测试通过。

## 配置

环境变量（开发环境完整说明见 `deploy/.env.dev.example`，生产环境见 `deploy/.env.example`）：

| 变量 | 说明 | 默认 |
|------|------|------|
| `SUB2API_EXTENSION_SERVER_PORT` | 宿主机映射端口 | `8787` |
| `BIND_HOST` | 宿主机端口绑定地址；生产 NGINX 模式建议本机 | `127.0.0.1`（生产示例） |
| `SUB2API_EXTENSION_POSTGRES_PASSWORD` | 自有 PG 密码（**必需**） | — |
| `SUB2API_BASE_URL` | sub2api 后端地址 | `http://sub2api:8080` |
| `SUB2API_EXTENSION_JWT_SECRET` | 会话签名密钥（**必需**） | — |
| `SUB2API_EXTENSION_JWT_EXPIRE_HOUR` | 会话有效期（小时） | `24` |
| `SERVER_MODE` | `release` / `debug` | `release` |
| `TZ` | 时区 | `Asia/Shanghai` |

## 约束与边界

- **不修改 sub2api 代码** —— 所有集成通过 sub2api 现有接缝完成
- **公开首页与管理端分离** —— `home_content` 使用公开动态页面 `/p/home`；根路径 `/` 作为控制台快捷入口，页面管理和分析仪表盘使用会传 token 的 `custom_menu_items`
- **自有数据库** —— sub2api-extension 使用独立 PostgreSQL，不复用 sub2api 的数据库
- **Ent 生成代码** —— `backend/ent/` 是 `ent/schema/*.go` 的生成产物，修改 schema 后需 `go generate ./ent`

## 文档

- **[docs/INTEGRATION.md](docs/INTEGRATION.md)** —— sub2api 侧 `custom_menu_items` 集成配置指南（架构、部署、CSP、验收清单、故障排查）
- **[.github/CICD.md](.github/CICD.md)** —— CI/CD 完整文档（测试/生产环境、Secrets、首次部署、发布、回滚与故障排查）
