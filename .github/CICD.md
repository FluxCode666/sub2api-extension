# Sub2API Extension CI/CD 指南

本项目采用单镜像部署：React 前端在 Docker 构建阶段打包，Go 服务同时提供 API、动态页面和前端静态文件。GitHub Actions 负责质量检查、安全扫描、GHCR 镜像发布，以及测试/生产服务器上的 Docker Compose 更新。

## 1. 流水线总览

| 工作流 | 文件 | 触发方式 | 作用 |
|---|---|---|---|
| CI | `.github/workflows/ci.yml` | push `main`、Pull Request、被部署工作流调用 | Go 测试与 lint、前端类型检查、测试和构建 |
| Security Scan | `.github/workflows/security-scan.yml` | Pull Request、每周一 | `govulncheck` 与 `pnpm audit` |
| Deploy Test | `.github/workflows/deploy-test.yml` | push `test`，或手动触发 | 构建测试镜像并部署测试环境 |
| Deploy Production | `.github/workflows/deploy-production.yml` | 推送 semver tag，或从 `main` 手动触发 | 从版本 tag 构建镜像并部署生产环境 |

发布链路如下：

```text
代码提交
   │
   ├─ Pull Request ── CI + Security Scan
   │
   ├─ push test ───── 完整 CI ── test-<sha7> / test-latest ── 测试服务器
   │
   ├─ push v1.2.3 ──── 完整 CI ── v1.2.3 / latest ─────────── 生产服务器
   └─ main 手动发布 ─ 完整 CI ── <version> / latest ───────── 生产服务器
                                      │
                                      └─ Compose 健康检查失败时恢复上一标签
```

测试与生产使用独立的 GitHub Environment、服务器配置和 Compose project。即使部署在同一台主机，也必须使用不同端口、数据库、JWT 密钥、sub2api 环境、域名和数据卷。

项目展示名、Go module、前端包名和 GHCR 镜像已统一为 `sub2api-extension`。为避免已有 iframe 和服务器配置失效，Compose 服务 `aux-backend`、容器运行时的 `AUX_*` 环境变量以及 `/api/aux/*` API 前缀保留兼容。GitHub Environment 的部署密钥和变量不使用 `AUX_` 前缀。

## 2. 质量门禁

部署工作流通过 `workflow_call` 复用 `.github/workflows/ci.yml`，镜像只能在以下检查全部通过后构建：

- 后端：`go test -race -count=1 ./...`
- 后端：`golangci-lint` v2.9
- 前端：`pnpm install --frozen-lockfile`
- 前端：`pnpm run typecheck`
- 前端：`pnpm run test`
- 前端：`pnpm run build`

安全扫描独立运行：

- Go：`govulncheck ./...`
- 前端：`pnpm audit --prod --audit-level=high`

建议在 GitHub Branch protection 中要求 `main` 和 `test` 合并前通过 CI，并禁止直接向 `main` 推送。

## 3. 测试环境部署

### 触发规则

- push 到 `test` 分支自动部署。
- 只在后端、前端、Docker、部署配置或相关工作流变化时触发，文档改动不会重建镜像。
- Actions 页面也可手动运行 `Deploy Test`。

手动参数：

| 参数 | 说明 | 默认值 |
|---|---|---|
| `tag` | 自定义测试镜像标签 | `test-<commit 前 7 位>` |
| `skip_deploy` | 只构建并推送镜像，不连接服务器 | `false` |
| `target_host` | 临时覆盖测试服务器地址 | 使用 Environment Secret |

每次构建推送两个标签：

```text
ghcr.io/<owner>/sub2api-extension:test-<sha7>
ghcr.io/<owner>/sub2api-extension:test-latest
```

测试部署并发组为 `sub2api-extension-test-deployment`。新提交到达时会取消仍在运行的旧测试部署，避免旧版本晚于新版本上线。

### 测试服务器目录

默认目录：

```text
/opt/sub2api-extension-test/
├── docker-compose.yml        # 流水线每次自动同步
└── .env.test                 # 服务器持有，流水线只更新镜像相关字段
```

测试 Compose project 固定为 `sub2api-extension-test`，因此其命名卷与生产 project 隔离。

## 4. 生产环境部署

生产工作流支持两种触发方式：向仓库推送符合 semver 的 `v1.2.3`（或 `1.2.3`）tag，或在 GitHub Actions 页面手动运行。手动运行时必须选择 `main` 分支；tag 触发时自动使用 tag 作为镜像版本号。

手动参数：

| 参数 | 说明 | 默认值 |
|---|---|---|
| `version` | 生产版本，例如 `1.2.3`、`v1.2.3` 或 `1.2.3-rc.1` | 必填 |
| `skip_deploy` | 只构建并推送镜像，不连接服务器 | `false` |
| `target_host` | 临时覆盖生产服务器地址 | 使用 Environment Secret |

每次构建推送两个标签：

```text
ghcr.io/<owner>/sub2api-extension:<version>
ghcr.io/<owner>/sub2api-extension:latest
```

生产部署并发组为 `sub2api-extension-production-deployment`，不会取消正在执行的生产发布。建议为 `production` Environment 设置审批人，构建完成后必须审批才能真正连接生产服务器。

默认生产目录：

```text
/opt/sub2api-extension/
├── docker-compose.yml        # 流水线每次自动同步
└── .env                      # 服务器持有，流水线只更新镜像相关字段
```

## 5. GitHub Environments

进入仓库的 `Settings → Environments`，创建以下两个环境。

### `test`

测试环境通常不需要人工审批，可将 Deployment branches 限制为 `test`。

Secrets：

| Secret | 必需 | 说明 |
|---|:---:|---|
| `TEST_DEPLOY_HOST` | 是 | 测试服务器 IP 或域名 |
| `TEST_DEPLOY_USER` | 否 | SSH 用户，默认 `root` |
| `TEST_DEPLOY_PASSWORD` | 二选一 | SSH 密码 |
| `TEST_DEPLOY_SSH_KEY` | 二选一 | SSH 私钥全文，推荐使用 |
| `TEST_DEPLOY_PORT` | 否 | SSH 端口，默认 `22` |
| `TEST_DEPLOY_PATH` | 否 | 部署目录，默认 `/opt/sub2api-extension-test` |
| `TEST_DEPLOY_FINGERPRINT` | 建议 | SSH 主机公钥指纹，防止中间人攻击 |
| `GHCR_PAT` | 私有镜像必需 | 具有 `read:packages` 权限的 PAT |

Variables：

| Variable | 必需 | 说明 |
|---|:---:|---|
| `PUBLIC_URL` | 否 | 测试公网 URL，例如 `https://aux-test.example.com`；配置后会额外验证 `/health` 和 `/p/home` |

### `production`

建议配置 Required reviewers，并将 Deployment branches 限制为 `main`。

Secrets：

| Secret | 必需 | 说明 |
|---|:---:|---|
| `DEPLOY_HOST` | 是 | 生产服务器 IP 或域名 |
| `DEPLOY_USER` | 否 | SSH 用户，默认 `root` |
| `DEPLOY_PASSWORD` | 二选一 | SSH 密码 |
| `DEPLOY_SSH_KEY` | 二选一 | SSH 私钥全文，推荐使用 |
| `DEPLOY_PORT` | 否 | SSH 端口，默认 `22` |
| `DEPLOY_PATH` | 否 | 部署目录，默认 `/opt/sub2api-extension` |
| `DEPLOY_FINGERPRINT` | 建议 | SSH 主机公钥指纹 |
| `GHCR_PAT` | 私有镜像必需 | 具有 `read:packages` 权限的 PAT |

Variables：

| Variable | 必需 | 说明 |
|---|:---:|---|
| `PUBLIC_URL` | 否 | 生产公网 URL，例如 `https://aux.example.com`；配置后会额外验证 `/health` 和 `/p/home` |

> 变量名迁移：工作流已不再读取旧的 `TEST_AUX_DEPLOY_*`、`AUX_DEPLOY_*` 和 `AUX_PUBLIC_URL`。请在对应 GitHub Environment 中按上表新建/改名；旧密钥不会被自动兼容读取。Compose 服务器 `.env.test`/`.env` 中的 `SUB2API_EXTENSION_*` 是项目运行时配置。

工作流使用 GitHub 自动提供的 `GITHUB_TOKEN` 向 GHCR 推送镜像。服务器拉取私有镜像使用 `GHCR_PAT`；该 PAT 所属账号必须有镜像读取权限，组织启用 SSO 时还需完成授权。

获取服务器 SSH 指纹示例：

```bash
ssh-keyscan -p 22 example.com 2>/dev/null | ssh-keygen -lf -
```

## 6. 首次初始化服务器

### 测试服务器

```bash
sudo mkdir -p /opt/sub2api-extension-test
sudo chown "$USER":"$USER" /opt/sub2api-extension-test
cd /opt/sub2api-extension-test

# 从仓库 deploy/.env.test.example 复制后编辑
cp /path/to/sub2api-extension/deploy/.env.test.example .env.test
openssl rand -hex 32
```

将生成值写入 `.env.test` 的 `SUB2API_EXTENSION_JWT_SECRET`，并填写测试专用配置：

```dotenv
SUB2API_EXTENSION_IMAGE=ghcr.io/your-org/sub2api-extension
SUB2API_EXTENSION_IMAGE_TAG=test-latest
SUB2API_EXTENSION_CONTAINER_NAME=aux-backend-test
SUB2API_EXTENSION_SERVER_PORT=8787
DATABASE_HOST=<测试数据库地址>
DATABASE_USER=<测试数据库用户>
DATABASE_PASSWORD=<测试数据库密码>
DATABASE_DBNAME=<测试数据库名>
SUB2API_BASE_URL=<测试 sub2api 地址>
SUB2API_EXTENSION_JWT_SECRET=<测试专用随机密钥>
```

如果测试和生产在同一主机，测试必须改用独立宿主机端口，例如 `SUB2API_EXTENSION_SERVER_PORT=8788`，并让测试 NGINX upstream 指向 `127.0.0.1:8788`。

测试部署使用外部 `sub2api-network`。首次部署前确认网络存在：

```bash
docker network inspect sub2api-network >/dev/null
```

若 sub2api 不与 sub2api-extension 位于同一 Docker 主机，需按 `deploy/docker-compose.yml` 尾部注释改为普通本地网络，并将 `SUB2API_BASE_URL` 设置为可访问的 HTTPS 地址。

### 生产服务器

```bash
sudo mkdir -p /opt/sub2api-extension
sudo chown "$USER":"$USER" /opt/sub2api-extension
cd /opt/sub2api-extension

# 从仓库 deploy/.env.example 复制后编辑
cp /path/to/sub2api-extension/deploy/.env.example .env
openssl rand -hex 32
```

至少填写：

```dotenv
SUB2API_EXTENSION_IMAGE=ghcr.io/your-org/sub2api-extension
SUB2API_EXTENSION_IMAGE_TAG=latest
SUB2API_EXTENSION_CONTAINER_NAME=aux-backend
DATABASE_HOST=<生产数据库地址>
DATABASE_USER=<生产数据库用户>
DATABASE_PASSWORD=<生产数据库密码>
DATABASE_DBNAME=<生产数据库名>
SUB2API_BASE_URL=<生产 sub2api 地址>
SUB2API_EXTENSION_JWT_SECRET=<生产专用随机密钥>
```

上传图片保存在 Compose 命名卷的 `/app/data/assets/photos`，发票文件保存在 `/app/data/assets/invoices`，数据库只记录文件元数据。发布容器不会删除该卷。测试 project 和生产 project 会创建不同的 `sub2api-extension-data` 命名卷。

首次可手工校验配置：

```bash
docker compose -f docker-compose.yml --env-file .env config -q
docker compose -f docker-compose.yml --env-file .env up -d
docker compose -f docker-compose.yml --env-file .env ps
curl --fail http://127.0.0.1:8004/health
```

后续流水线会自动同步最新 `docker-compose.yml`，但不会覆盖服务器上的 `.env.test` 或 `.env`。
每次部署会先运行 Compose 中的 `aux-migrate` 一次性服务，确保本系统的页面和埋点表已创建，
迁移成功后才启动 `aux-backend`；迁移失败会阻止发布并进入回滚流程。

## 7. NGINX 与证书

仓库已提供宿主机 NGINX 配置：

```text
deploy/nginx/nginx.conf
deploy/nginx/conf.d/sub2api-extension.conf
```

部署前将 `aux.example.com` 替换为真实域名。证书目录统一为：

```text
/etc/nginx/certs/<域名>/fullchain.pem
/etc/nginx/certs/<域名>/privkey.pem
```

安装并重载：

```bash
sudo install -Dm644 deploy/nginx/nginx.conf /etc/nginx/nginx.conf
sudo install -Dm644 deploy/nginx/conf.d/sub2api-extension.conf /etc/nginx/conf.d/sub2api-extension.conf
sudo nginx -t
sudo systemctl reload nginx
```

Compose 默认只绑定 `127.0.0.1:8004`，公网流量应统一通过 NGINX HTTPS 进入。完整说明见 `deploy/nginx/README.md`。

## 8. 部署、健康检查与回滚

SSH 部署阶段会执行：

1. 保存 `.env.test` 或 `.env` 中原有的 `SUB2API_EXTENSION_IMAGE_TAG`。
2. 更新 `SUB2API_EXTENSION_IMAGE`、`SUB2API_EXTENSION_IMAGE_TAG` 和 `SUB2API_EXTENSION_CONTAINER_NAME`。
3. 运行 `docker compose config -q`。
4. 登录 GHCR 并拉取本次镜像。
5. 拉取 `aux-backend` 和 `aux-migrate` 镜像，并使用
   `docker compose up -d --force-recreate --remove-orphans aux-backend` 更新容器；
   Compose 会先等待 `aux-migrate` 成功退出。
6. 最多等待约 5 分钟，直到 Compose 将容器标记为 `healthy`。
7. 若失败，输出最近 100 行日志并尝试恢复上一镜像标签。
8. 成功后清理 7 天以前未使用的镜像层。

Compose 健康检查访问容器内的：

```text
http://localhost:8004/health
```

如果 Environment Variable `PUBLIC_URL` 已配置，工作流还会从 GitHub Runner 验证：

```text
<PUBLIC_URL>/health
<PUBLIC_URL>/p/home
```

自动回滚只能恢复仍存在于 GHCR 的上一标签，因此生产发布必须使用不可变版本号，不要只依赖 `latest`。

### 手动回滚生产版本

最稳妥的方式是重新运行 `Deploy Production`，填写需要恢复的旧版本号。也可登录服务器执行：

```bash
cd /opt/sub2api-extension
sed -i 's/^SUB2API_EXTENSION_IMAGE_TAG=.*/SUB2API_EXTENSION_IMAGE_TAG=1.2.2/' .env
docker compose -f docker-compose.yml --env-file .env pull aux-backend
docker compose -f docker-compose.yml --env-file .env up -d aux-backend
docker compose -f docker-compose.yml --env-file .env ps
```

## 9. 日常发布流程

### 发布测试环境

```bash
git switch test
git merge <待测试分支>
git push origin test
```

然后在 GitHub Actions 中确认 `Deploy Test` 的质量门禁、镜像构建和健康检查均通过。

### 发布生产环境

1. 将验证通过的代码合并到 `main`。
2. 打开 GitHub `Actions → Deploy Production → Run workflow`。
3. Branch 选择 `main`。
4. 填写不可复用的版本号，例如 `1.4.0`。
5. 保持 `skip_deploy=false`。
6. 若配置了 Environment 审批，审批生产部署。
7. 检查 Actions summary、服务器健康状态及官网动态页。

若只需预先构建镜像，将 `skip_deploy` 设为 `true`；稍后可再次运行同版本部署，但应注意同名镜像标签会被覆盖，因此生产建议一次版本对应一次确定提交。

## 10. 本地构建与校验

手工登录 GHCR：

```bash
printf '%s' "$GHCR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

使用仓库脚本构建：

```bash
./deploy/build-and-push.sh 1.2.3
./deploy/build-and-push.sh 1.2.3 --local
```

提交前可运行与 CI 对应的检查：

```bash
cd backend
go test -race -count=1 ./...

cd ../frontend
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run build
```

## 11. 故障排查

### 无法连接服务器

- 检查 Environment Secret 中的 host、port、user。
- 密码和私钥至少配置一个；推荐只配置私钥。
- 配置 fingerprint 后，确认它与目标主机当前 SSH host key 一致。
- 确认 SSH 用户有权限访问 Docker socket 和部署目录。

### GHCR 拉取失败

- 确认 `GHCR_PAT` 有 `read:packages` 权限。
- 确认 PAT 用户有权读取该仓库的 package。
- 组织启用 SSO 时，为 PAT 授权组织访问。
- 在服务器手工运行 `docker login ghcr.io` 和 `docker pull` 定位权限问题。

### Compose 提示网络不存在

```bash
docker network inspect sub2api-network
```

若服务不需要加入同机 sub2api 网络，按 Compose 文件末尾说明改成本地 bridge 网络。

### 容器一直 unhealthy

```bash
cd /opt/sub2api-extension
docker compose -f docker-compose.yml --env-file .env ps
docker compose -f docker-compose.yml --env-file .env logs --tail=200 aux-backend
curl -v http://127.0.0.1:8004/health
```

重点检查数据库连通性、`SUB2API_BASE_URL`、JWT 密钥、端口占用和数据目录权限。

### 公网健康检查失败但容器健康

- 检查 `PUBLIC_URL` 是否包含正确协议和域名。
- 执行 `nginx -t` 并查看 NGINX error log。
- 确认证书位于 `/etc/nginx/certs/<域名>/`。
- 检查 DNS、443 防火墙和 NGINX upstream 端口。

## 12. 相关文件

- `.github/workflows/ci.yml`
- `.github/workflows/security-scan.yml`
- `.github/workflows/deploy-test.yml`
- `.github/workflows/deploy-production.yml`
- `deploy/docker-compose.dev.yml`
- `deploy/docker-compose.yml`
- `deploy/.env.test.example`
- `deploy/.env.dev.example`
- `deploy/.env.example`
- `deploy/nginx/README.md`
- `deploy/build-and-push.sh`
