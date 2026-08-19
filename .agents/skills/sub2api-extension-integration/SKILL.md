---
name: sub2api-extension-integration
description: 配置或排查 sub2api 与 sub2api-extension 的 iframe、登录会话、custom_menu_items、home_content、域名、CSP 和反向代理集成时使用。不用于普通页面 CRUD 或单纯 Docker 发布。
---

# sub2api-extension 集成与会话规范

sub2api-extension 是独立服务；它不导入 sub2api 后端代码，也不共享 sub2api 数据库。两者只通过 HTTP 身份验证和 iframe 配置连接。修改集成时先确认请求发生在浏览器还是容器内：浏览器需要公网/可解析域名，后端到 sub2api 才可以使用 Docker 内网地址。

## 两条嵌入链路

| 目的 | sub2api 配置 | 推荐 URL |
|---|---|---|
| 首页官网 | `home_content` | `https://<extension-domain>/p/home` |
| 控制台菜单 | `custom_menu_items[].url` | `https://<extension-domain>/admin/dashboard` 或 `/admin/pages` |

`custom_menu_items` 应使用完整 HTTP(S) URL，`page_slug` 留空以走 iframe 模式；sub2api 会附加 `user_id`、`token`、`theme`、`lang`、`ui_mode=embedded` 等查询参数。不要把 `http://aux-backend:8787` 作为浏览器 iframe 地址，除非浏览器本身能解析该名称。

官网公开页不需要 sub2api token。`/` 是控制台入口，会重定向到 `/admin/dashboard`；不要把根路径写入 `home_content`。

## 管理会话流程

### iframe 进入

1. `AdminGuard` 读取 URL 中的 sub2api `token`。
2. 前端 `POST /api/aux/admin/session`，后端调用 sub2api `GET /api/v1/auth/me`。
3. 后端仅在用户角色为 `admin` 时签发 extension 自有 JWT。
4. 后续管理请求携带 `X-Aux-Session`；sub2api token 与 extension session 不可混用。

### 独立登录

`/login` 调用 `POST /api/aux/admin/login`，后端代理 sub2api `POST /api/v1/auth/login`，成功后仍签发 extension 自有 JWT。401 表示邮箱/密码错误，403 需要区分非管理员和 `TWO_FACTOR_REQUIRED`，503 表示 sub2api 不可达。不要在前端或日志中保存/打印密码、sub2api access token 或完整登录响应。

如果登录失败，按以下顺序检查：

- 浏览器请求是否确实到 `/api/aux/admin/login`，而不是直接调用 sub2api；
- `SUB2API_BASE_URL` 是否从 extension 容器可达，路径是否包含正确的后端根地址；
- sub2api 是否返回 401、403、503，先看状态码再判断文案；
- 登录成功后是否能看到 `X-Aux-Session`，以及 JWT 是否因 `SUB2API_EXTENSION_JWT_SECRET` 变化而失效。

## 域名、CSP 与 NGINX

- iframe URL 的域名来自 `custom_menu_items`/`home_content` 配置，不会自动从 Docker 服务名推断公网域名。
- 生产推荐由宿主机 NGINX 终止 HTTPS，再反代到 `127.0.0.1:8787`；证书使用 `/etc/nginx/certs/<domain>/`。
- NGINX 不要添加 `X-Frame-Options`，否则 sub2api iframe 会被阻断；保留 HTTPS、`nosniff`、HSTS 和严格 referrer policy。
- sub2api 的 CSP `frame-src` 通常从菜单 URL 提取 origin；修改域名后重新保存菜单配置并检查浏览器 Console。
- 同一个公开页被别的站点 iframe 嵌入时，请求仍然发往 extension 配置的域名；父页面不会改变该页面的 origin。

## 会话与跳转故障

- `/admin/*` 反复跳 `/login`：通常是没有嵌入 token，也没有有效的 `X-Aux-Session`。检查 iframe URL 查询参数、localStorage 中 `aux_admin_session` 的过期时间，以及 `SUB2API_EXTENSION_JWT_SECRET` 是否在部署中保持稳定。
- 显示“无法连接 sub2api”：从 extension 容器执行健康请求，确认 Docker 网络、`SUB2API_BASE_URL`、DNS 和端口；这不是前端密码错误。
- 直接访问 `/admin/dashboard`：没有 token 时应进入独立登录页；通过 sub2api 菜单进入时应走 session exchange。
- 登录成功但 API 401：检查请求头是否是 `X-Aux-Session`，不要把 `X-Aux-Token`（嵌入 token）当作管理会话。

## 验收清单

- [ ] `home_content` 使用 `/p/home`，不是 `/` 或容器内部地址
- [ ] `custom_menu_items` 使用完整公网 URL、`page_slug` 为空、`visibility=admin`
- [ ] 浏览器能打开该域名，且 NGINX `frame-src`/HTTPS/证书正常
- [ ] iframe 进入时能完成 `/admin/session`，独立登录时能完成 `/admin/login`
- [ ] 管理 API 使用 `X-Aux-Session`，JWT secret 在重启和发布前后不变
- [ ] 未泄漏密码、sub2api token、access token 或完整认证响应

## 相关文件

| 文件 | 作用 |
|---|---|
| `docs/INTEGRATION.md` | sub2api 菜单、官网和域名配置指南 |
| `frontend/src/components/AdminGuard.tsx` | 管理路由守卫和跳转 |
| `frontend/src/lib/admin-auth.ts` | session exchange、独立登录和本地会话 |
| `frontend/src/lib/embedded.ts` | iframe 查询参数解析 |
| `backend/internal/integration/sub2api_client.go` | sub2api HTTP 客户端 |
| `backend/internal/service/auth_service.go` | 管理员校验和 extension JWT |
| `deploy/nginx/` | 生产反向代理和 HTTPS 模板 |
