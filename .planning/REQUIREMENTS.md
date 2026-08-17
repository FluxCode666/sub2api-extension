# Requirements: aux-system · 通用页面管理系统

**Defined:** 2026-08-18
**Core Value:** 管理员能通过管理端 UI 动态创建并发布页面(含路由与权限配置),页面立即可访问

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Dependencies (预装依赖)

- [ ] **DEP-01**: shadcn/ui 初始化到现有 Tailwind 3.4 + React 18 项目(components.json + lib/utils.ts cn 工具),不破坏现有样式与暗色模式
- [ ] **DEP-02**: 预装常用 shadcn 组件(Button/Card/Dialog/Input/Label/Table/Sidebar/DropdownMenu/Form/Select/Switch/Tabs/Toast/Tooltip/Separator/ScrollArea/Sheet/Skeleton)
- [ ] **DEP-03**: 预装 GSAP 3.12 + @gsap/react(useGSAP hook),供动态页面与管理端动画使用
- [ ] **DEP-04**: 预装 Monaco 编辑器(@monaco-editor/react,懒加载),供页面内容编辑

### Data Model (数据模型)

- [ ] **DATA-01**: 新增 `pages` Ent schema,字段: id/slug(唯一)/title/visibility(public|admin)/content_type(html|react)/content_html/content_react/enabled/created_at/updated_at,风格镜像现有 schema(entsql 注解 + 中文注释)
- [ ] **DATA-02**: `go generate ./ent` 重新生成,迁移幂等可重复,不破坏现有 page_views/feature_clicks/system_meta 表
- [ ] **DATA-03**: 迁移经显式 `-migrate` flag 触发(沿用现有约定,不在启动时自动迁移)

### Backend API (后端接口)

- [ ] **API-01**: 管理端页面 CRUD API(`POST/GET/PUT/DELETE /api/aux/admin/pages`),经 AdminGuard 保护,标准信封响应
- [ ] **API-02**: 管理端单个页面获取(`GET /api/aux/admin/pages/:id`),经 AdminGuard
- [ ] **API-03**: 公开页面内容获取(`GET /api/aux/pages/:slug`),仅返回 enabled 且 visibility=public 的页面,经 TelemetryGuard 限流
- [ ] **API-04**: 公开页面列表获取(`GET /api/aux/pages`,返回 slug/title/visibility,不含内容),供前端 bootstrap 合并注册表
- [ ] **API-05**: 服务层校验 slug 唯一性(含与静态核心页 id 冲突检查)与内容大小上限(256KB)
- [ ] **API-06**: 服务层通过 Store 接口 seam 支持测试(镜像现有 auth/telemetry service 模式)
- [ ] **API-07**: 页面删除时,已有 page_view/feature_click 埋点历史保留(只追加表不动)

### Page Registry (页面注册表演进)

- [ ] **REG-01**: 静态 PAGE_REGISTRY 保留为不可变核心(home/dashboard/homepage-config)
- [ ] **REG-02**: 新增 `lib/dynamic-pages.ts`,bootstrap 时 fetch `/api/aux/pages` 获取动态页清单
- [ ] **REG-03**: 提供 merge 函数,合并静态核心 + 动态页为统一只读注册表,动态页 id 采用 `page:<slug>` 命名空间避免与静态 id 冲突
- [ ] **REG-04**: 更新 page-registry↔routes 一致性测试,覆盖合并后的注册表

### Dynamic Routes (动态路由)

- [ ] **ROUTE-01**: 注册参数化路由 `/p/:slug`(public 动态页)与 `/admin/p/:slug`(admin 动态页,经 AdminGuard)
- [ ] **ROUTE-02**: 动态页组件按 slug on-demand fetch 内容(`GET /api/aux/pages/:slug` 或 admin 等价接口),不预注册每个 slug
- [ ] **ROUTE-03**: 硬刷新 `/p/<slug>` 与 `/admin/p/<slug>` 能正确渲染(不 404),bootstrap 期间显示 loading 状态
- [ ] **ROUTE-04**: 不存在的 slug 返回 404 页面(复用现有 NotFound)

### Sidebar Layout (侧边菜单栏布局)

- [ ] **SIDE-01**: AdminLayout 从顶部导航栏重构为 shadcn Sidebar 侧边菜单栏
- [ ] **SIDE-02**: 侧边栏菜单项由合并注册表(admin 页)动态驱动
- [ ] **SIDE-03**: 侧边栏支持折叠/展开,暗色模式正常工作,响应式
- [ ] **SIDE-04**: 现有管理端页面(dashboard/homepage-config)在侧边栏布局下正常渲染

### Page Management UI (页面管理页)

- [ ] **UI-01**: 页面管理页(`/admin/pages`)展示动态页面列表(shadcn Table: 标题/slug/路由/可见性/状态/操作)
- [ ] **UI-02**: 创建页面表单(标题/slug/可见性 public|admin/content_type html|react/HTML 内容),slug 实时唯一性校验
- [ ] **UI-03**: 编辑页面(复用创建表单预填)
- [ ] **UI-04**: 删除页面(确认对话框,提示埋点历史保留)
- [ ] **UI-05**: 启用/停用页面(switch,停用页 404 但行与埋点保留)
- [ ] **UI-06**: Monaco 编辑器编辑 HTML 内容(语法高亮,懒加载,内容超 256KB 警告)
- [ ] **UI-07**: 表单校验(必填/slug 格式/唯一性/内容大小),错误清晰提示

### Content Rendering (内容渲染)

- [ ] **RENDER-01**: SandboxRenderer 组件用 `<iframe srcdoc sandbox="allow-scripts">` 渲染用户 HTML(无 allow-same-origin,严格 CSP: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline')
- [ ] **RENDER-02**: iframe 与父应用仅通过 postMessage 通信(埋点上报钩子),无 DOM 直访
- [ ] **RENDER-03**: DynamicPage(`/p/:slug`)与 AdminDynamicPage(`/admin/p/:slug`)host 组件 fetch 内容后经 SandboxRenderer 渲染
- [ ] **RENDER-04**: 渲染时显示 loading 状态(skeleton),内容加载失败显示错误态

### Dashboard (仪表盘增强)

- [ ] **DASH-01**: Dashboard 列出动态页面(来自合并注册表)及其访问量/功能使用度
- [ ] **DASH-02**: 已删除/停用的动态页数据保留但不展示(沿用现有"历史保留但不展示"约定)

### Telemetry Continuity (埋点连续性)

- [ ] **TEL-01**: 动态页访问经 telemetry-sdk 上报 page_view,page_id = `page:<slug>`
- [ ] **TEL-02**: 动态页内功能点击经 postMessage 上报 feature_click,page_id = `page:<slug>`

### Page-Writing Skill (页面编写 skill)

- [ ] **SKILL-01**: 创建 agent skill,编码 aux-system 中 sub2api 页面编写规范(注册/路由/守卫/埋点/嵌入上下文/可用库 gsap+shadcn/ui/模板)
- [ ] **SKILL-02**: skill 覆盖静态核心页与动态页两种编写场景的契约
- [ ] **SKILL-03**: skill 包含可复用模板与"添加新页面"检查清单

### UI Quality (UI 视觉品质)

- [ ] **QUAL-01**: 侧边栏布局与页面管理页 UI 经 taste skills 审计(设计系统/组件规范/视觉一致性)
- [ ] **QUAL-02**: 暗色模式在所有新增 UI 上正常工作

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### React Dynamic Rendering (React 动态渲染)

- **RENDER-V2-01**: 管理员可创建 content_type=react 的页面,填写 TSX 源码
- **RENDER-V2-02**: React 页面在沙箱 iframe 内经运行时编译(Babel standalone 或 SWC-wasm)渲染,可复用 shadcn/ui 与 gsap
- **RENDER-V2-03**: React 页面经 importmap 或预打包 UMD 获取 React/shadcn/gsap,不在主 realm 执行

### Page Management Enhancements (页面管理增强)

- **MGMT-V2-01**: 实时预览(编辑时所见即所得,防抖)
- **MGMT-V2-02**: 草稿/发布工作流(status: draft|published)
- **MGMT-V2-03**: 每页 SEO meta(title/description/og tags)
- **MGMT-V2-04**: 页面模板(landing/doc/form 等预设)
- **MGMT-V2-05**: 版本历史与回滚(page_versions 表)

### Dashboard Enhancements (仪表盘增强)

- **DASH-V2-01**: 单页埋点钻取(查看某个动态页的访问详情)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| 多角色与细粒度权限(viewer/editor/admin) | 与 sub2api iframe token 会话模型集成复杂度大;二元 public/admin 已覆盖核心场景 |
| 可视化拖拽页面编辑器 | 巨大构建成本;偏离 code-first 价值;易碎 |
| 动态页面服务端渲染(SSR)/SEO | SPA + iframe 嵌入模型无 SSR 路径;sub2api 经 iframe 加载,SEO 收益不匹配 |
| 多租户页面命名空间 | 给每个查询/路由/权限加租户隔离复杂度;当前单租户 |
| 实时协作编辑 | 需 CRDT/websocket 基建;单管理员编辑场景价值低 |
| 非管理员公开创建页面 | 破坏信任边界;仅管理员创建,公开仅消费 |
| 修改 sub2api 代码 | 硬约束;所有集成走 sub2api 现有 custom_menu_items/home_content 接缝 |
| 动态页面版本历史(v1) | v1 先做创建/编辑/删除;版本管理作为 v2 增量 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (populated during roadmap creation) | | |

**Coverage:**
- v1 requirements: 42 total
- Mapped to phases: 0 (pending roadmap creation)
- Unmapped: 42 ⚠️ (will be resolved by roadmap creation)

---
*Requirements defined: 2026-08-18*
*Last updated: 2026-08-18 after initial definition*
