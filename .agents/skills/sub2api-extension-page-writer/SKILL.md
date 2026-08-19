---
name: sub2api-extension-page-writer
description: 创建或修改 sub2api-extension 的静态核心页面、数据库动态页面和页面元数据时使用。覆盖路由、页面注册、AdminGuard、埋点、HTML 沙箱、动态 React 编译、图片资源和嵌入 sub2api 的约束。
---

# sub2api-extension 页面编写规范

sub2api-extension 是 sub2api 的独立内容承载与页面管理项目。页面分为两类：静态核心页面（随前端代码发布）和数据库动态页面（通过管理端创建/编辑）。两者共用页面身份与埋点模型，但渲染安全边界不同。只做管理端视觉调整时，优先使用现有前端设计/界面 skill；本 skill 关注页面身份、内容持久化、路由和运行时约束。

## 先选择页面类型

| 需求 | 方案 |
|---|---|
| 仪表盘、图片资源、示例等系统内置能力 | 静态核心页面，修改代码并注册路由 |
| 管理员运行时创建、无需重新部署的内容 | 数据库动态页面，通过 `/admin/pages` 管理 |
| 官网、营销落地页 | 动态 HTML 页面，公开可见，通常使用 `/p/<slug>` |
| 管理员内部内容页 | 动态 admin 页面 `/admin/p/<slug>`，或静态核心页面 |

不要为官网恢复一个新的硬编码 React 首页。根路径 `/` 固定重定向到 `/admin/dashboard`，官网首页是数据库动态页 `/p/home`，由一次性 seed 或管理端写入数据库后在运行时读取。

## 页面注册表与身份

静态页面的唯一来源是 `frontend/src/lib/page-registry.ts` 的 `STATIC_PAGE_REGISTRY`。当前静态核心页面为：

```ts
{ id: 'dashboard', title: '分析仪表盘', path: '/admin/dashboard', visibility: 'admin' }
{ id: 'image-assets', title: '图片资源', path: '/admin/assets', visibility: 'admin' }
{ id: 'example-content', title: '静态内容示例', path: '/admin/examples/content', visibility: 'admin' }
{ id: 'example-interaction', title: '交互与埋点示例', path: '/admin/examples/interaction', visibility: 'admin' }
{ id: 'example-api', title: 'API 请求示例', path: '/admin/examples/api', visibility: 'admin' }
```

动态页面来自后端 `/api/aux/pages`，由 `frontend/src/lib/dynamic-pages.ts` 与静态注册表合并。动态页面身份为 `page:<slug>`，静态页面使用裸 id（例如 `dashboard`）。`page_id` 同时用于页面访问和功能点击埋点，不能在运行时随意改写。

当前 `/api/aux/pages` 只返回已启用的公开页面；管理侧边栏需要动态 admin 页时，在 `AdminGuard` 放行后通过受守卫的 `/api/aux/admin/pages` 获取。不要为了方便菜单而把 admin 页面元数据重新放回公开端点。

`/admin/pages` 是 CRUD 管理入口，不是静态注册表条目；`image-assets` 保留静态身份，但当前侧边栏把它放在“管理”分组。不要为了菜单显示再添加重复 registry 项。当前侧边栏只有动态页面部分来自合并注册表，页面管理入口和图片资源入口仍是布局中的固定操作入口。

当前根路径不是内容页面，`home` 也不是静态注册项；`home` 是数据库官网动态页的约定 slug。`homepage-config` 菜单已经移除，不要重新加入注册表或侧边栏。

后端当前只将静态核心 id `dashboard` 作为 slug 冲突保护；`home` 可以作为数据库动态官网页使用。创建页面前仍应检查数据库中是否已有同 slug 页面，避免覆盖现有内容。

## 创建静态核心页面

1. 在 `STATIC_PAGE_REGISTRY` 增加唯一的 `id/title/path/visibility`。
2. 在 `frontend/src/App.tsx` 注册同一路径；admin 路由必须位于 `AdminGuard` 和 `AdminLayout` 下。
3. 在 `frontend/src/pages/` 或 `frontend/src/pages/admin/` 创建组件。
4. 页面需要展示在侧边栏时，使用 admin visibility；动态页面会从合并注册表派生菜单，页面管理和图片资源入口由 `AdminLayout` 固定提供。
5. 运行 `pnpm run typecheck` 和页面注册表测试。

静态 admin 页面示例：

```tsx
// frontend/src/pages/admin/MyPage.tsx
export default function MyPage() {
  return <div className="space-y-4"><h1 className="text-2xl font-bold">我的页面</h1></div>
}
```

```tsx
// App.tsx，在 /admin 路由组内
<Route path="my-page" element={<MyPage />} />
```

## 创建数据库动态页面

进入 `/admin/pages`，填写标题、slug、可见性、内容类型、内容和启用状态。动态页面保存于 PostgreSQL `pages` 表，运行时通过 API 读取；seed 脚本只用于首次/幂等写入，不会在用户访问页面时执行。

路由规则：

| 路径 | 页面类型 | 守卫 |
|---|---|---|
| `/p/:slug` | 已启用的公开动态页 | 无 |
| `/admin/p/:slug` | 已启用的 admin 动态页 | `AdminGuard` |
| `/p/home` | TERALEMO 官网数据库动态页 | 无 |
| `/p/sub2api-home` | Sub2API 官网数据库动态页 | 无 |

slug 规则：小写字母、数字和连字符，必须以字母或数字开头。内容单页上限为 256KB。公开动态页不要存放管理员密钥、内部接口凭据或任何需要登录才能读取的数据。

## 动态 HTML 页面

HTML 内容由 `frontend/src/components/SandboxRenderer.tsx` 放入 `srcdoc` iframe：

- `sandbox="allow-scripts"`，不允许 `allow-same-origin`；iframe 为 opaque origin，不能读取宿主 localStorage、Cookie、DOM 或 JWT。
- CSP 为 `default-src 'none'`，只允许内联 script/style；图片允许 `http:`、`https:` 和 `data:`，不允许外部脚本、frame、表单提交或 `fetch`/XHR 网络请求。图片本身仍会发起资源请求，因此不要把“禁止网络请求”理解成禁止图片加载。
- 使用 `data-feature-id="按钮标识"` 标记可埋点元素；父页面通过 `postMessage` 记录功能点击。
- 不得在宿主 React 页面中使用 `dangerouslySetInnerHTML` 渲染数据库 HTML。

示例：

```html
<button data-feature-id="cta-click">立即开始</button>
```

动态 HTML 中的 `postMessage` 和埋点数据属于不可信输入，只能用于统计，不能作为权限判断。不要假设公开页面脚本是可信业务代码。

## 动态 React 页面（高风险能力）

React 动态页面已经实现，不再是“尚未实现”的占位能力：`frontend/src/lib/dynamic-react-compiler.ts` 会从 `https://unpkg.com/@babel/standalone@7.24.0/babel.min.js` 加载 Babel，并在宿主页面通过 `new Function` 执行编译后的组件。除此之外，`DynamicPage` 还支持构建时 `import.meta.glob` 预注册的文件组件模式。

这与 HTML iframe 沙箱不同：动态 React 代码运行在主应用上下文中，不能视为隔离代码。因此：

- 仅对受信任的管理员使用 React 内容类型；公开或多人可编辑内容优先使用 HTML 沙箱。
- 动态 React 代码不得包含 token、密码、内部 URL 或其他秘密，也不要让普通用户获得编辑权限。
- 代码模式使用 `export default` 导出函数组件；当前运行时只注入 React，不支持从应用源码或 npm 包导入模块。不要把 `import` 写入数据库代码，也不要把 React 动态页面误称为 iframe 沙箱。
- Babel CDN 不可用时页面会显示编译失败；需要离线/高安全部署时，应把 Babel 纳入构建产物并重新评估 `new Function` 风险。
- 修改动态 React 编译器时必须增加安全测试和失败态测试，不能把它误写成与 HTML 相同的 sandbox 隔离。

## 页面元数据与图片资源

页面 `metadata` 是数据库 JSON 对象，HTML 沙箱通过 `window.__AUX_METADATA__` 读取。当前渲染器对 `full_bleed` 和 `scroll_mode` 使用字符串精确判断，建议按字符串保存；`trusted_partners` 也是 JSON 字符串而不是嵌套 JSON 数组：

```json
{
  "full_bleed": "true",
  "scroll_mode": "frame",
  "site_name": "TERALEMO",
  "logo": "https://example.com/api/aux/assets/1",
  "trusted_partners": "{\"enabled\":true,\"items\":[{\"icon\":\"\",\"name\":\"星辰互娱\"}]}"
}
```

`trusted_partners` 当前是元数据中的 JSON 字符串，结构示例：

```json
{
  "enabled": true,
  "items": [
    { "icon": "https://cdn.example.com/logo.svg", "name": "星辰互娱" },
    { "icon": "", "name": "另一家伙伴" }
  ]
}
```

`items` 为空或 `enabled=false` 时隐藏板块；icon 为空时不渲染图标；超过 5 项才启用循环滚动。

图片必须先在 `/admin/assets` 上传或登记。上传文件写入 `SUB2API_EXTENSION_ASSET_DIR`（生产容器内为 `/app/data/assets`），数据库 `image_assets.path` 只保存安全相对文件名；复制当前站点生成的完整 HTTP(S) URL 后再填入 `metadata.logo`。不要把相对路径、图片二进制或本机绝对路径写进页面 JSON。

## AdminGuard、嵌入与会话

`/admin/*` 页面由 `AdminGuard` 保护。sub2api iframe 传入的 token 发送到 `/api/aux/admin/session`，后端向 sub2api 验证后签发 sub2api-extension 自有会话，前端通过 `X-Aux-Session` 自动附加到管理 API。

在 sub2api 控制台嵌入 admin 动态页面时，将完整公网 URL 加入 `custom_menu_items`；公开官网使用 `home_content` 指向 `/p/home`。不要把 `http://aux-backend:8787` 这类 Docker 内部地址直接配置给浏览器。

## 埋点

- 页面访问：`trackPageView(pageId)`；动态页加载成功后使用后端返回的 `page:<slug>`。
- 功能点击：静态页面显式调用 `trackFeatureClick`；HTML 页面用 `data-feature-id`，由 `SandboxRenderer` 转发。
- 动态 slug 改名会改变 `page:<slug>`，会产生新的统计维度；需要保留历史统计时优先新建页面或做数据迁移。

## 添加页面检查清单

### 静态核心页面

- [ ] registry 有唯一 id/path，且与 `App.tsx` 路由一致
- [ ] admin 页面位于 `AdminGuard` 下
- [ ] 页面使用现有 shadcn/ui、Tailwind 和主题变量
- [ ] 页面访问/功能点击埋点已接入
- [ ] `pnpm run typecheck` 和相关测试通过

### 数据库动态页面

- [ ] 通过 `/admin/pages` 或 seed 脚本写入数据库，不在运行时代码硬编码内容
- [ ] slug、visibility、content_type、enabled 配置正确
- [ ] 公开 HTML 使用 SandboxRenderer；不使用 `dangerouslySetInnerHTML`
- [ ] React 内容仅来自受信任管理员，并理解其主应用执行风险
- [ ] `metadata` JSON 结构和图片 URL 可访问
- [ ] 页面访问路径、主题、iframe 嵌入和埋点已验证

### 数据库与 seed

- [ ] 新部署先执行一次显式 Ent migration（`make migrate` 或 `go run ./cmd/server -migrate`）；正式服务启动不会自动迁移
- [ ] seed 脚本使用目标环境数据库配置，确认 slug 已存在时是更新而不是重复创建

## 相关文件

| 文件 | 作用 |
|---|---|
| `frontend/src/lib/page-registry.ts` | 静态核心页面注册表 |
| `frontend/src/lib/dynamic-pages.ts` | 动态页面清单获取和合并 |
| `frontend/src/App.tsx` | 路由根和 `/` 重定向 |
| `frontend/src/components/AdminGuard.tsx` | 管理会话守卫 |
| `frontend/src/components/SandboxRenderer.tsx` | 动态 HTML iframe 沙箱 |
| `frontend/src/lib/dynamic-react-compiler.ts` | 动态 React 编译与执行（高风险） |
| `frontend/src/pages/admin/PageManagementPage.tsx` | 动态页面 CRUD |
| `frontend/src/pages/admin/ImageAssetsPage.tsx` | 图片上传与 URL 复制 |
| `backend/internal/service/page_service.go` | 页面校验和持久化 |
| `backend/internal/service/image_asset_service.go` | 图片文件落盘和索引 |
| `backend/scripts/seed_homepage.go` | TERALEMO 官网首次/幂等 seed |
