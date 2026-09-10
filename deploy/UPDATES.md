# 安装、发布与控制台更新

推送新版本 tag 后，GitHub Actions 只做质量检查、Docker 镜像构建、二进制更新包构建和 Release 发布。生产服务器继续运行当前版本；管理员在控制台点击左上角版本号后主动更新。

## 首次安装或从旧版本升级

1. 备份 PostgreSQL 数据和 `/app/data` 上传资源。保留既有端口、数据库、JWT 和数据卷配置。
2. 从目标正式 Release 下载 `deploy/docker-compose.yml`、`deploy/UPDATES.md` 和对应应用镜像。生产 Compose 只包含 `aux-migrate` 与 `aux-backend`，不需要 `docker-compose.update.yml`、`aux-updater` 或 Docker socket。
3. 在部署目录的 `.env` 中配置应用镜像、外部 PostgreSQL、Sub2API 地址和固定 JWT 密钥：

```dotenv
SUB2API_EXTENSION_IMAGE=ghcr.io/fluxcode666/sub2api-extension
SUB2API_EXTENSION_IMAGE_TAG=v0.7.0
SUB2API_EXTENSION_RELEASE_REPOSITORY=FluxCode666/sub2api-extension
SUB2API_EXTENSION_GITHUB_TOKEN=
```

私有仓库只需填写 Release 查询令牌；令牌只在服务端使用，不会发送给浏览器。

4. 验证并启动：

```bash
docker compose --env-file .env -f docker-compose.yml config -q
docker compose --env-file .env -f docker-compose.yml pull
docker compose --env-file .env -f docker-compose.yml up -d
curl --fail http://127.0.0.1:8004/health
```

首次从旧版本升级时，若旧部署目录还有 `docker-compose.update.yml`，可以停止并移除该 override；它不再参与启动，也不会删除应用数据卷。

## 管理员更新

1. 点击控制台左上角版本号，查看当前版本、最新正式 Release 和中文发布说明。
2. 确认备份后点击“更新到最新版本”。服务端会重新读取正式 Release，拒绝过期目标、降级目标和无效版本。
3. 应用进程下载当前平台的 `sub2api-extension_linux_amd64.tar.gz` 或 `sub2api-extension_linux_arm64.tar.gz`，验证 GitHub 下载地址和 `checksums.txt` 的 SHA-256，然后在可执行文件同一目录原子替换 `aux-server`，并保留 `aux-server.backup`。
4. 更新完成后重启应用。Docker 部署使用 `docker compose restart aux-backend`；二进制部署按 systemd 或进程管理器的方式重启。重启前不要执行 `docker compose down -v`，否则会删除持久数据卷。

Release 中没有当前平台更新包时，只能按发布说明手动更新。较早的只含镜像摘要的 Release 仍可查看说明，但不会显示可更新按钮。

## 回退与失败处理

- 下载、校验或替换失败时，当前进程继续使用旧二进制，不会修改数据库。
- 替换成功后若新版本启动异常，停止应用，将 `aux-server.backup` 原子移回 `aux-server`，再启动旧版本。数据库迁移是前向的，二进制回退不会撤销迁移。
- 更新请求可能因代理超时而断开，但服务端使用独立的 15 分钟上下文继续执行；不要重复点击更新。重新打开版本弹窗查看任务状态。
- 运行用户必须对当前可执行文件所在目录有写权限。Docker 镜像已将 `/app` 授权给 `aux` 用户；自定义镜像或 bind mount 需保持相同权限。

## 手动镜像升级

控制台原地更新只影响当前容器的可写层。若要让下一次容器重建也使用新版本，请同步修改 `.env` 的 `SUB2API_EXTENSION_IMAGE_TAG`，然后执行：

```bash
docker compose --env-file .env -f docker-compose.yml pull
docker compose --env-file .env -f docker-compose.yml up -d
```

不要使用可变的 `latest` 作为长期回退依据，生产环境建议固定正式 tag，并在升级前保留数据库和上传资源备份。
