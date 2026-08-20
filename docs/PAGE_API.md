# 动态页面管理员 API

sub2api-extension 已支持通过 HTTP API 管理数据库中的动态页面。页面内容不会在访问时执行 seed 脚本；API 直接读写 extension 自己的 PostgreSQL `pages` 表。

## 鉴权

页面管理 API 位于 `/api/aux/admin/pages`，必须携带附属系统管理员会话：

```http
X-Aux-Session: <extension-session-jwt>
```

会话有两种获取方式：

1. 从 sub2api iframe 进入时，由前端把 sub2api token 提交到 `POST /api/aux/admin/session`，服务端验证管理员身份后签发会话。
2. 独立登录 `POST /api/aux/admin/login`，提交管理员邮箱和密码，服务端代理 sub2api 登录后签发会话。

不要把 sub2api 的 `token` 或账号密码直接放在页面 CRUD 请求中。不要把密码写入 shell 历史；推荐使用本仓库的 `tools/page-admin.py`，它会隐藏式读取密码。

## 端点

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/aux/admin/pages` | 列出全部页面，不返回正文 |
| `POST` | `/api/aux/admin/pages` | 创建页面 |
| `GET` | `/api/aux/admin/pages/:id` | 获取页面详情和正文 |
| `GET` | `/api/aux/admin/pages/slug/:slug` | 按 slug 获取启用的管理员页面 |
| `PUT` | `/api/aux/admin/pages/:id` | 更新页面（当前服务要求提交完整页面输入） |
| `DELETE` | `/api/aux/admin/pages/:id` | 删除页面，历史埋点保留 |

成功响应统一为：

```json
{"code": 0, "message": "success", "data": {}}
```

## 创建页面

```bash
curl -fsS "$AUX_BASE/api/aux/admin/pages" \
  -H "X-Aux-Session: $AUX_SESSION" \
  -H 'Content-Type: application/json' \
  -d @- <<'JSON'
{
  "slug": "docs",
  "title": "产品文档",
  "visibility": "public",
  "content_type": "html",
  "content_html": "<main><h1>产品文档</h1></main>",
  "content_react": "",
  "metadata": {
    "description": "动态页面",
    "logo": "https://aux.example.com/api/aux/assets/2",
    "menu_icon": "file-text"
  },
  "enabled": true
}
JSON
```

字段约束：`slug` 只能使用小写字母、数字和连字符；`visibility` 是 `public` 或 `admin`；`content_type` 是 `html` 或 `react`；单页 HTML/React 内容上限 256 KiB；`metadata.logo` 如果存在必须是 `http://` 或 `https://` 地址。公开页面访问路径为 `/p/<slug>`，管理员页面访问路径为 `/admin/p/<slug>`。管理员页面可在 `metadata.menu_icon` 中设置侧边栏图标名（如 `file-text`、`activity`、`bar-chart-3`），仅 `visibility=admin` 且 `enabled=true` 的页面会进入控制台动态菜单。

官网首页 `/p/home` 支持通过元数据覆盖以下入口链接（值可以是相对路径，也可以是完整的 `http://` / `https://` 地址；也支持 `mailto:` 和 `tel:`）：

| 元数据键 | 官网入口 |
| --- | --- |
| `console_href` | 控制台 |
| `api_docs_href` | API 文档（开发者区与页脚） |
| `usage_guide_href` | 使用指南 |
| `contact_sales_href` | 联系商务 |
| `terms_href` | 服务条款 |

值为空时保留官网内置的页内锚点。动态 HTML 沙箱会把非页内链接交给宿主页面做顶层导航，因此链接到本系统、其他域名或完整 URL 都不会在 opaque-origin iframe 内加载，不会触发开发环境 `origin=null` 的 CORS 空白页。

## 更新、启停和删除

更新时先读取详情，再提交修改后的完整 JSON：

```bash
curl -fsS "$AUX_BASE/api/aux/admin/pages/12" \
  -H "X-Aux-Session: $AUX_SESSION" > page.json
# 修改 page.json 后：
curl -fsS -X PUT "$AUX_BASE/api/aux/admin/pages/12" \
  -H "X-Aux-Session: $AUX_SESSION" \
  -H 'Content-Type: application/json' \
  --data-binary @page.json
```

将 `enabled` 改为 `false` 可停用页面；删除不会删除页面埋点历史。

## 命令行工具

无需第三方 Python 依赖：

```bash
export AUX_API_BASE_URL='https://aux.example.com/api/aux'
export AUX_ADMIN_EMAIL='admin@example.com'
tools/page-admin.py list
tools/page-admin.py create --slug docs --title '产品文档' --content-file docs.html
tools/page-admin.py update 12 --title '新版文档' --content-file docs.html
tools/page-admin.py enable 12
tools/page-admin.py disable 12
tools/page-admin.py delete 12
```

首次调用如果没有 `AUX_SESSION_TOKEN`，工具会交互式隐藏输入管理员密码，调用 `/admin/login` 获取短期附属会话。自动化环境可预先设置 `AUX_SESSION_TOKEN`，或通过安全的 secret 注入 `AUX_ADMIN_EMAIL` / `AUX_ADMIN_PASSWORD`。工具只输出 API 数据，不输出密码和会话 token。

`metadata` 使用 JSON 文件传入：

```bash
tools/page-admin.py update 12 --metadata-file metadata.json
```

## 错误和安全

- `401`：缺少、过期或无效的 `X-Aux-Session`。
- `403`：登录身份不是管理员，或账号要求暂不支持的二次验证。
- `409`：slug 已被其他页面占用。
- `400`：字段格式、内容大小或 logo URL 不合法。
- `5xx`：数据库或 sub2api 服务不可达；不要重试登录密码，先检查服务状态。

生产环境建议通过 NGINX 的 HTTPS 域名调用 API，并限制管理 API 的网络访问范围。该 API 使用与控制台相同的管理员权限，不提供匿名写入页面的接口。
