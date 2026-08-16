# sub2api 集成配置指南（附属内容承载系统）

本指南说明如何在 sub2api 侧做**配置**（不改任何代码），让 sub2api 的官网首页与控制台菜单通过 iframe 加载附属内容承载系统的页面。

**核心原则：零代码改动 sub2api**（KTD2）。所有对接走 sub2api 现有的后台配置项：`home_content`、`custom_menu_items`。CSP `frame-src` 自动注入，无需手动配置。

---

## 目录

1. [架构概览](#1-架构概览)
2. [前置条件](#2-前置条件)
3. [步骤一：部署附属系统](#步骤一部署附属系统)
4. [步骤二：配置 home_content（替换官网首页）](#步骤二配置-home_content替换官网首页)
5. [步骤三：配置 custom_menu_items（控制台菜单）](#步骤三配置-custom_menu_items控制台菜单)
6. [步骤四：CSP 自动注入说明](#步骤四csp-自动注入说明)
7. [验收清单](#验收清单)
8. [home_content 裸 iframe 限制（重要）](#home_content-裸-iframe-限制重要)
9. [两种部署场景的 URL 选择](#两种部署场景的-url-选择)
10. [故障排查](#故障排查)

---

## 1. 架构概览

附属内容承载系统（下称「附属系统」）是独立部署的 web 应用，作为 sub2api 的内容源。两条嵌入路径：

```
┌─────────────────────── sub2api（外部宿主，不改代码）──────────────────────────┐
│                                                                                │
│  官网首页                              控制台菜单                                │
│  HomeView                              CustomPageView                           │
│  home_content → 裸 iframe              custom_menu_items → buildEmbeddedUrl      │
│  （不传 token）                         （传 token + user_id + theme + lang）     │
│       │                                      │                                  │
│       │ http://aux-backend:8787/             │ http://aux-backend:8787/admin/... │
│       ▼                                      ▼                                  │
└────────────────────────────────────────────────────────────────────────────────┘
                    │                                      │
                    ▼                                      ▼
┌─────────────────── 附属系统（aux-system，独立部署）──────────────────────────────┐
│                                                                                │
│  前端 React SPA                    后端 Go + Gin + Ent                          │
│  /  (HomePage, 公开)               /api/aux/*  (公开 + 埋点上报)                │
│  /admin/* (管理端, 需会话)          /api/aux/admin/* (受 AdminGuard 保护)        │
│                                    转发验证 → sub2api /auth/me                  │
│                                         │                                      │
│                                         ▼                                      │
│                                  自有 PostgreSQL                               │
│                                  (page_view / feature_click)                   │
└────────────────────────────────────────────────────────────────────────────────┘
```

**两条路径的关键差异：**

| 路径 | 宿主配置 | iframe 传参 | 附属系统页面 | 认证 |
|------|----------|-------------|--------------|------|
| 官网首页 | `home_content` = URL | **无 token**（裸 iframe） | HomePage `/` | 无（纯公开内容） |
| 控制台菜单 | `custom_menu_items` JSON | **带 token**（buildEmbeddedUrl） | 管理端 `/admin/*` | iframe token → 转发验证 |

---

## 2. 前置条件

- sub2api 已通过 `deploy/docker-compose.yml` 部署并正常运行，`sub2api-network` 已存在。
- sub2api 管理员账号可登录后台。
- 附属系统镜像已构建或可通过 docker-compose build 构建。

---

## 步骤一：部署附属系统

### 1.1 准备配置

```bash
cd aux-system/deploy
cp .env.example .env
```

编辑 `.env`，至少设置以下必需项：

```bash
# 附属系统自有 PostgreSQL 密码
AUX_POSTGRES_PASSWORD=<一个强密码>

# 附属系统 JWT 密钥（生成：openssl rand -hex 32）
AUX_JWT_SECRET=<openssl rand -hex 32 的输出>
```

### 1.2 启动附属系统

```bash
docker compose up -d
```

### 1.3 验证附属系统启动

```bash
# 健康检查应返回 200
curl http://localhost:8787/health
# 预期: {"status":"ok","service":"aux-system"}

# 查看日志
docker compose logs -f aux-backend
```

附属系统启动后，它在 `sub2api-network` 内以服务名 `aux-backend` 可达（端口 8787）。

> **注意：** `aux-postgres` 是附属系统的自有 PostgreSQL，独立于 sub2api 的 postgres，承载埋点表。两者不共享数据。

---

## 步骤二：配置 home_content（替换官网首页）

`home_content` 让 sub2api 用 iframe 替换默认官网首页，公开访客无需登录即可浏览。

### 2.1 设置 home_content

1. 登录 sub2api 管理员后台。
2. 进入**「站点设置」**tab。
3. 找到 **"Home Content"** textarea。
4. 填入附属系统首页 URL（见下方 URL 选择）。

**同 Docker 网络部署**（sub2api 与附属系统在同一 `sub2api-network`）：

```
http://aux-backend:8787/
```

**公网部署**（附属系统有公网域名）：

```
https://aux.example.com/
```

5. 保存设置。

### 2.2 验证

打开 sub2api 首页（未登录状态），应看到附属系统的 HomePage 内容经 iframe 加载。

> **注意：** 此处填的是**完整 URL**（以 `http://` 或 `https://` 开头）。sub2api 的 `HomeView` 检测到 URL 前缀后渲染裸 iframe（`<iframe :src="url">`）。

---

## 步骤三：配置 custom_menu_items（控制台菜单）

`custom_menu_items` 在 sub2api 控制台侧边栏添加自定义菜单项，点击后经 iframe 加载附属系统管理端页面。此路径**会传 token**，附属系统据此做转发验证。

### 3.1 设置 custom_menu_items

1. 登录 sub2api 管理员后台。
2. 进入**「站点设置」**tab。
3. 找到 **"Custom Menu Items"** 卡片。
4. 填入以下 JSON 数组（可追加到现有菜单项后）：

```json
[
  {
    "id": "aux-dashboard",
    "label": "内容分析",
    "icon_svg": "",
    "url": "http://aux-backend:8787/admin/dashboard",
    "page_slug": "",
    "visibility": "admin",
    "sort_order": 100
  }
]
```

> **公网部署**时，把 `url` 换成公网域名，如 `https://aux.example.com/admin/dashboard`。

5. 保存设置。

### 3.2 字段说明

| 字段 | 说明 |
|------|------|
| `id` | 菜单项唯一标识（字符串） |
| `label` | 菜单显示名称 |
| `icon_svg` | SVG 图标字符串，可空 |
| `url` | iframe 目标 URL。sub2api 会经 `buildEmbeddedUrl` 自动附加 `user_id`、`token`、`theme`、`lang`、`ui_mode=embedded`、`src_host`、`src_url` 参数 |
| `page_slug` | 可选。若填了则走 markdown 模式（不建 iframe），留空走 iframe 模式 |
| `visibility` | `"admin"` 仅管理员可见 / `"user"` 对所有人可见。附属系统管理端页面用 `"admin"` |
| `sort_order` | 菜单排序权重（数字） |

### 3.3 验证

1. 刷新 sub2api 控制台页面。
2. 侧边栏应出现「内容分析」菜单项（仅管理员可见）。
3. 点击「内容分析」→ iframe 加载附属系统仪表盘，经转发验证后显示埋点分析数据。

---

## 步骤四：CSP 自动注入说明

**无需手动配置 sub2api 的 CSP。**

sub2api 的 `GetFrameSrcOrigins`（`backend/internal/service/setting_public.go`）会自动从以下配置的 URL 中提取 origin（`scheme://host`）并注入 `Content-Security-Policy: frame-src`：

- `home_content` 的 URL
- 所有 `custom_menu_items[].url`
- `purchase_subscription_url`（若启用）

**工作流程：**

1. 你在后台设置 `home_content` 或 `custom_menu_items` 的 URL。
2. sub2api 自动从这些 URL 提取 origin（如 `http://aux-backend:8787`）。
3. 这些 origin 被加入 `frame-src` 白名单。
4. 设置更新后自动刷新（无需重启 sub2api）。

**结论：** 只要附属系统域名出现在 `home_content` 或 `custom_menu_items` 的 URL 中，CSP 就自动放行，iframe 不会被浏览器拦截。

---

## 验收清单

### AE1：公开访客浏览替换后的官网首页

- [ ] 附属系统已部署且 `/health` 返回 200
- [ ] sub2api 后台 `home_content` 已设为附属系统首页 URL
- [ ] **测试：** 未登录访客打开 sub2api 首页 → iframe 加载附属系统 HomePage → 访客无需登录即可浏览

### AE2 / F2：管理员经转发验证进入仪表盘

- [ ] sub2api 后台 `custom_menu_items` 已配置附属系统管理端菜单项（`visibility: "admin"`）
- [ ] **测试：** 管理员登录 sub2api 控制台 → 侧边栏出现附属系统菜单项 → 点击「内容分析」→ iframe 加载附属系统仪表盘 → 经转发验证成功 → 显示页面清单与埋点分析数据

### 部署冒烟

- [ ] `docker compose up -d` 成功启动附属系统 + 自有 PostgreSQL
- [ ] `curl http://localhost:8787/health` 返回 `{"status":"ok","service":"aux-system"}`
- [ ] 浏览器访问 `http://localhost:8787/` 加载附属系统前端首页

---

## home_content 裸 iframe 限制（重要）

sub2api 的 `HomeView` 把 `home_content` 当**裸 iframe** 渲染（`<iframe :src="url">`），**不走 `buildEmbeddedUrl`，不传 token**。

这意味着：

- **经 `home_content` 嵌入的公开首页收不到访问者身份**（无 `token`、无 `user_id`）。
- **只能承载纯公开内容**——不能读取 sub2api 的受保护数据，也不能做管理员操作。
- 附属系统的 HomePage（路由 `/`）正是为此设计：纯公开内容，不依赖 token。

**如果页面需要 sub2api 受保护数据或管理员身份，必须经 `custom_menu_items`（控制台菜单）嵌入**——那条路径会传 token，附属系统据此做转发验证。

这是零侵入约束下的固有边界（KTD6），不是缺陷。

| 需求 | 嵌入路径 | 传 token？ | 适合内容 |
|------|----------|-----------|----------|
| 公开内容（官网首页） | `home_content` | 否 | 纯公开，无需身份 |
| 受保护/管理员内容 | `custom_menu_items` | 是 | 需身份验证、查看附属系统分析 |

---

## 两种部署场景的 URL 选择

### 场景一：同 Docker 网络部署（本地/单机）

sub2api 与附属系统在同一 `sub2api-network`，用容器服务名解析：

| 配置项 | URL |
|--------|-----|
| `home_content` | `http://aux-backend:8787/` |
| `custom_menu_items[].url` | `http://aux-backend:8787/admin/dashboard` |
| `SUB2API_BASE_URL`（附属系统配置） | `http://sub2api:8080` |

**特点：** 流量不出网络，低延迟。但浏览器访问 sub2api 时，iframe 的 `http://aux-backend:8787/` 是容器内地址，**浏览器无法解析**——因此此场景仅适用于 sub2api 本身也在本地访问、且浏览器能解析服务名的环境（如配置 hosts 或 DNS）。

> **实际推荐：** 如果用户通过浏览器访问 sub2api，iframe URL 必须是浏览器能解析的地址。同网络服务名适合 sub2api 后端到附属系统后端的通信（`SUB2API_BASE_URL=http://sub2api:8080` 反向也成立），但 iframe 的 `src` 必须用浏览器可达的地址。

### 场景二：公网部署（推荐生产环境）

附属系统有公网域名（经反向代理/TLS）：

| 配置项 | URL |
|--------|-----|
| `home_content` | `https://aux.example.com/` |
| `custom_menu_items[].url` | `https://aux.example.com/admin/dashboard` |
| `SUB2API_BASE_URL`（附属系统配置） | `https://sub2api.example.com`（sub2api 公网域名）或 `http://sub2api:8080`（若同网络） |

**特点：** 浏览器可解析，TLS 加密。这是生产环境的推荐方案。

### 混合方案（常见）

- 附属系统后端到 sub2api 后端的通信（`SUB2API_BASE_URL`）走同网络服务名 `http://sub2api:8080`（低延迟、不出网络）。
- sub2api iframe 的 `src` 用附属系统的公网域名 `https://aux.example.com/...`（浏览器可达）。

---

## 故障排查

### iframe 空白 / 不加载

1. **检查 CSP：** 浏览器开发者工具 Console 看是否有 CSP `frame-src` 拦截。若有，确认 `home_content` 或 `custom_menu_items` 的 URL origin 已被 sub2api 提取（保存设置后自动刷新）。
2. **检查 URL 可达：** 在浏览器直接访问 iframe 的 URL，确认附属系统响应。
3. **检查同网络：** `docker exec sub2api wget -qO- http://aux-backend:8787/health` 应返回 ok。

### 管理端菜单点击后显示「无嵌入 token」

附属系统的 AdminGuard 检测不到 iframe 传入的 token。确认：
- 菜单项的 `page_slug` 为空（留空走 iframe 模式，才会经 `buildEmbeddedUrl` 传 token）。
- 菜单项的 `url` 是附属系统管理端路由（如 `/admin/dashboard`）。

### 管理端菜单点击后显示「转发验证失败」

1. **检查 sub2api 可达：** `docker exec aux-backend wget -qO- http://sub2api:8080/health` 应返回 ok。
2. **检查 sub2api `auth/me` 端点：** 确认 sub2api 正常运行且 `/api/v1/auth/me` 可用。

### 附属系统 `/health` 返回非 200

1. 检查附属系统日志：`docker compose logs aux-backend`
2. 检查 PostgreSQL 启动：`docker compose logs aux-postgres`
3. 确认 `AUX_POSTGRES_PASSWORD` 与 `AUX_JWT_SECRET` 已设置。

### 附属系统前端加载但 API 报错

前端使用相对路径 `/api/aux`，同源托管（后端内嵌前端 dist）。若前端与 API 不同源，需配置反向代理将 `/api` 转发到后端。Docker 部署下后端已同源托管前端，无需额外配置。
