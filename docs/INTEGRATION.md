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

sub2api-extension 使用自己的 PostgreSQL 保存页面访问、功能点击和运营成本配置数据。管理员身份通过 sub2api iframe token 或独立账号密码登录验证。页面上架功能会额外使用具备读写权限的连接访问 sub2api PostgreSQL 的 `settings` 表，同步 `custom_menu_items`；运维首字延迟看板与运营中心则使用同一连接只读 `usage_logs`、`groups` 和 `accounts` 表，不会把 sub2api 的业务表映射到扩展 Ent schema。

## 1. 部署 sub2api-extension

### 1.1 开发或单机 Compose

先启动 Sub2API 开发 Compose。不要把扩展自己的 `aux-postgres` 当成
Sub2API 数据库；首字延迟看板必须通过同一个 Docker 网络直连 Sub2API 的
`postgres` 服务。

```bash
cd /Users/duegin/project/sub2api/deploy
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml ps
```

该命令默认创建 `deploy_sub2api-network`。如果使用了 `--project-name`，网络名会变成
`<project-name>_sub2api-network`，需要同步填写扩展环境变量
`SUB2API_DOCKER_NETWORK`。

```bash
cd sub2api-extension/deploy
cp .env.dev.example .env.dev
```

至少设置：

```bash
SUB2API_EXTENSION_POSTGRES_PASSWORD=<强密码>
SUB2API_EXTENSION_JWT_SECRET=<openssl rand -hex 32 的输出>
SUB2API_BASE_URL=http://sub2api:8080
SUB2API_DOCKER_NETWORK=deploy_sub2api-network
# 页面上架功能（可选，但启用上架开关时必须配置）
SUB2API_DATABASE_HOST=postgres
SUB2API_DATABASE_PORT=5432
SUB2API_DATABASE_USER=sub2api
SUB2API_DATABASE_PASSWORD=<sub2api 数据库密码>
SUB2API_DATABASE_DBNAME=sub2api
SUB2API_EXTENSION_PUBLIC_URL=https://aux.example.com
```

`SUB2API_DATABASE_PASSWORD` 必须与 Sub2API Compose 使用的
`POSTGRES_PASSWORD` 完全一致。`SUB2API_DATABASE_*` 是数据库连接参数，不是
Sub2API HTTP API 配置；扩展不会调用 Sub2API 的首字延迟接口。

启动并检查：

```bash
docker compose -f docker-compose.dev.yml --env-file .env.dev config -q
docker compose -f docker-compose.dev.yml --env-file .env.dev up -d --build
curl http://localhost:8787/health
```

开发 Compose 会先运行 `aux-migrate` 创建/更新扩展自有 `auxdb` schema，再启动
`aux-backend`。迁移服务不会修改 Sub2API PostgreSQL。

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

管理端必须从 sub2api 的这个菜单入口打开（推荐 URL 使用 `/admin/dashboard`）；不要把不带查询参数的扩展 URL 直接当作已登录入口收藏或访问。sub2api 的登录 JWT 保存在 sub2api 自身的浏览器 origin 中，浏览器不会允许扩展跨 origin 读取它；只有菜单 iframe 注入的 `token`（或扩展自身已有的 `X-Aux-Session`）可以完成免登录进入。扩展会保留入口 URL 上的嵌入参数，根路径重定向不会丢失 `token`。

### 2.3 从页面管理直接上架

配置 `SUB2API_DATABASE_*` 和 `SUB2API_EXTENSION_PUBLIC_URL` 后，打开扩展的「页面管理」，每个页面会显示「sub2api」上架开关。开启后会在 sub2api `settings` 表的 `custom_menu_items` 数组中追加一项；若本扩展自己的 `aux-page-<页面 ID>` 已存在，则只更新这一项。菜单名称和可见角色（普通用户/管理员）可在页面编辑框中单独配置，不会覆盖其他手工菜单。关闭开关、删除页面或修改页面 URL 时会同步移除/更新对应项。

页面的访问路径仍由页面自身可见性决定：公开页使用 `/p/<slug>`，管理员页使用 `/admin/p/<slug>`；sub2api 可见角色只控制菜单是否展示。`SUB2API_EXTENSION_PUBLIC_URL` 必须是浏览器可访问的完整 origin，不能填写 `aux-backend` 等 Docker 内部服务名。

管理页显示的“已上架”不是只看 `aux-page-<页面 ID>` 是否存在。扩展会重新计算期望的 URL、菜单名称和可见角色，并与 sub2api 当前 `custom_menu_items` 中的 URL、名称、角色及 `page_slug` 逐项核对；管理员在 sub2api 中改动任一受管字段后，该页面会显示为“未上架”，可在扩展页面管理中重新保存以恢复同步。

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

运营中心路径为 `/admin/ops/consumption` 与 `/admin/ops/cost-config`。消费核算按天聚合收入、请求量、Token、API 成本、OAuth 账号成本、毛利/税前利润、税额、税后利润和利润率，日期范围最多 93 天；全局默认配置、税点和每个账号的独立成本配置写入扩展自有数据库，不会修改 Sub2API 数据库。税点以百分比配置，例如 `6` 表示 `6%`，并按收入计提：`税额 = 收入 × 税点`，`税前利润 = 收入 − 总成本`，`税后利润 = 税前利润 − 税额`。OAuth 账号按账号 ID 配置采购单价，并在筛选范围内按独立账号计入、归集到首次使用日；API 账号按账号 ID 配置倍率，支持手工覆盖或定时同步 Sub2API `accounts.rate_multiplier`。历史 usage log 优先使用 `account_rate_multiplier` 快照，因此上游倍率后续变化不会改写已经发生的成本。

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


## 发票中心（企业客户）

扩展提供一个可嵌入 Sub2API 的用户端页面 `/invoice`。页面通过
`X-Aux-Token` 验证当前 Sub2API 用户，只展示该用户已完成的余额充值订单，
并按订单的 `amount` 汇总申请金额；订单在首次申请时即被唯一锁定，不能重复开票。
用户填写企业抬头、税号、收票邮箱等资料后提交申请，申请记录和开票文件保存在
扩展自己的数据库/数据卷中，不会写入 Sub2API 业务表。用户还可以点击“保存为默认资料”
保存抬头、税号、邮箱、电话、注册地址和银行信息；下次进入发票中心会自动填充，提交历史
申请时仍会保存一份独立快照。

管理员从扩展控制台的「发票管理」页面处理申请：可标记“开票中”或“已驳回”，
填写备注，并上传不超过 20MB 的 PDF/PNG/JPEG 发票文件。上传完成后状态自动变为
“已开具”，用户可以在嵌入页面下载文件。文件下载同样需要已验证的用户或管理员会话。

「Sub2API 用户端入口」开关是动态上架控制：开启时扩展会在 Sub2API
`settings.custom_menu_items` 中幂等创建/更新 `id=aux-invoice` 的用户菜单，URL 为
扩展公网地址的 `/invoice`；关闭时只移除该受管菜单项，不影响其他自定义菜单。开启
菜单会始终写入内置的收据 SVG 图标，升级后已存在的旧菜单也会在服务启动时幂等补齐。
开启菜单前需要配置 `SUB2API_DATABASE_*` 与 `SUB2API_EXTENSION_PUBLIC_URL`，且公网 URL
必须能被浏览器访问（不能填写 Docker 内部服务名）。

直接访问页面的公开配置端点为 `GET /api/aux/invoices/config`；用户端接口为
`GET/PUT /api/aux/invoices/profile`、`GET /api/aux/invoices/eligible-orders`、
`GET /api/aux/invoices/requests?page=1&page_size=5` 和 `POST /api/aux/invoices/requests`，均要求
Sub2API 注入的 `X-Aux-Token`。资料接口只按已验证用户身份读写，不能通过请求参数访问
其他用户的资料。申请记录接口返回 `items`、`total`、`page`、`page_size`、`total_pages`，
用户端默认每页 5 条并支持滚动加载。管理员接口位于受保护的 `/api/aux/admin/invoices/*`，
列表支持 `page/page_size` 分页，以及 `keyword`（企业名称）、`taxpayer_id`、`start_date/end_date`、
`status` 和 `user_id` 筛选；`GET /api/aux/admin/invoices/users?email=...` 提供按邮箱模糊搜索的
Sub2API 用户下拉选项。管理员还可以调用 `POST /api/aux/admin/invoices/manual`，按 `user_id`、
发票资料和线下转账金额创建没有关联充值订单的开票记录；服务端会重新从 Sub2API 查询并快照用户邮箱/名称，
不会信任请求体中的身份字段。手动记录默认状态为 `PENDING`，后续处理和发票文件上传流程与普通申请一致。

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
- [ ] 管理员点击「首字延迟」后，运维看板能从 Sub2API PostgreSQL 读取 `usage_logs.first_token_ms`。
- [ ] 管理员可在「系统日志」查看请求/运行错误，在「操作日志」查看管理员变更记录。
- [ ] 首字延迟看板的日期、时间段、分组、账号和分钟/小时/天粒度筛选能正常刷新火焰图。
- [ ] 管理员点击「消费核算」后，运营中心能按日期范围展示收入、API 成本、OAuth 成本、毛利/税前利润、税额、税后利润与利润率。
- [ ] 管理员在「成本配置」修改税点并保存后，刷新页面仍能读取，消费核算按新税点重新计算税额与税后利润。
- [ ] 管理员在「成本配置」按账号保存 OAuth 单号成本或 API 手工倍率。
- [ ] 「成本配置」可以立即同步 Sub2API 账号倍率，并显示最近同步时间；定时同步间隔由 `SUB2API_EXTENSION_COST_SYNC_INTERVAL_SECONDS` 配置（默认 300 秒）。
- [ ] 上游倍率变化后，历史记录仍按 `usage_logs.account_rate_multiplier` 快照核算，未带快照的新记录才使用当前账号配置。
- [ ] 页面管理保存 `home` 后，刷新公开首页可读取最新 HTML。
- [ ] Dashboard 中当前注册页面链接均可打开。
- [ ] 交互示例的操作会进入 Dashboard 功能使用度。
- [ ] API 示例能读取 `/api/aux/admin/examples/status`。
- [ ] 非管理员或失效 token 无法访问管理端 API。
- [ ] 管理员可在「发票管理」开关用户端入口，并在 Sub2API 菜单中看到/移除 `发票管理`。
- [ ] Sub2API 用户菜单中的 `发票管理` 包含收据 SVG 图标。
- [ ] 用户端只显示自己的已完成充值订单，提交后订单不可重复选择。
- [ ] 用户保存默认开票资料后，刷新/重新进入页面会自动填充，且只能读取自己的资料。
- [ ] 用户提交申请、管理员更新状态并上传发票文件后，用户可带会话下载文件。
- [ ] 用户申请记录默认每页 5 条，滚动到底部可继续加载；管理员列表可按企业、税号、日期、状态和 Sub2API 用户邮箱筛选并翻页。

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
