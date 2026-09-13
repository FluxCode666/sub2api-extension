# sub2api 集成配置指南

本指南说明如何在不修改 sub2api 代码的前提下，通过 `home_content` 嵌入 Sub2API 官网，并通过 `custom_menu_items` 将 sub2api-extension 管理页面和公开 API 文档嵌入 sub2api 控制台。

sub2api-extension 根路径 `/` 会跳转到控制台 `/admin/dashboard`。Sub2API 官网是独立 React 页面 `/sub2api-home`，可通过 `/embed` 嵌入其他系统；公开 API 文档位于 `/api-docs`。管理员创建的动态页面通过 `/p/:slug` 按需加载，本系统不预置或依赖名为 `home` 的动态页面。

## 架构

```text
sub2api 首页
  home_content URL iframe -> sub2api-extension /embed 或 /sub2api-home

sub2api 控制台
  custom_menu_items -> 带 token 的 iframe
    -> sub2api-extension /admin/pages 或 /admin/dashboard
      -> AdminGuard 验证或换取 aux 会话

公开动态页面（可选）
  /p/:slug -> pages 表中的已启用公开页面
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
SUB2API_REDIS_HOST=redis
SUB2API_REDIS_PORT=6379
SUB2API_EXTENSION_PUBLIC_URL=https://aux.example.com
```

`SUB2API_DATABASE_PASSWORD` 必须与 Sub2API Compose 使用的
`POSTGRES_PASSWORD` 完全一致。`SUB2API_DATABASE_*` 是数据库连接参数，不是
Sub2API HTTP API 配置；扩展不会调用 Sub2API 的首字延迟接口。
促销返利还应配置 `SUB2API_REDIS_HOST`（及对应凭据），这样入账后会立即删除
Sub2API 的用户余额缓存；未配置时数据库余额仍会更新，但网关最多可能在余额缓存 TTL
内显示旧值。

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

## 2. 配置管理菜单与动态页面

### 2.1 配置 home_content

如需将 Sub2API 官网嵌入系统首页，在 sub2api「站点设置」的「首页内容」中填写：

```text
https://aux.example.com/embed
```

sub2api 会把 URL 作为 iframe 地址，官网内容通过 `/admin/homepage` 配置。

官网中跳转到其他页面的链接（导航菜单、接入按钮、控制台、文档、合作伙伴及协议）统一使用顶层导航（`target="_top"`），在当前浏览器标签页打开，不会在官网 iframe 内加载目标页面或新开标签页。`#metrics` 等页内锚点仍在官网内滚动。若宿主 iframe 使用 `sandbox`，需要允许用户点击触发顶层导航（`allow-top-navigation-by-user-activation`）。

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

### 2.4 挂载 API 文档页

扩展内置的 Sub2API 接口文档页是公开静态页面，路径为：

```text
/api-docs
```

它不要求扩展管理员会话，适合直接挂载到 Sub2API 的用户菜单。自定义菜单项必须使用浏览器可访问的完整 HTTPS 地址，并保持 `page_slug` 为空：

```json
[
  {
    "id": "aux-api-docs",
    "label": "API 文档",
    "icon_svg": "",
    "url": "https://aux.example.com/api-docs?embed=1",
    "page_slug": "",
    "visibility": "user",
    "sort_order": 110
  }
]
```

Sub2API 会将该 URL 作为 iframe 打开；`embed=1` 用于收起非必要宿主导航。文档页也识别 `ui_mode=embedded`，因此由 Sub2API 自动附加嵌入参数时无需额外处理。页面示例中的 API 基础地址默认为当前 origin；如果文档页与 API 网关使用不同域名，请在 URL 中传入 `api_base`，例如：

```text
https://aux.example.com/api-docs?embed=1&api_base=https%3A%2F%2Fapi.example.com
```

其他系统可以复用同一个公开 URL：

```html
<iframe
  src="https://aux.example.com/api-docs?embed=1&api_base=https%3A%2F%2Fapi.example.com"
  title="Sub2API API 文档"
  style="width:100%;min-height:720px;border:0"
  loading="lazy"
></iframe>
```

文档页只读取 `api_base` 来替换示例地址，不读取父页面 Cookie、Token 或 DOM。生产环境应继续使用 HTTPS，并确认反向代理没有添加 `X-Frame-Options`；`frame-src` 允许列表由 Sub2API 根据 `custom_menu_items[].url` 的 origin 刷新。

### 2.5 动态配置系统名称与示例模型

管理员可以在扩展管理端的“系统配置”（`/admin/system-config`）修改系统名称和“API 文档调用示例默认模型”。系统名称使用官网配置的 `siteName`，兼容旧配置的 `heroTitle`；默认模型为 `gpt-6-astra`。保存名称时保留官网 Hero 标题。API 文档页眉、页脚、首页预览、快速开始和各接口的 cURL / Python / Go / Java 示例会在下一次打开或刷新时使用新值。配置保存在扩展的 `system_meta` 中，不需要重新部署页面。

## 3. 页面管理与 Dashboard

页面管理路径是：

```text
/admin/pages
```

管理员创建的公开页面通过 `/p/<slug>` 访问，管理员页面通过 `/admin/p/<slug>` 访问。页面是否存在、是否启用和如何展示均由页面管理维护；`/p/home` 若未创建不会被特殊处理，本系统也不会主动跳转或读取它。

Dashboard 的规范路径是：

```text
/admin/dashboard
```

运营中心路径为 `/admin/ops/consumption` 与 `/admin/ops/cost-config`。消费核算趋势图按天展示 API 账号请求量、Token 和 API 成本，支持悬停查看每日 API 成本详情并显示 X/Y 轴刻度；每日明细通过 API / OAuth 账号类型 tab 切换，按日期展示每日汇总，不按账号拆行。OAuth Tab 仅展示当天利润（用户计费），另有独立的 OAuth 回本分析板块展示账号创建时间、过期时间（括号标注剩余天数，空值表示永不过期）、账号级用户计费、采购成本、回本进度、待回本金额和状态；每日明细不展示无法可靠核算的 OAuth 成本和回本进度列。API Tab 展示收入可用时的毛利、税额、税后利润和利润率，没有明确收费字段时这些利润列以不可用占位显示，避免把 provider 实际成本冒充收入。账号成本明细支持账号名或计费组搜索、账号创建时间范围、账号类型和平台筛选，并展示收入、毛利、税额和利润；没有明确收费字段时收入与利润相关列以不可用占位显示。明确收费字段包括 Sub2API `usage_logs` 的 `charged_amount`、`billed_amount`、`user_charge` 或 `request_amount`。OAuth 账号采购成本按账号一次性计入区间总账，不归集到某个使用日。日期范围最多 93 天；全局默认配置、税点和每个账号的独立成本配置写入扩展自有数据库，不会修改 Sub2API 数据库。明确收费字段可用时，税点以百分比配置，例如 `6` 表示 `6%`，区间总账按 `税前利润 = 总收入 − API 成本 − OAuth 采购成本`、`税后利润 = 税前利润 − 总收入 × 税点` 计算。OAuth 账号按账号 ID 配置采购单价，并在筛选范围内按独立账号计入；同一计费组中的 OAuth 记录只计一次采购成本，因此组内 OAuth 账号必须使用相同的有效采购单价。API 账号按账号 ID 配置倍率，优先级为手工覆盖、已同步倍率、Sub2API 当前 `accounts.rate_multiplier`，都不存在时才使用全局默认倍率；同一计费组中的多个 API 账号分别按各自有效倍率计算后汇总，账号成本明细会列出组内全部账号及倍率。API 与 OAuth 账号也可以加入同一计费组，系统会分别套用 API 倍率和 OAuth 采购成本规则后汇总；OAuth 账号的 `account_rate_multiplier` 快照不会被误算为 API 成本。历史 API usage log 优先使用 `account_rate_multiplier` 快照，因此上游倍率后续变化不会改写已经发生的成本。

Dashboard 列出当前注册页面，标题和路径都可点击：

| 页面 | 路径 |
|------|------|
| 分析仪表盘 | `/admin/dashboard` |
| 页面管理 | `/admin/pages` |
| API 文档 | `/api-docs` |
| 系统配置 | `/admin/system-config` |

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

文件管理页中的图片资源 URL 会按浏览器当前 origin 补全。因此通过 NGINX 域名访问并复制
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
- [ ] 如需嵌入官网，sub2api `home_content` 已设置为 `/embed` 或 `/sub2api-home` 的完整 URL，首页能正常展示。
- [ ] sub2api `custom_menu_items` 已添加 `/admin/dashboard`。
- [ ] sub2api `custom_menu_items` 已添加 `/admin/pages`。
- [ ] sub2api `custom_menu_items` 已添加 `/api-docs`（如需在用户菜单展示文档）。
- [ ] `page_slug` 为空且 `visibility` 为 `admin`。
- [ ] 管理员点击「内容分析」后 iframe 能显示 Dashboard。
- [ ] 管理员点击「首字延迟」后，运维看板能从 Sub2API PostgreSQL 读取 `usage_logs.first_token_ms`。
- [ ] 管理员可在「系统日志」查看请求/运行错误，在「操作日志」查看管理员变更记录。
- [ ] 首字延迟看板的日期、时间段、分组、账号和分钟/小时/天粒度筛选能正常刷新火焰图。
- [ ] 管理员点击「消费核算」后，运营中心能按日期范围展示 API 账号收入、API 成本与 API 利润走势，并在区间总账和账号明细中展示 OAuth 一次性采购成本。
- [ ] 管理员在「成本配置」修改税点并保存后，刷新页面仍能读取，消费核算按新税点重新计算税额与税后利润。
- [ ] 管理员在「成本配置」按账号保存 OAuth 单号成本或 API 手工倍率。
- [ ] 「成本配置」可以立即同步 Sub2API 账号倍率，并显示最近同步时间；定时同步间隔由 `SUB2API_EXTENSION_COST_SYNC_INTERVAL_SECONDS` 配置（默认 300 秒）。
- [ ] 上游倍率变化后，历史记录仍按 `usage_logs.account_rate_multiplier` 快照核算，未带快照的新记录才使用当前账号配置。
- [ ] 页面管理创建并启用公开页面后，`/p/<slug>` 可读取最新内容。
- [ ] 未创建的 `/p/home` 不会被系统当作固定首页处理。
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

## Sub2API 官网配置

Sub2API 官网的运营配置位于管理端 `/admin/homepage`，不影响当前系统官网 `/p/home`。配置保存到扩展的 `system_meta`，官网页面和其他嵌入方通过同一份配置读取：

- 公开读取：`GET /api/aux/homepage/config`
- 管理读取：`GET /api/aux/admin/homepage/config`
- 管理保存：`PUT /api/aux/admin/homepage/config`（需要附属管理员会话）
- 官网页面：`/sub2api-home`
- 通用嵌入页面：`/embed`

配置支持 `siteName` 网站名称、`siteLogoUrl` 官网 Logo、`showDevelopersSection` 开关、`showQuickstartSection` 开关、`trustedPartners` 合作伙伴列表和 `integrations` 接入生态列表。`showDevelopersSection` 控制「从代码，到增长」开发者板块及其导航入口，`showQuickstartSection` 控制「START IN MINUTES」快速接入板块，两个开关默认开启；每个接入生态项包含 `name`、`logoUrl`、`documentationUrl`，官网会将其展示为可点击的应用节点；同时支持 `documentationUrl` 使用文档、`termsUrl` 服务条款、`userTermsUrl` 用户条款、`privacyUrl` 隐私协议等链接。链接会在后端保存前清洗，仅允许站内路径、锚点和 `http(s)` URL；所有 Logo 字段支持 `http(s)` URL 或站内绝对路径（例如文件管理页生成的 `/api/aux/assets/2`）。

`developersDocsUrl` 单独配置「BUILT FOR BUILDERS」板块的「接入文档」按钮链接，在后台「品牌与 Hero → 接入文档 URL」中维护。留空时沿用 `documentationUrl`，两者均为空时隐藏按钮；外部文档在新标签页打开。此配置同时适用于独立官网和嵌入页面。

管理端「顶部导航」维护 `navigationItems` 数组，每项包含 `label`（菜单名称，最多 24 个字符）和 `href`（跳转链接），最多 8 项。可以添加、编辑、上移、下移或删除菜单，官网桌面导航和移动菜单按配置顺序展示。「进入控制台」仍使用 `consoleHref` 单独配置。旧配置缺少该字段时沿用原有导航，显式保存空数组可清空左侧菜单。指向 `#developers`、`#quickstart` 的菜单随对应板块开关隐藏，合作伙伴为空时隐藏 `#partners` 菜单；外部 HTTP/HTTPS 链接在新标签页打开。
