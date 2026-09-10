---
name: sub2api-extension-operations
description: 修改或排查 sub2api-extension 的 Docker、Compose、GitHub Actions、GHCR、NGINX、测试/生产部署、图片持久化和回滚时使用。覆盖环境隔离、Secrets、健康检查与证书路径。
---

# sub2api-extension 部署与运维规范

## 项目与兼容标识

- 项目展示名和 GHCR 镜像名：`sub2api-extension`。
- 测试镜像：`ghcr.io/<owner>/sub2api-extension:test-<sha7>` 与 `test-latest`。
- 生产镜像：`ghcr.io/<owner>/sub2api-extension:<version>` 与 `latest`。
- 为兼容既有 sub2api 集成，Compose 服务名仍是 `aux-backend`，API 前缀仍是 `/api/aux/*`；项目环境变量统一使用 `SUB2API_EXTENSION_*` 前缀。GitHub Environment 的部署密钥和变量继续使用无项目前缀的名称。
- 不要把数据库密码、JWT、PAT 或 SSH 私钥写入仓库、页面元数据或动态 HTML。

## GitHub Actions 与更新

- `ci.yml`：main push、PR 与复用调用，执行 Go race test、lint、前端 typecheck/test/build。
- `security-scan.yml`：PR 和定时安全扫描。
- `deploy-test.yml`：test 分支或手动，CI 后构建测试镜像并 SSH 部署测试环境，保留 `test` Environment 的 `TEST_*` Secrets。
- `release.yml`：semver tag 触发，CI 后构建 amd64/arm64 应用镜像和二进制更新包，再发布中文 GitHub Release、镜像摘要清单和部署附件。不连接生产服务器，不使用生产 SSH Secrets 或 deployment job。
- 已公开 tag 不允许覆盖；预发布不覆盖 latest。发布说明从 CHANGELOG.md 中与 tag 对应的中文章节提取。

生产使用基础 `deploy/docker-compose.yml`（aux-migrate、aux-backend、外部 PostgreSQL）。应用进程从固定仓库的最新正式 Release 下载当前平台二进制，校验后原子替换自身并在重启后生效；不需要额外更新容器、Compose override 或 Docker socket。详细安装与故障恢复步骤遵循 `deploy/UPDATES.md`，不要绕过鉴权、版本校验和质量门禁。

更新请求只接受可选的旧页面版本校验，目标版本、下载 URL 和校验文件全部由服务端从 Release 元数据解析；不接受浏览器传入任意镜像、URL 或 shell 命令。应用使用 15 分钟操作上下文、并发互斥、SHA-256 校验和同目录原子替换，失败时恢复旧二进制并保留 `.backup`。更新不会执行数据库迁移；schema 变化仍需通过 `aux-migrate` 发布和部署。

必须保留部署目录的 .env、既有 Compose project、容器名称、网络、端口、数据库、JWT 和资源卷。已有 aux-system 部署要先核对实际 project 和卷，不可擅自改成新的默认名。测试与生产各使用独立配置和数据；开发 Compose 的 PostgreSQL 不带入生产。

## 文件资源持久化

- 容器内资源根目录：`/app/data/assets`；图片位于 `photos/`，发票位于 `invoices/`。
- Compose 将 `/app/data` 挂载为持久卷；数据库 `image_assets.path` 只记录安全相对文件名。
- 上传接口：`POST /api/aux/admin/assets`，管理列表：`GET /api/aux/admin/assets`，公开读取：`GET /api/aux/assets/:id`。
- 上传限制：PNG、JPEG、GIF、WebP，单文件最大 10MB。
- 不能把图片二进制写入 PostgreSQL，也不能在页面元数据中写宿主机绝对路径。
- 页面元数据中的 logo/trusted partner icon 使用浏览器可访问的完整 HTTP(S) URL；URL 应从 `/admin/files` 列表复制。
- 迁移或更换 Compose project 前先备份 `/app/data/assets`；只备份数据库不能恢复上传文件。

## NGINX 与 HTTPS

宿主机 NGINX 配置位于：

- `deploy/nginx/nginx.conf`
- `deploy/nginx/conf.d/sub2api-extension.conf`
- `deploy/nginx/snippets/sub2api-extension-proxy.conf`

生产 Compose 默认只绑定 `127.0.0.1:8004`，公网 HTTPS 由 NGINX 反代。证书路径必须使用：

```text
/etc/nginx/certs/<domain>/fullchain.pem
/etc/nginx/certs/<domain>/privkey.pem
```

域名和证书不由 Compose 或应用环境变量管理；请直接维护 `deploy/nginx/conf.d/sub2api-extension.conf` 或你自己的宿主机 NGINX 配置。修改域名后执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://<domain>/health
```

不要改回 `/etc/letsencrypt/live`。因为页面需要被 sub2api iframe 嵌入，NGINX 不应添加 `X-Frame-Options`；同时保留 HTTPS、`nosniff`、HSTS 和严格 referrer policy。

## 健康检查与故障排查

容器健康检查访问容器内 `http://localhost:8004/health`。部署失败时按顺序检查：

```bash
docker compose -f docker-compose.yml --env-file .env ps
docker compose -f docker-compose.yml --env-file .env logs --tail=200 aux-backend
curl -v http://127.0.0.1:8004/health
docker network inspect sub2api-network
```

公网健康检查失败但容器健康时，检查 DNS、443 防火墙、证书路径、NGINX upstream 和 `PUBLIC_URL`。GHCR 拉取失败时检查 `GHCR_PAT` 的 `read:packages` 权限、组织 SSO 授权和服务器 `docker login ghcr.io`。

若页面接口返回 404 或图片返回 404，先区分三类问题：页面记录未 seed/已停用、数据库 schema 未迁移、或 `/app/data` 卷未挂载/换成了新卷。不要通过重新运行 seed 来修复图片丢失，先确认卷和文件路径。

## 发布检查清单

- [ ] 代码在 `test` 环境验证通过
- [ ] 发布 tag 不可变且符合 semver，CHANGELOG.md 包含对应中文版本说明
- [ ] 镜像和 amd64/arm64 二进制包构建成功后才发布 Release；生产更新由管理员主动发起
- [ ] 数据库、JWT、sub2api 和数据卷没有跨环境复用
- [ ] Compose config、容器健康检查和公网 `/health`、`/p/home` 均通过
- [ ] 失败时保留日志并确认 `.backup` 二进制回退结果
- [ ] 升级后图片资源仍能通过 `/api/aux/assets/:id` 访问

## 相关文档

- `.github/CICD.md`
- `deploy/nginx/README.md`
- `deploy/.env.test.example`
- `deploy/.env.dev.example`
- `deploy/.env.example`
