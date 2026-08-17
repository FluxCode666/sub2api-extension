# aux-system · 通用页面管理系统

## What This Is

aux-system 原本是 sub2api 的附属内容承载系统(Go + Ent 后端 / React 前端,经 iframe 嵌入 sub2api 控制台),提供 TERALEMO 官网首页、官网配置中心和分析仪表盘。本次改造将其升级为**通用页面管理系统**:管理员可在 UI 里动态创建页面、填入 HTML(后续支持 React)代码、配置路由与权限,无需改代码重新部署。

## Core Value

管理员能通过管理端 UI 动态创建并发布页面(含路由与权限配置),页面立即可访问——这是整个系统存在的意义,其它一切为此服务。

## Business Context

- **Customer**: sub2api 平台运营者/管理员(经 sub2api iframe 嵌入使用,也支持独立登录)
- **Revenue model**: 间接——作为 sub2api 的内容承载与页面分析能力,不独立计费
- **Success metric**: 管理员能在 5 分钟内从 UI 创建一个新页面并配置好路由权限,页面可被对应权限用户访问
- **Strategy notes**: 零侵入 sub2api(所有集成走现有接缝),自有 PostgreSQL

## Requirements

### Validated

从现有代码推断的已交付能力(本次改造保留):

- ✓ TERALEMO 官网首页(`/`,亮/暗主题,`?theme=` 初始化) — existing
- ✓ 官网配置中心(`/admin/homepage`,首屏文案/CTA/导航/伙伴列表,存 `system_meta`) — existing
- ✓ 分析仪表盘(`/admin/dashboard`,页面访问量与功能使用度聚合) — existing
- ✓ AdminGuard 会话守卫(sub2api iframe token → `/auth/me` 转发验证 → aux JWT `X-Aux-Session`) — existing
- ✓ 匿名埋点(PageView/FeatureClick,只追加表,per-IP 令牌桶限流 + 4KB body 限制) — existing
- ✓ 标准信封 API(`{code,message,data?}` / `{code,message,reason?}`) — existing
- ✓ 单镜像部署(后端同源托管前端 dist,GitHub Actions CI/CD) — existing
- ✓ 静态 page-registry(页面身份单一真相源,路由+埋点+仪表盘共享 id 命名空间) — existing

### Active

本次改造目标(假设,待交付验证):

- [ ] 管理端采用侧边菜单栏布局(替换现有顶部导航栏),菜单项由页面注册表动态驱动
- [ ] Dashboard 页保留并增强,作为管理端首页,展示动态页面与访问数据
- [ ] 页面管理页:管理员可创建新页面(标题、slug、可见性 public/admin、HTML 内容)
- [ ] 页面管理页:支持编辑/删除/启停已有动态页面
- [ ] 动态页面路由:public 页挂 `/p/<slug>`,admin 页挂 `/admin/p/<slug>`,与现有路由树分层
- [ ] 动态页面权限:二元 public/admin(沿用现有会话守卫模型),admin 页经 AdminGuard 保护
- [ ] 动态页面内容渲染(v1):HTML 经 iframe 沙箱(CSP 隔离)渲染,安全可控
- [ ] 动态页面内容渲染(v2,后续阶段):React/TSX 源码动态编译渲染,可复用 shadcn/ui 组件
- [ ] 预装依赖:gsap、shadcn/ui(及其依赖 tailwindcss-animate、Radix primitives 等),供动态页面与管理端 UI 使用
- [ ] page-registry 演进:从静态代码数组改为"静态核心页 + DB 动态页"合并的单一真相源,保持埋点/仪表盘 id 命名空间一致
- [ ] UI 视觉品质经 taste skills 把关(设计系统、组件规范、视觉一致性)

### Out of Scope

- 多角色与细粒度权限(viewer/editor/admin 等) — 与 sub2api iframe token 会话模型集成复杂度大,二元 public/admin 已覆盖核心场景;后续若有需求再评估
- 动态页面的服务端渲染(SSR)/SEO — 当前是 SPA + iframe 嵌入模型,SSR 收益不匹配改造成本
- 动态页面的版本历史/回滚 — v1 先做创建/编辑/删除,版本管理作为后续增量
- 动态页面的可视化拖拽编辑器 — 本期用代码填入(HTML/React 源码),所见即所得编辑器另行评估
- 修改 sub2api 代码 — 硬约束,所有集成走 sub2api 现有 `custom_menu_items`/`home_content` 接缝

## Context

**现有架构(来自代码库地图 `.planning/codebase/`):**

- 后端:Go 1.26.5 + Gin + Ent v0.14.6 + PostgreSQL,分层 `cmd → server(router+middleware) → handler → service → integration(sub2api client) → ent`。中间件 AdminGuard(会话)/TelemetryGuard(限流)。Ent schema: SystemMeta(KV 占位但 load-bearing)、PageView、FeatureClick(只追加)。无 `pages` 表。
- 前端:React 18 + Vite 5 + TS 5.6 + Tailwind 3.4 + React Router 6。`src/App.tsx` 为路由根,`AdminLayout`(顶部导航栏)包裹管理端,`AdminGuard` 守卫。`lib/page-registry.ts` 是静态数组,被 `App.tsx` 路由 + 埋点 SDK + Dashboard 共享。无 gsap、无 shadcn/ui(无 `components.json`)。
- 集成:sub2api 经 iframe 传 token,AdminGuard 转发到 sub2api `/api/v1/auth/me` 验证后签发 aux JWT。公开埋点写入不经守卫。

**关键摩擦点(来自 CONCERNS.md):**

- 静态 page-registry 与硬编码 App.tsx 路由——动态页面管理必须突破此处,改为 DB 驱动 + 静态核心页合并。
- AdminLayout 顶部导航栏——需重构为侧边菜单栏,且菜单项需由(合并后的)页面注册表驱动。
- 引入 HTML/React 页面内容后,session-in-localStorage 的 XSS 风险升级——iframe 沙箱 + CSP 是首选缓解。
- Ent 生成代码是 build product,schema 改动需 `go generate ./ent`。

**用户偏好:**

- 用 gsd 管理任务全流程(new-project → plan-phase → execute-phase)。
- UI 用 taste skills 处理(设计系统、组件规范、视觉一致性)。

## Constraints

- **Tech stack**: 后端 Go+Gin+Ent+PostgreSQL 不可替换;前端 React+Vite+TS+Tailwind 不可替换 — 保留现有栈,增量加 gsap/shadcn/ui
- **Compatibility**: 零侵入 sub2api — 所有集成走现有 `custom_menu_items`/`home_content` 接缝,不修改 sub2api 代码
- **Security**: 动态页面内容(用户填入的 HTML/React)必须在沙箱内执行 — 防止 XSS 窃取 admin session(localStorage 存 JWT);public 动态页面需复用现有埋点限流
- **Compatibility**: page-registry id 命名空间一致性不可破坏 — 动态页与静态核心页共享同一 id 空间,埋点与仪表盘聚合依赖此
- **Dependencies**: 预装 gsap + shadcn/ui(及 tailwindcss-animate、Radix primitives、clsx、tailwind-merge 等) — 供动态页面内容与管理端 UI 使用
- **Performance**: 动态页面渲染不可拖慢管理端首屏 — 沙箱 iframe 懒加载,动态路由按需挂载

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 动态页面内容 v1 用 HTML iframe 沙箱渲染,React 动态编译作为 v2 | 沙箱先跑通动态页面闭环,安全(CSP 隔离)且简单;CONCERNS.md 指出引入 HTML/React 后 localStorage-JWT 的 XSS 风险升级,沙箱先行最稳 | — Pending |
| 动态页面路由 public 挂 `/p/<slug>`、admin 挂 `/admin/p/<slug>` | 与现有路由树分层,不污染核心页(`/`、`/admin/dashboard`、`/admin/homepage`),权限边界清晰 | — Pending |
| 权限模型沿用二元 public/admin | sub2api iframe token 转发验证天然契合二元模型;多角色会放大与 sub2api 会话集成复杂度,不符 MVP | — Pending |
| page-registry 从静态数组演进为"静态核心页 + DB 动态页"合并 | 保持 id 命名空间单一真相源(KTD7),埋点/仪表盘无需重构;静态核心页(官网/配置/仪表盘)仍代码登记 | — Pending |
| 预装 gsap + shadcn/ui | 用户明确要求;gsap 供动态页面动画,shadcn/ui 供管理端 UI 与动态页面可复用组件 | — Pending |
| UI 视觉品质经 taste skills 把关 | 用户明确要求;用于设计系统、组件规范、视觉一致性审计 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-18 after initialization*
