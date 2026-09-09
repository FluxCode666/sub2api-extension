# Sub2API Extension CI/CD 指南

应用镜像包含 Go 服务和已构建的 React 前端。版本 tag 触发发布，不触发生产部署；生产更新由管理员主动执行。

## 流水线

| 工作流 | 触发方式 | 结果 |
|---|---|---|
| `ci.yml` | main push、Pull Request、可复用调用 | Go race test、golangci-lint v2.9、前端 typecheck / test / build |
| `security-scan.yml` | Pull Request、定时 | Go 漏洞扫描、前端依赖审计 |
| `deploy-test.yml` | test push、手动 | 完整 CI、多架构测试镜像、测试服务器 SSH 部署 |
| `release.yml` | 新 semver tag、选择 tag 手动重试 | 完整 CI、多架构应用与更新镜像、中文 GitHub Release |

```text
push test ── CI ── test-<sha7> / test-latest ── 测试环境
push vX.Y.Z ── CI ── 应用与更新服务镜像 ── GitHub Release
                                               │
                                    管理员查看说明并点击更新
                                               │
                                    迁移 → 重启 → 健康检查
                                               └─ 失败时回退应用镜像
```

## 发布正式版本

1. 确认 CI 和测试环境验证通过，在 `CHANGELOG.md` 添加与本次 tag 对应的版本章节，使用中文说明功能、修复与升级注意事项。将“未发布”章节整理成实际版本，如 `## [0.6.0] - 2026-09-09`。
2. 提交并推送代码，再创建带中文说明的新 tag。示例版本号请替换为尚未发布的新版本：

```bash
git tag -a v0.6.0 -m "v0.6.0：新增 Release 发布及管理员版本更新"
git push origin v0.6.0
```

3. Release 工作流复用完整 CI，再构建 `linux/amd64` 和 `linux/arm64`：

```text
ghcr.io/<owner>/sub2api-extension:<tag>
ghcr.io/<owner>/sub2api-extension:<tag>-updater
```

4. 两个镜像都完成后发布中文 GitHub Release，附件包括镜像摘要清单、两个生产 Compose 文件和 `UPDATES.md`。最新正式版才更新 `latest` / `latest-updater`；`vX.Y.Z-rc.N` 等预发布不会成为最新正式版。
5. 服务器此时仍保持原版本。在管理员控制台点击版本号查看发布，再决定更新时间。

已公开的版本不可覆盖。构建失败时可在 Actions 中重跑失败任务，或选择同一个 tag 手动执行 Release；手动选择分支会被拒绝。预先创建的 draft Release 可以继续发布；不要在构建前手工公开 Release。工作流使用 `GITHUB_TOKEN` 的 `contents: write` 和 `packages: write` 权限，不读取生产 SSH Secrets，也不使用 production Environment 审批或部署 job。

如果 Release 已成功发布但镜像别名更新失败，带版本号和摘要的镜像仍可用于控制台更新；维护者修复别名即可，不应覆盖已发布版本。

## 生产安装与更新

详细步骤见 [deploy/UPDATES.md](../deploy/UPDATES.md)，包括旧版本首次启用、私有镜像凭据、管理员更新、进度重连、故障恢复与手动更新。

生产基础 Compose 运行 `aux-migrate` 和 `aux-backend`，使用外部 PostgreSQL。可选 `docker-compose.update.yml` 增加独立 `aux-updater`。配置示例见 [deploy/.env.example](../deploy/.env.example)。更新服务不修改已有端口、JWT、数据库和数据卷；不要在启用时更换已有 Compose project。

运行时不会自动迁移。控制台更新由独立更新服务显式运行一次性迁移，迁移成功后才重启应用。应用回退不撤销数据库变更；发布迁移须考虑旧版兼容性。

## 测试环境部署

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


## 测试环境 Secrets

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


创建 GitHub Environment `test` 并配置上述 Secrets。测试与生产的服务器目录、端口、数据库、JWT、sub2api 环境和数据卷必须隔离。测试部署默认目录 `/opt/sub2api-extension-test`，必须事先准备 `.env.test` 和外部数据库；字段参考 `deploy/.env.test.example`。工作流会同步生产基础 Compose 作为测试 Compose，执行迁移和健康检查，失败时恢复上一镜像标签。

## 公网入口与数据

- 生产默认只绑定 `127.0.0.1:8004`，由宿主机 NGINX 提供 HTTPS，参见 [deploy/nginx/README.md](../deploy/nginx/README.md)。
- 图片与发票位于 `/app/data/assets`，由持久卷承载，数据库仅保存元数据；备份必须同时覆盖数据库和此目录。
- 更新后验证 `/health`、页面访问、上传资源、管理员登录以及 sub2api 嵌入入口。
- 生产发布不再使用 `DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_PASSWORD`、`DEPLOY_SSH_KEY`、`DEPLOY_PATH` 等 SSH Secrets。可按运维策略清理历史生产 Secrets；测试的 `TEST_*` Secrets 继续使用。
