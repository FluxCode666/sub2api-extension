# sub2api 集成配置指南

本指南说明如何在不修改 sub2api 代码的前提下，通过 `home_content` 嵌入 TERALEMO 官网，并通过 `custom_menu_items` 将 sub2api-extension 管理页面嵌入 sub2api 控制台。

sub2api-extension 根路径 `/` 会跳转到控制台 `/admin/dashboard`。原硬编码官网已迁移到数据库动态页面 `/p/home`，应将该路径作为 sub2api `home_content` 的 URL；Sub2API 官方页面仍可通过 `/p/sub2api-home` 访问。

官网内容在页面管理中维护。管理员可在 `/admin/pages` 编辑数据库中的 `home` 页面，公开访问路径为 `/p/home`。

官网页脚入口可通过 `home` 页元数据配置：`console_href`、`api_docs_href`、`usage_guide_href`、`contact_sales_href`、`terms_href`。值可填写完整的 `http://` / `https://` 地址；为空时沿用官网默认的页内锚点。

## 架构

```text
sub2api 首页
  home_content URL iframe -> sub2api-extension /p/home

sub2api 控制台
  custom_menu_items -> 带 token 的 iframe
    -> sub2api-extension /admin/pages 或 /admin/dashboard
      -> AdminGuard 验证或换取 aux 会话
```

sub2api-extension 使用自己的 PostgreSQL 保存页面访问和功能点击数据。管理员身份通过 sub2api iframe token 或独立账号密码登录验证。页面上架功能会额外使用具备读写权限的连接访问 sub2api PostgreSQL 的 `settings` 表，同步 `custom_menu_items`；不会把 sub2api 的业务表映射到扩展 Ent schema。

## 1. 部署 sub2api-extension

### 1.1 开发或单机 Compose

```bash
cd sub2api-extension/deploy
cp .env.dev.example .env.dev
```

至少设置：

```bash
SUB2API_EXTENSION_POSTGRES_PASSWORD=<强密码>
SUB2API_EXTENSION_JWT_SECRET=<openssl rand -hex 32 的输出>
SUB2API_BASE_URL=http://sub2api:8080
# 页面上架功能（可选，但启用上架开关时必须配置）
SUB2API_DATABASE_HOST=postgres
SUB2API_DATABASE_PORT=5432
SUB2API_DATABASE_USER=sub2api
SUB2API_DATABASE_PASSWORD=<sub2api 数据库密码>
SUB2API_DATABASE_DBNAME=sub2api
SUB2API_EXTENSION_PUBLIC_URL=https://aux.example.com
```

启动并检查：

```bash
docker compose -f docker-compose.dev.yml --env-file .env.dev up -d
curl http://localhost:8787/health
```

健康检查应返回：

```json
{"status":"ok","service":"sub2api-extension"}
```

`aux-postgres` 是 sub2api-extension 的独立数据库，不是 sub2api PostgreSQL。

### 1.2 生产部署

生产 Compose 使用外部 PostgreSQL：

```bash
cd sub2api-extension/deploy
cp .env.example .env
# 填写 SUB2API_EXTENSION_IMAGE、SUB2API_EXTENSION_IMAGE_TAG、DATABASE_*、SUB2API_BASE_URL、SUB2API_EXTENSION_JWT_SECRET
docker compose -f docker-compose.yml --env-file .env up -d
```

## 2. 配置首页与管理菜单

### 2.1 配置 home_content

在 sub2api「站点设置」的「首页内容」中填写 sub2api-extension 的公开动态页面 URL：

```text
https://aux.example.com/p/home?theme=light
```

sub2api 会把 URL 作为 iframe 地址。`theme=light` 或 `theme=dark` 可指定初始主题，访客仍可在官网右上角手动切换。

### 2.2 配置 custom_menu_items

1. 登录 sub2api 管理后台。
2. 进入「站点设置」。
3. 找到 "Custom Menu Items"。
4. 添加以下管理员菜单项：

```json
[
  {
    "id": "aux-dashboard",
    "label": "内容分析",
    "icon_svg": "",
    "url": "https://aux.example.com/admin/dashboard",
    "page_slug": "",
    "visibility": "admin",
    "sort_order": 100
  }
]
```

字段约束：

| 字段 | 要求 |
|------|------|
| `id` | 菜单唯一标识 |
| `label` | 控制台显示名称 |
| `url` | 浏览器可访问的 sub2api-extension `/admin/dashboard` 或 `/admin/pages` 完整 URL |
| `page_slug` | 必须留空，确保走 iframe 模式并附加 token |
| `visibility` | 使用 `admin` |
| `sort_order` | 菜单排序数字 |

保存后，sub2api 会通过 `buildEmbeddedUrl` 附加 `user_id`、`token`、`theme`、`lang`、`ui_mode` 等参数。sub2api-extension 的 `AdminGuard` 使用 token 验证管理员身份并签发自己的会话。

### 2.3 从页面管理直接上架

配置 `SUB2API_DATABASE_*` 和 `SUB2API_EXTENSION_PUBLIC_URL` 后，打开扩展的「页面管理」，每个页面会显示「sub2api」上架开关。开启后会在 sub2api `settings` 表的 `custom_menu_items` 数组中创建/更新一项；菜单名称和可见角色（普通用户/管理员）可在页面编辑框中单独配置。扩展使用稳定且符合 sub2api 长度限制的 `aux-page-<页面 ID>` 作为菜单 ID，只修改自己的菜单项，其他手工配置的菜单会保留。关闭开关、删除页面或修改页面 URL 时会同步移除/更新对应项。

页面的访问路径仍由页面自身可见性决定：公开页使用 `/p/<slug>`，管理员页使用 `/admin/p/<slug>`；sub2api 可见角色只控制菜单是否展示。`SUB2API_EXTENSION_PUBLIC_URL` 必须是浏览器可访问的完整 origin，不能填写 `aux-backend` 等 Docker 内部服务名。

## 3. 页面管理与 Dashboard

页面管理路径是：

```text
/admin/pages
```

其中 `home` 页面保存迁移后的官网首页 HTML。编辑后保存到数据库，公开页面 `/p/home` 会读取最新内容；Sub2API 官方页面仍保留在 `/p/sub2api-home`。

Dashboard 的规范路径是：

```text
/admin/dashboard
```

Dashboard 列出当前注册页面，标题和路径都可点击：

| 页面 | 路径 |
|------|------|
| TERALEMO 官网（数据库动态页面） | `/p/home` |
| Sub2API 官网（数据库动态页面） | `/p/sub2api-home` |
| 分析仪表盘 | `/admin/dashboard` |
| 页面管理 | `/admin/pages` |
| 静态内容示例 | `/admin/examples/content` |
| 交互与埋点示例 | `/admin/examples/interaction` |
| API 请求示例 | `/admin/examples/api` |

旧页面的历史埋点仍保存在数据库，但不会显示在当前 Dashboard，也不计入当前页面汇总。

## 4. URL 选择

iframe URL 由用户的浏览器访问，必须使用浏览器能够解析的地址。

### 生产环境

推荐使用 HTTPS 公网域名：

```text
https://aux.example.com/admin/dashboard
```

生产 Compose 默认将 aux-backend 绑定在宿主机 `127.0.0.1:8787`，公网请求应由
宿主机 NGINX 终止 TLS 并反代到该端口。配置模板位于 `deploy/nginx/`；请将其中的
`aux.example.com` 替换为实际域名，并将对应证书放到 `/etc/nginx/certs/<域名>/`。

图片资源页返回的相对路径会按浏览器当前 origin 补全。因此通过 NGINX 域名访问并复制
图片 URL 时，应得到类似以下地址，并将它写入页面 `metadata.logo`：

```text
https://aux.example.com/api/aux/assets/2
```

sub2api-extension 到 sub2api 的服务端通信可继续使用 Docker 网络地址：

```text
SUB2API_BASE_URL=http://sub2api:8080
```

### 本地环境

浏览器直接访问本机时可使用：

```text
http://localhost:8787/admin/dashboard
```

不要把 `http://aux-backend:8787/...` 直接作为 iframe URL，除非用户浏览器的 DNS 或 hosts 能解析 `aux-backend`。

## 5. CSP

sub2api 会从 `custom_menu_items[].url` 提取 origin，并自动加入 `Content-Security-Policy: frame-src`。保存菜单设置后通常无需手工修改 CSP 或重启 sub2api。

若 iframe 被拦截：

1. 检查浏览器 Console 中的 `frame-src` 错误。
2. 确认菜单 URL 是完整的 `http://` 或 `https://` URL。
3. 重新保存 `custom_menu_items`，让 sub2api 刷新允许的 origin。


## 6. 验收清单

- [ ] sub2api-extension `/health` 返回 200。
- [ ] sub2api-extension 能连接自己的 PostgreSQL。
- [ ] `SUB2API_BASE_URL` 指向可用的 sub2api 后端。
- [ ] sub2api `home_content` 已设置为 sub2api-extension `/p/home` 动态页面 URL。
- [ ] sub2api 首页能展示 TERALEMO 官网，亮色/暗色切换正常。
- [ ] sub2api `custom_menu_items` 已添加 `/admin/dashboard`。
- [ ] sub2api `custom_menu_items` 已添加 `/admin/pages`。
- [ ] `page_slug` 为空且 `visibility` 为 `admin`。
- [ ] 管理员点击「内容分析」后 iframe 能显示 Dashboard。
- [ ] 页面管理保存 `home` 后，刷新公开首页可读取最新 HTML。
- [ ] Dashboard 中当前注册页面链接均可打开。
- [ ] 交互示例的操作会进入 Dashboard 功能使用度。
- [ ] API 示例能读取 `/api/aux/admin/examples/status`。
- [ ] 非管理员或失效 token 无法访问管理端 API。

## 7. 故障排查

### 点击菜单后进入登录页

iframe 没有提供有效 token，或附属会话已经失效：

- 确认 `page_slug` 为空。
- 确认菜单 URL 使用 `/admin/dashboard`。
- 检查 iframe URL 是否包含 sub2api 生成的 token 参数。
- 也可以在 `/login` 使用 sub2api 管理员账号密码建立独立 aux 会话。

### 显示无法连接 sub2api

- 从 sub2api-extension 运行环境检查 `SUB2API_BASE_URL`。
- 确认 sub2api `/api/v1/auth/me` 和登录接口可用。
- 同 Docker 网络部署时优先使用 `http://sub2api:8080`。

### iframe 空白

- 查看浏览器 Console 的 CSP 和网络错误。
- 直接在浏览器访问菜单中的 sub2api-extension URL。
- 确认 iframe URL 使用浏览器可解析的域名，而不是仅容器内部可解析的服务名。

### API 示例返回 401

`GET /api/aux/admin/examples/status` 位于管理员守卫内：

- 确认浏览器已有 aux 管理员会话。
- 检查请求是否携带 `X-Aux-Session`。
- 重新从 sub2api 菜单进入或在 sub2api-extension 登录页重新登录。
