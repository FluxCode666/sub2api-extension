---
name: sub2api-extension-operations
description: 修改或排查 sub2api-extension 的 Docker、Compose、GitHub Actions、GHCR、NGINX、测试/生产部署、图片持久化和回滚时使用。覆盖环境隔离、Secrets、健康检查与证书路径。
---

# sub2api-extension 部署与运维规范

## 项目与兼容标识

- 项目展示名和 GHCR 镜像名：`sub2api-extension`。
- 测试镜像：`ghcr.io/<owner>/sub2api-extension:test-<sha7>` 与 `test-latest`。
- 生产镜像：`ghcr.io/<owner>/sub2api-extension:<version>` 与 `latest`。
- 为兼容既有 sub2api 集成，Compose 服务名仍是 `aux-backend`，容器运行时环境变量仍使用 `AUX_*`，API 前缀仍是 `/api/aux/*`。GitHub Environment 的部署密钥和变量使用无 `AUX_` 前缀的名称。
- 不要把数据库密码、JWT、PAT 或 SSH 私钥写入仓库、页面元数据或动态 HTML。

## GitHub Actions

工作流位于 `.github/workflows/`：

| 工作流 | 触发 | 规则 |
|---|---|---|
| `ci.yml` | `main` push、Pull Request、部署工作流调用 | Go race test、golangci-lint、前端 typecheck/test/build |
| `security-scan.yml` | Pull Request、每周定时 | `govulncheck`、`pnpm audit` |
| `deploy-test.yml` | push `test` 或手动 | 复用 CI，构建测试镜像并部署测试环境 |
| `deploy-production.yml` | 仅手动 | 只允许从 `main` 发布版本并部署生产 |

测试和生产必须使用独立 GitHub Environments：`test`、`production`。生产 Environment 建议配置 Required reviewers 和分支保护。生产并发不能取消正在执行的发布；测试可以取消旧部署。

Environment Secrets（测试环境使用 `TEST_` 区分，生产环境由 Environment 隔离）：

- 测试：`TEST_DEPLOY_HOST`、`TEST_DEPLOY_USER`、`TEST_DEPLOY_PASSWORD` 或 `TEST_DEPLOY_SSH_KEY`、`TEST_DEPLOY_PORT`、`TEST_DEPLOY_PATH`、`TEST_DEPLOY_FINGERPRINT`、`GHCR_PAT`。
- 生产：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_PASSWORD` 或 `DEPLOY_SSH_KEY`、`DEPLOY_PORT`、`DEPLOY_PATH`、`DEPLOY_FINGERPRINT`、`GHCR_PAT`。
- 可选 Environment Variable：`PUBLIC_URL`，配置后从 runner 验证 `/health` 和 `/p/home`。

工作流不再读取旧的 `TEST_AUX_DEPLOY_*`、`AUX_DEPLOY_*` 或 `AUX_PUBLIC_URL`；改名时需在 GitHub Environment 中重新创建对应条目。服务器 `.env.test`/`.env.prod` 的 Compose 运行时 `AUX_*` 配置不属于这次改名范围。

不要绕过质量门禁直接在部署 job 中构建；镜像必须在 reusable `ci.yml` 通过后才构建。部署脚本必须使用 `docker compose config -q`、拉取镜像、等待 `healthy`，失败时打印有限日志并尝试恢复上一版本标签。

## Compose 环境

生产 Compose：`deploy/docker-compose.prod.yml`，只运行 `aux-backend`，数据库使用外部 PostgreSQL。测试与生产必须分别配置：

- 数据库地址、用户、库名和密码
- sub2api 地址
- JWT secret
- 域名、宿主机端口和 NGINX upstream
- Docker Compose project 和数据卷

测试默认部署目录为 `/opt/sub2api-extension-test`，生产默认部署目录为 `/opt/sub2api-extension`。服务器目录只持有 `docker-compose.prod.yml` 和 `.env.test`/`.env.prod`；流水线同步 Compose 文件，但不覆盖环境文件中的数据库、JWT 和 sub2api 配置。

如果是已有 `aux-system` 部署，先检查旧目录和数据卷再改路径。Compose project 名或卷名变化可能创建新卷，不能直接删除旧卷；应先执行 `docker volume inspect`、备份 `/app/data`，再迁移图片和其他系统数据。

数据库迁移是显式运维步骤：新版本新增 `pages`、`image_assets` 等表或字段时，先在目标数据库执行 `make migrate`（或 `go run ./cmd/server -migrate`），再启动/切换应用镜像。正式服务启动不会自动迁移，部署工作流也不会隐式改数据库 schema。

开发 Compose `deploy/docker-compose.yml` 含独立 `aux-postgres`，只用于本地开发。不要把开发 PostgreSQL、默认密码和 `SUB2API_BASE_URL` 带进生产模板。

## 图片资源持久化

- 容器内资源目录：`/app/data/assets`。
- Compose 将 `/app/data` 挂载为持久卷；数据库 `image_assets.path` 只记录安全相对文件名。
- 上传接口：`POST /api/aux/admin/assets`，管理列表：`GET /api/aux/admin/assets`，公开读取：`GET /api/aux/assets/:id`。
- 上传限制：PNG、JPEG、GIF、WebP，单文件最大 10MB。
- 不能把图片二进制写入 PostgreSQL，也不能在页面元数据中写宿主机绝对路径。
- 页面元数据中的 logo/trusted partner icon 使用浏览器可访问的完整 HTTP(S) URL；URL 应从 `/admin/assets` 列表复制。
- 迁移或更换 Compose project 前先备份 `/app/data/assets`；只备份数据库不能恢复图片文件。

## NGINX 与 HTTPS

宿主机 NGINX 配置位于：

- `deploy/nginx/nginx.conf`
- `deploy/nginx/conf.d/sub2api-extension.conf`
- `deploy/nginx/snippets/sub2api-extension-proxy.conf`

生产 Compose 默认只绑定 `127.0.0.1:8787`，公网 HTTPS 由 NGINX 反代。证书路径必须使用：

```text
/etc/nginx/certs/<domain>/fullchain.pem
/etc/nginx/certs/<domain>/privkey.pem
```

修改域名后执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://<domain>/health
```

不要改回 `/etc/letsencrypt/live`。因为页面需要被 sub2api iframe 嵌入，NGINX 不应添加 `X-Frame-Options`；同时保留 HTTPS、`nosniff`、HSTS 和严格 referrer policy。

## 健康检查与故障排查

容器健康检查访问容器内 `http://localhost:8787/health`。部署失败时按顺序检查：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail=200 aux-backend
curl -v http://127.0.0.1:8787/health
docker network inspect sub2api-network
```

公网健康检查失败但容器健康时，检查 DNS、443 防火墙、证书路径、NGINX upstream 和 `PUBLIC_URL`。GHCR 拉取失败时检查 `GHCR_PAT` 的 `read:packages` 权限、组织 SSO 授权和服务器 `docker login ghcr.io`。

若页面接口返回 404 或图片返回 404，先区分三类问题：页面记录未 seed/已停用、数据库 schema 未迁移、或 `/app/data` 卷未挂载/换成了新卷。不要通过重新运行 seed 来修复图片丢失，先确认卷和文件路径。

## 发布检查清单

- [ ] 代码在 `test` 环境验证通过
- [ ] 生产从 `main` 触发，版本号不可变且符合 `v?MAJOR.MINOR.PATCH` 规则
- [ ] `production` Environment 审批已完成
- [ ] 数据库、JWT、sub2api 和数据卷没有跨环境复用
- [ ] Compose config、容器健康检查和公网 `/health`、`/p/home` 均通过
- [ ] 失败时保留日志并确认自动回滚结果
- [ ] 升级后图片资源仍能通过 `/api/aux/assets/:id` 访问

## 相关文档

- `.github/CICD.md`
- `deploy/nginx/README.md`
- `deploy/.env.test.example`
- `deploy/.env.prod.example`
