# 安装、发布与控制台更新

推送新版本 tag 后，GitHub Actions 只进行质量检查、Docker 构建和 Release 发布。生产服务器继续运行原版本；管理员在控制台点击左上角版本号，查看发布说明后选择更新。

## 首次安装或从旧版本启用更新服务

旧版本没有更新接口，首次需要手动安装带更新服务的新版本。此步骤只做一次，之后可在控制台更新应用。

1. 备份 PostgreSQL 数据及上传文件数据卷。保留既有 `COMPOSE_PROJECT_NAME`、容器名称、网络、端口、数据库、JWT 与 `/app/data` 数据卷配置。可用 `docker inspect <当前容器> --format '{{index .Config.Labels "com.docker.compose.project"}}'` 确认既有 project。
2. 从目标正式 Release 下载 `docker-compose.yml`、`docker-compose.update.yml` 和本指南，放到同一个部署目录。合并既有网络和挂载定制；不要盲目覆盖自定义 Compose。
3. 在此目录的 `.env` 填写下列配置。示例 `v0.6.0` 需替换为实际已发布的版本；现有安装必须填写原 project 名。

```dotenv
COMPOSE_PROJECT_NAME=sub2api-extension
SUB2API_EXTENSION_IMAGE=ghcr.io/fluxcode666/sub2api-extension
SUB2API_EXTENSION_IMAGE_TAG=v0.6.0
SUB2API_EXTENSION_IMAGE_REF=
SUB2API_EXTENSION_UPDATER_TAG=v0.6.0
SUB2API_EXTENSION_DEPLOY_PATH=/opt/sub2api-extension
SUB2API_EXTENSION_RELEASE_REPOSITORY=FluxCode666/sub2api-extension
SUB2API_EXTENSION_GITHUB_TOKEN=
```

`SUB2API_EXTENSION_DEPLOY_PATH` 必须是宿主机实际部署目录的绝对路径。更新服务将其挂载到容器内的同一路径，让 Compose 正确解析已有宿主机挂载。使用自定义 project 时写入 `.env`，不要仅在启动命令中临时传 `-p`。当前更新服务支持单机 Docker Compose、上述两个 Compose 文件和 `.env`；多副本、Swarm、Kubernetes 或额外的 Compose 配置文件应由自己的部署系统更新。

4. 准备镜像凭据目录。公开镜像只需空目录；私有镜像需登录，凭据会写在此目录中，不要提交到 Git。

```bash
cd /opt/sub2api-extension
mkdir -p docker-config
chmod 700 docker-config
# 仅私有镜像需要：交互式输入具有 read:packages 权限的令牌
docker --config ./docker-config login ghcr.io
```

私有 GitHub 仓库需在 `.env` 配置可读取此仓库 Releases 的 `SUB2API_EXTENSION_GITHUB_TOKEN`。GitHub API 令牌与 Docker Registry 凭据用途不同，查询发布成功不代表镜像一定可拉取。令牌不发送给浏览器；不应把真实 `.env` 或 `docker-config/config.json` 加入仓库。

5. 验证并启动。以下命令适用于部署目录内操作，`.env` 中的其他必填字段沿用 `deploy/.env.example`。

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.update.yml config -q
docker --config ./docker-config compose --env-file .env -f docker-compose.yml -f docker-compose.update.yml pull
docker compose --env-file .env -f docker-compose.yml -f docker-compose.update.yml run --rm --no-deps aux-migrate
docker compose --env-file .env -f docker-compose.yml -f docker-compose.update.yml up -d --no-deps aux-backend aux-updater
docker compose --env-file .env -f docker-compose.yml -f docker-compose.update.yml ps
curl --fail http://127.0.0.1:8004/health
```

端口若已定制，请替换健康检查命令。确认页面、图片、发票资源正常，再进入控制台检查版本。正式镜像通过构建参数提供版本号；源码开发运行默认显示开发版本。

## 管理员更新

1. 点击控制台左上角的版本号。弹窗显示当前构建版本、最新正式 Release、发布时间和中文说明；点击“重新检查”可重试查询，GitHub 查询有五分钟缓存。
2. 确认发布说明与备份后，点击“更新到最新版本”并确认。服务端会重新查询正式 Release，拒绝过期目标、降级和重复任务。
3. 更新服务按 Release 中 `release-manifest.json` 的固定镜像摘要下载镜像，先执行一次性 `aux-migrate`，再只重建 `aux-backend`。数据库服务、上传资源卷、更新服务和其他应用不会被重建。
4. 应用重启期间可能短暂断开，弹窗会自动重新获取任务状态。关闭弹窗或刷新页面不会取消更新，重新打开即可恢复查看。
5. 新容器使用预期镜像并通过 Docker 健康检查后，写回 `.env` 的镜像版本和摘要引用，点击“刷新控制台”加载新的前端资源。

如果没有启用 `aux-updater`，仍可查询发布说明，但更新按钮不可用。较早的 Release 没有更新清单时需手动安装。预发布版本不会作为控制台更新目标，也不覆盖 `latest`。

## 失败恢复

- 镜像拉取或迁移失败：不切换应用。检查私有镜像凭据、数据库连接、迁移状态和磁盘空间。
- 应用重建或健康检查失败：用记录的本地旧镜像 ID 重建应用并检查健康，不依赖可变的 `latest` 标签。成功回退后会在 `.env` 中保存原版本和旧镜像引用。
- 更新服务中断：任务保存在独立命名卷中；重新启动后先恢复未完成任务的原镜像，再接受新任务。
- 自动回退失败：停止接受新更新，管理员需检查应用与迁移容器。修复并确认原版本正常后，可停止更新服务，备份其状态卷内 `job.json`，移走该状态文件，再启动更新服务。

**回退仅覆盖应用镜像，不撤销数据库迁移。** 跨版本迁移必须保持向后兼容；涉及不兼容 schema、网络、必填环境变量或 Compose 变更的版本，应说明维护步骤并更新发布清单协议，不能通过当前清单自动升级。旧镜像在确认新版本稳定前不得被外部清理任务删除。

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.update.yml logs --tail=100 aux-updater aux-backend
docker logs <project>-aux-update-migrate
docker compose --env-file .env -f docker-compose.yml -f docker-compose.update.yml ps
```

迁移容器在完成或可清理的失败后会删除，若已不存在，请检查数据库状态后再重试。更新服务不向控制台返回 Docker 原始输出，避免泄露凭据。

手动切换版本时，先停用更新服务避免并发。修改 `.env` 的 `SUB2API_EXTENSION_IMAGE_TAG`，并清空优先级更高的 `SUB2API_EXTENSION_IMAGE_REF`，随后显式拉取镜像、执行迁移、重建应用并验证健康状态。不要运行 `down -v`，这会删除持久数据卷。

## 更新服务本身

`SUB2API_EXTENSION_UPDATER_TAG` 固定更新服务版本，更新应用时不改变它，避免执行者在更新中途被替换。后续若发布说明要求更新服务升级，在没有活动任务时修改此值并单独拉取、重建 `aux-updater`；保留其状态卷与相同部署目录。

更新服务需要 Docker socket 和部署目录写权限，因此具备管理该宿主机 Docker 的能力。该权限仅授予独立更新容器，主应用仍以非 root 身份运行；两者通过组权限为 `1000` 的 Unix socket 通信，不公开更新服务的 TCP 端口。部署目录由可信运维人员管理，避免同时从终端和控制台修改部署。
