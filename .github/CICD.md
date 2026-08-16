# Aux Content System CI/CD 流水线配置说明

## 手动登录 GHCR

```shell
docker login ghcr.io -u YOUR_GITHUB_USERNAME
# 提示输入密码时，输入你的 PAT（需 write:packages 权限），不是 GitHub 密码
```

## 概览

本项目使用 GitHub Actions 实现完整的 CI/CD 流水线，共包含 **3 条工作流**，覆盖持续集成、安全扫描和生产部署。

aux-system 是**单镜像**架构（前端 + 后端合一，后端同源托管前端 SPA），因此部署比 sub2api（前后端分离）更简单：一条流水线构建一个镜像、部署到单台机器。

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions 工作流全景                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CI 阶段 (push main / PR)                                        │
│  └── ci.yml ─── 后端单元测试 + golangci-lint                    │
│                前端测试 + 类型检查 + 构建验证                     │
│                                                                 │
│  安全扫描 (PR + 每周一)                                          │
│  └── security-scan.yml ── govulncheck + pnpm audit              │
│                                                                 │
│  生产部署 (仅手动触发，选 main + 填版本号)                       │
│  └── deploy.yml ── 多架构镜像构建 → GHCR → SSH 单机部署          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 与 sub2api (FluxCode) 的区别

| 维度 | sub2api (FluxCode) | aux-system |
|------|-------------------|------------|
| 镜像 | 前后端分离（后端 Docker + 前端 Nginx 静态） | **单镜像**（后端内嵌前端 dist） |
| 部署 | 多机滚动（前后端各自流水线） | **单机**（一条流水线搞定） |
| 数据库 | compose 内含 postgres / 外部共享 | **不含数据库镜像**（外部 PostgreSQL） |
| 前端部署 | rsync 到 Nginx 宿主机 | 无（前端打包进镜像） |
| 工作流数 | 8 条 | 3 条 |

---

## 1. CI — 持续集成 (`ci.yml`)

| 属性 | 值 |
|------|-----|
| **文件** | `.github/workflows/ci.yml` |
| **触发** | `push` 到 `main` 分支、所有 `pull_request` |
| **权限** | `contents: read` |

### Jobs

| Job | 说明 |
|-----|------|
| `backend-test` | 校验 Go 1.26.5 → 运行单元测试 `go test -race ./...`（跳过集成测试） |
| `backend-lint` | golangci-lint v2.9，超时 30 分钟 |
| `frontend` | pnpm install → typecheck → vitest → 构建验证 |

### 注意事项

- Go 版本锁定为 `backend/go.mod` 中声明的版本（当前 1.26.5），并通过 `grep` 强制验证
- 集成测试（`//go:build integration`）需要真实 PostgreSQL，CI 默认跳过；本地运行见[后端测试](#后端测试)
- 前端构建验证仅校验能否构建，产物不部署（Dockerfile 在镜像构建时重新构建前端）
- 三个 job 并行执行以缩短整体时间

---

## 2. 安全扫描 (`security-scan.yml`)

| 属性 | 值 |
|------|-----|
| **文件** | `.github/workflows/security-scan.yml` |
| **触发** | 所有 `pull_request`，以及每周一 UTC 03:00（北京时间 11:00）定时 |
| **权限** | `contents: read` |

### Jobs

| Job | 说明 |
|-----|------|
| `backend-security` | `govulncheck ./...` 扫描 Go 依赖已知漏洞（超时 15 分钟） |
| `frontend-security` | `pnpm audit --prod --audit-level=high` 扫描 npm 依赖（高严重度及以上失败） |

---

## 3. 生产部署 (`deploy.yml`)

| 属性 | 值 |
|------|-----|
| **文件** | `.github/workflows/deploy.yml` |
| **触发** | 仅手动触发（选择 `main` 分支，填写版本号） |
| **权限** | `contents: read`, `packages: write` |
| **环境** | `production`（deploy job） |

### 架构

```
┌──────────────┐   push image   ┌─────────┐
│ GitHub CI    │ ──────────────→│  GHCR   │
│ Docker Build │                └────┬────┘
│ (多架构)      │                     │ docker compose pull
└──────────────┘                     ▼
                            ┌──────────────────────┐
                            │  生产服务器（单机）    │
                            │  docker-compose.prod  │
                            │  aux-backend (单镜像)  │
                            │  + health check       │
                            └──────────────────────┘
                               │
                               ├──→ 外部 PostgreSQL（不在 compose 内）
                               └──→ sub2api（同网络 / 公网域名）
```

### 流程

1. **build-and-push**:
   - 使用项目根 `Dockerfile` 多阶段构建（前端 + 后端 → 单镜像）
   - **双架构构建**：`linux/amd64` + `linux/arm64`（Go 交叉编译 + 前端 JS 架构无关，不经 QEMU 模拟，速度接近单架构）
   - 推送到 GHCR，标签：`{version}` + `latest`（如 `1.0.0` + `latest`）
   - 使用 GitHub Actions Cache 加速 Docker 构建
   - 注入 `VERSION` / `COMMIT` / `DATE` build-args 到二进制 ldflags
2. **deploy**: 使用 `appleboy/ssh-action` SSH 到单台生产服务器：
   - 登录 GHCR（用 PAT）
   - 更新 `.env.prod` 中的 `AUX_IMAGE_TAG` 为当前版本号、`AUX_IMAGE` 为镜像名
   - `docker compose -f docker-compose.prod.yml --env-file .env.prod pull aux-backend`
   - `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --remove-orphans aux-backend`
   - 等待健康检查通过（最多 5 分钟，每 10 秒检查一次，检查 `/health` 端点）
   - 清理 7 天以上的旧镜像

### 手动触发参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `version` | 版本号（如 `1.0.0`，作为镜像 tag） | 必填 |
| `skip_deploy` | 仅构建推送镜像，跳过 SSH 部署 | `false` |

### 生产 Docker Compose 配置

生产服务器上的 `docker-compose.prod.yml`（来自 `deploy/docker-compose.prod.yml`）：

- **仅 aux-backend 一个服务**（不含数据库镜像）
- 镜像：`${AUX_IMAGE}:${AUX_IMAGE_TAG}`（部署时自动更新为具体版本号）
- 连接**外部 PostgreSQL**（`DATABASE_HOST` 等环境变量指向外部数据库）
- 加入 `sub2api-network`（external）以与 sub2api 互联
- 健康检查：`wget http://localhost:8787/health`

> 与开发用 `deploy/docker-compose.yml` 的区别：开发版含 `aux-postgres` 服务并从源码 build；生产版不含数据库、从 GHCR 拉取镜像。

---

## Secrets 配置清单

### 生产部署 Secrets（`production` Environment）

| Secret | 说明 | 必需 | 默认值 |
|--------|------|:----:|--------|
| `AUX_DEPLOY_HOST` | 生产服务器 IP/域名（单机） | ✅ | — |
| `AUX_DEPLOY_USER` | SSH 用户 | ✅ | `root` |
| `AUX_DEPLOY_PASSWORD` | SSH 密码 | ✅ | — |
| `AUX_DEPLOY_PATH` | docker-compose.prod.yml 所在目录 | — | `/opt/aux-system` |
| `AUX_DEPLOY_PORT` | SSH 端口 | — | `22` |
| `GHCR_PAT` | GHCR 拉取用 PAT（`read:packages`） | ✅ | — |

> `GITHUB_TOKEN` 由 GitHub 自动提供，用于 GHCR 推送，无需手动配置。

### Environments 配置

需要在 GitHub 仓库 **Settings → Environments** 中创建：

| Environment | 用途 | 使用流水线 | 建议配置 |
|-------------|------|---------|--------|
| `production` | 生产部署 | `deploy.yml` | 添加审批人 / 分支保护（限定 `main`） |

> 配置 Environment 保护规则后，每次部署需经过审批才能执行，防止意外推送到生产。

---

## 首次部署指南

### 1. 生产服务器初始化

在生产服务器上执行：

```bash
# 1. 安装 Docker 和 Docker Compose
curl -fsSL https://get.docker.com | sh

# 2. 准备部署目录
mkdir -p /opt/aux-system
cd /opt/aux-system

# 3. 从仓库复制部署文件（或手动上传）
#    需要: docker-compose.prod.yml, .env.prod.example
cp docker-compose.prod.yml .
cp .env.prod.example .env.prod

# 4. 编辑 .env.prod，填入实际配置
vim .env.prod
#    必填项:
#    - AUX_IMAGE=ghcr.io/your-org/aux-system  (your-org 替换为实际 GitHub owner)
#    - AUX_IMAGE_TAG=latest                    (首次部署用 latest)
#    - DATABASE_HOST=...                       (外部 PostgreSQL 地址)
#    - DATABASE_PASSWORD=...
#    - SUB2API_BASE_URL=http://sub2api:8080    (或 sub2api 公网域名)
#    - AUX_JWT_SECRET=...                      (openssl rand -hex 32)

# 5. 登录 GHCR（拉取私有镜像需要）
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# 6. 确认 sub2api-network 已存在（sub2api 部署时创建）
docker network ls | grep sub2api-network
#    若不存在且 sub2api 不在同机 Docker 部署，见下方「跨网络部署」说明

# 7. 启动
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# 8. 确认启动
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f aux-backend
curl http://localhost:8787/health
```

### 2. GitHub Secrets 配置

在 GitHub 仓库 **Settings → Environments** 中创建 `production` 环境，配置对应 Secrets：

| 必需 Secrets |
|---|
| `AUX_DEPLOY_HOST`, `AUX_DEPLOY_USER`, `AUX_DEPLOY_PASSWORD`, `GHCR_PAT` |

> 确保生产服务器已开启 SSH 密码登录（`/etc/ssh/sshd_config` 中 `PasswordAuthentication yes`）。
>
> 推荐改用 SSH 密钥登录更安全，可在 `deploy.yml` 中将 `password` 改为 `key`。

### 3. 跨网络部署（sub2api 不在同机 Docker）

若生产服务器上 sub2api 不在同一个 Docker 网络（如 sub2api 在另一台机器或用公网域名）：

1. 编辑 `docker-compose.prod.yml`，将网络改为本地网络：
   ```yaml
   networks:
     default:
       driver: bridge
   ```
   并将服务内的 `networks: [sub2api-network]` 改为 `networks: [default]`（或直接删除 networks 声明）。

2. 编辑 `.env.prod`：
   ```
   SUB2API_BASE_URL=https://sub2api.example.com   # sub2api 公网域名
   ```

---

## 手动构建镜像并推送到 GHCR

除 CI 自动构建外，还可以在本地手动构建镜像并推送到 GHCR。

### 前提条件

1. 安装 Docker 并启用 Buildx
2. 登录 GHCR：`docker login ghcr.io -u <GitHub用户名>`（使用 PAT 作为密码，需 `write:packages` 权限）

### 脚本

| 脚本 | 说明 | 镜像名 |
|------|------|--------|
| `deploy/build-and-push.sh` | 构建单镜像（前端 + 后端合一） | `ghcr.io/{owner}/aux-system` |

### 用法

```bash
# 构建并推送（版本号为必填参数）
./deploy/build-and-push.sh 1.0.0

# 仅构建多架构镜像，不推送（验证用）
./deploy/build-and-push.sh 1.0.0 --no-push

# 仅构建本机架构并加载到本地 Docker（开发调试用）
./deploy/build-and-push.sh 1.0.0 --local
```

### 构建参数

脚本支持以下环境变量覆盖默认值：

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `GHCR_OWNER` | GHCR 仓库所有者 | 自动从 git remote 检测 |
| `PLATFORMS` | 目标平台 | `linux/amd64,linux/arm64` |
| `GOPROXY` | Go 模块代理 | `https://goproxy.cn,direct` |
| `GOSUMDB` | Go checksum 数据库 | `sum.golang.google.cn` |
| `NPM_CONFIG_REGISTRY` | npm 镜像 | 空（官方源） |

---

## 工作流触发规则一览

| 工作流 | push main | PR | 手动 | 定时 |
|--------|:-:|:-:|:-:|:-:|
| CI (`ci.yml`) | ✅ | ✅ | — | — |
| Security Scan | — | ✅ | — | 每周一 |
| Deploy (`deploy.yml`) | — | — | ✅ | — |

---

## 常见操作

### 部署生产环境

生产环境仅支持手动触发，在 GitHub → Actions 页面操作：

1. 选择 **Deploy** 工作流
2. 点击 **Run workflow**
3. 分支选择 `main`
4. 填写 `version`：`1.0.0`（必填，作为镜像 tag）
5. 可选勾选 `skip_deploy`（仅构建镜像不部署）

> 部署时镜像标签为你填写的版本号（如 `1.0.0`），并自动更新服务器 `.env.prod` 中的 `AUX_IMAGE_TAG`。

### 查看部署版本

```bash
# 在生产服务器上
cd /opt/aux-system
grep AUX_IMAGE_TAG .env.prod
docker compose -f docker-compose.prod.yml --env-file .env.prod images
```

### 回滚到旧版本

```bash
cd /opt/aux-system
# 1. 修改 .env.prod 中的镜像标签为旧版本
sed -i 's|^AUX_IMAGE_TAG=.*|AUX_IMAGE_TAG=0.9.0|' .env.prod
# 2. 拉取并重启
docker compose -f docker-compose.prod.yml --env-file .env.prod pull aux-backend
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --remove-orphans aux-backend
# 3. 确认健康
docker compose -f docker-compose.prod.yml --env-file .env.prod ps aux-backend
```

### 后端测试

```bash
cd backend

# 单元测试（不含集成测试，无需数据库）
make test-unit
# 或: go test -race -count=1 ./...

# 集成测试（需要真实 PostgreSQL，无 DATABASE_HOST 时自动跳过）
DATABASE_HOST=127.0.0.1 \
DATABASE_PORT=15433 \
DATABASE_USER=aux \
DATABASE_PASSWORD=xxx \
DATABASE_DBNAME=auxdb \
make test-integration

# 静态检查
make vet
```

---

## 故障排除

| 问题 | 排查 |
|------|------|
| 部署后健康检查超时 | 检查 `docker compose logs aux-backend`；确认 `DATABASE_HOST` 可达、`SUB2API_BASE_URL` 正确 |
| GHCR 镜像拉取失败 | 确认服务器已 `docker login ghcr.io`；检查 `GHCR_PAT` 是否有效（`read:packages`） |
| 部署 SSH 连接失败 | 确认 `AUX_DEPLOY_HOST` 正确、密码正确、服务器已开启 `PasswordAuthentication yes` |
| 容器启动后立即退出 | 查看日志：`docker compose -f docker-compose.prod.yml logs aux-backend`；确认 `AUX_JWT_SECRET` 与 `SUB2API_BASE_URL` 已设置 |
| 无法连接 sub2api | 确认 `SUB2API_BASE_URL` 正确；同网络用 `http://sub2api:8080`，跨网络用公网域名 |
| 无法连接数据库 | 确认 `DATABASE_HOST` / `DATABASE_PORT` / 凭据正确；外部数据库需允许本机访问 |
| sub2api-network 不存在 | sub2api 未部署或未创建该网络；改用本地网络（见「跨网络部署」） |
| CI 中 Go 版本校验失败 | `backend/go.mod` 中 `go 1.26.5` 与 CI 期望不一致，更新 ci.yml 中的 grep 版本 |

---

## 文件索引

| 文件 | 说明 |
|------|------|
| `.github/workflows/ci.yml` | CI 流水线（测试 + lint） |
| `.github/workflows/security-scan.yml` | 安全扫描（govulncheck + pnpm audit） |
| `.github/workflows/deploy.yml` | 生产部署流水线（构建镜像 + SSH 单机部署） |
| `.github/CICD.md` | 本文档 |
| `deploy/docker-compose.yml` | 开发用 compose（含 postgres，从源码 build） |
| `deploy/docker-compose.prod.yml` | 生产用 compose（仅 aux-backend，GHCR 镜像，无数据库） |
| `deploy/.env.example` | 开发环境变量示例 |
| `deploy/.env.prod.example` | 生产环境变量示例 |
| `deploy/build-and-push.sh` | 手动构建推送镜像脚本 |
| `Dockerfile` | 多阶段单镜像构建（前端 + 后端 → Alpine 运行时） |
| `.dockerignore` | Docker 构建上下文忽略清单 |
| `backend/Makefile` | 后端 build / test / vet 入口 |
| `backend/cmd/server/VERSION` | 版本号文件（CI 部署时由 build-arg 覆盖） |
