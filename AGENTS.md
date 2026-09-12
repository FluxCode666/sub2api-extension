# sub2api-extension 统一开发规范

本文件是 `sub2api-extension` 的项目级协作规范，面向人类开发者和代码代理。它描述当前源码、测试和部署文件已经形成的约定。新增功能、修复问题和重构都应遵守这些约束。

本规范持续优化中，不视为一次性定稿。用户在开发过程中提出额外的通用细节、重复出现的约束或新的团队习惯时，代理应先判断其是否适合沉淀为项目规范；适合时先询问用户是否要更新本文件及相关入口，得到确认后再修改 `AGENTS.md`、`CLAUDE.md` 或 `.claude/CLAUDE.md`，并同步校验链接、章节和命令示例。只针对单次任务的临时要求不自动写入规范。

## 1. 文档优先级与工作原则

遇到资料冲突时，按下面顺序判断：

1. 当前源码和测试行为。
2. 本文件以及根目录 `CLAUDE.md`。
3. `.agents/skills/` 下与任务对应的项目 skill。
4. `README.md`、`docs/`、`.github/CICD.md` 和历史变更记录。

如果代码行为与文档不一致，先以代码为准完成判断，再在同一个变更中补正文档。不要复制历史规划文档中的旧路径、旧迁移方式或旧产品定位。

每个新任务开始前，必须从当前工作区实际打开并读取根目录 `AGENTS.md` 和 `CLAUDE.md`。会话中粘贴的规范、历史记忆、入口摘要和 skill 不能替代文件读取；未实际打开文件，不得声称“已读取该文件”。同一任务后续继续执行时可复用已读取且未变化的内容，文件有变更则重新核对相关章节。

每次工作开始前应先检查：

```bash
git status --short
rg --files -g '!node_modules' -g '!frontend/dist' -g '!backend/ent/*.go'
```

不要覆盖或回滚其他人的未提交改动。修改前先阅读目标文件及其测试，保持变更集中，不做无关格式化。

## 2. 系统定位

`sub2api-extension` 是 [sub2api](https://github.com/Wei-Shaw/sub2api) 的独立附属内容承载与运营管理系统。它通过浏览器可访问的 iframe、HTTP 身份验证和少量只读/受控数据库集成接入 sub2api，不导入 sub2api 后端代码，也不修改 sub2api 源码。

系统提供：

- 管理员控制台：分析仪表盘、动态页面、系统配置、文件、发票、通知、日志、运营和运维看板。
- 数据库驱动的动态页面：公开页面 `/p/:slug` 和管理员页面 `/admin/p/:slug`，由管理员运行时创建、编辑、启停。
- Sub2API API 文档和客户端接入指南，可独立访问或作为 iframe 嵌入。
- 页面访问/功能点击埋点、分析聚合、首字延迟（TTFT）看板和消费成本核算。
- 发票申请、审核、文件和通知投递；通知渠道包括仓库当前已实现的邮件、Resend、Webhook、飞书等适配器，新增渠道前必须先核对 `notification_service.go` 和管理端类型定义。

核心边界：

- 根路径 `/` 永远跳转 `/admin/dashboard`，不是官网首页。
- 官网内容是数据库动态页，约定首页 slug 为 `/p/home`（其他站点可使用已存在的 slug，如 `/p/sub2api-home`）。不要重新硬编码一个官网 React 首页。
- Sub2API 系统名称统一从管理端「系统配置」页读取，使用公开配置中的 `siteName`（兼容旧配置 `heroTitle`）；页面标题、文档页眉/页脚、示例和其他对外文案不得另行硬编码产品名称。
- `pages`、埋点、日志、资源索引、发票申请、通知配置等数据逻辑上归附属系统所有；Sub2API 数据库连接仅用于明确的集成读取或受控同步。
- 公开页面不能包含管理员密钥、Sub2API token、密码、内部凭据或仅登录用户可见的数据。

## 3. 技术栈与目录

| 层 | 当前技术和约定 |
| --- | --- |
| 后端 | Go 1.26.5、Gin 1.12、Ent 0.14、PostgreSQL、`lib/pq`、Viper、JWT v5、`x/time/rate` |
| 前端 | React 18、TypeScript 5.6 strict、Vite 5、React Router 6、Tailwind 3、shadcn/ui、Radix、Lucide、GSAP（局部动效） |
| 测试 | Go `go test -race`；Vitest + Testing Library + jsdom |
| 构建 | pnpm 9；Docker 多阶段构建；Go `CGO_ENABLED=0`；前端 dist 由后端同源托管/嵌入 |
| 运行时 | Alpine 3.21，非 root 用户 `aux`（uid/gid 1000）；开发镜像监听 8787，生产 Compose 容器监听 8004（宿主机默认绑定 8004） |

开发和 CI 使用 Node.js 20；Docker 前端构建阶段使用 Node 24 Alpine。开发 Compose 提供 PostgreSQL 18，生产 Compose 连接外部 PostgreSQL。镜像通过 Docker Buildx 构建 `linux/amd64` 与 `linux/arm64` 并发布到 GHCR。

主要目录：

```text
backend/cmd/server/       进程入口、版本号、迁移入口
backend/internal/config/  环境变量/YAML 配置与校验
backend/internal/handler/ HTTP handler；admin/ 为管理端 handler
backend/internal/service/ 业务逻辑、Store 接口和 Ent 适配器
backend/internal/integration/ Sub2API HTTP/数据库集成
backend/internal/server/  Gin 路由与中间件
backend/internal/pkg/response/ 标准 API envelope
backend/ent/schema/       Ent schema；backend/ent/ 为生成代码（禁止手改生成文件）
frontend/src/components/  守卫、沙箱、shadcn/ui 组件
frontend/src/layouts/     AdminLayout、PublicLayout 及控制台样式
frontend/src/lib/         API、会话、埋点、注册表、主题等基础模块
frontend/src/pages/       公开页、管理页、动态页面宿主
deploy/                   Compose、环境变量示例、NGINX、更新脚本
docs/                     集成、API、Webhook、客户端文档
.agents/skills/            项目专用协作 skill
```

## 4. 外部系统与中间件耦合

### 4.1 Sub2API HTTP

`SUB2API_BASE_URL` 指向 Sub2API 后端。登录和 iframe 会话流程由 `backend/internal/integration/sub2api_client.go` 实现，当前调用 `/api/v1/auth/me` 和 `/api/v1/auth/login`（具体路径以该客户端源码为准）。

- iframe 进入时：浏览器 URL 携带 Sub2API `token`，管理员前端调用 `POST /api/aux/admin/session`；后端验证 Sub2API 用户并仅为 `role=admin` 签发本系统 JWT。发票用户入口也通过同一个头由 `UserGuard` 验证普通用户身份，授权始终以验证返回的用户 ID 为准。
- 独立登录时：`/login` 调用 `POST /api/aux/admin/login`，后端代理 Sub2API 登录后签发同一种本系统 JWT。
- 不要把 Sub2API token 当作管理 API 会话使用；管理员后续受保护请求必须用 `X-Aux-Session`。面向用户的发票端点继续使用 `X-Aux-Token`，但每次请求都要由 `UserGuard` 向 Sub2API 验证。
- 不在 localStorage、日志、动态页面或错误响应中保存/打印密码、完整 token 或完整认证响应。

### 4.2 Sub2API PostgreSQL

当配置 `SUB2API_DATABASE_*` 时，后端通过 `database/sql` 直连 Sub2API PostgreSQL。当前用途包括：

- `settings.custom_menu_items`：同步动态页面和发票入口菜单。
- `usage_logs`、`accounts`、`groups` 等：TTFT 看板和消费成本核算。
- 已完成充值订单/用户信息：发票模块只读订单并校验用户身份。

这是独立于附属系统 Ent 客户端的连接池和配置。不要把 Sub2API 读写误放到附属系统 Store，也不要在没有需求时直接修改 Sub2API 表结构。数据库集成不可用时，页面 CRUD 等本地功能应尽量继续工作，接口需返回清晰的 503/业务错误。

### 4.3 附属系统 PostgreSQL 与文件卷

附属系统 Ent schema 当前覆盖：`pages`、`page_views`、`feature_clicks`、`system_meta`、`image_assets`、发票 profile/request/order、通知 channel/delivery、`system_logs`、`operation_logs`、成本配置等。新增持久化实体必须：

- 在 `backend/ent/schema/` 添加 schema，再运行 Ent 生成流程；不要修改 `backend/ent/` 生成代码。
- 由 service 定义 Store 接口，生产实现通过 Ent adapter 注入，测试使用内存 stub/mock。
- 明确迁移策略，并在 `CHANGELOG.md` 和部署说明中说明是否需要迁移。

文件不写入 PostgreSQL：

- `SUB2API_EXTENSION_ASSET_DIR` 是资源根目录，默认 `data/assets`，容器为 `/app/data/assets`。
- 图片位于 `photos/`，发票文件位于 `invoices/`，客户端截图和图标位于 `client-docs/`、`client-icons/`。
- 数据库只存安全相对路径、原始名称、备注和 MIME/大小等元数据。
- 上传使用流式落盘、随机文件名和 MIME 魔数校验（PNG/JPEG/GIF/WebP）；不得接受客户端文件名作为路径，也不得把宿主机绝对路径写入 metadata。
- 生产备份必须同时覆盖 PostgreSQL 和 `/app/data` 卷。

### 4.4 通知与反向代理

- 通知发送器有 10 秒 HTTP 超时；Webhook 以任意 2xx 判定成功，失败写入通知投递日志，不回滚业务操作。
- Webhook 密钥通过 `Authorization` 或 `X-Webhook-Secret` 发送；接收端应按事件和业务 ID 幂等。
- 生产推荐宿主机 NGINX 终止 HTTPS，再反代到 `127.0.0.1:8004`。NGINX 不得添加 `X-Frame-Options`，否则会阻断 Sub2API iframe；保留 `nosniff`、HSTS 和严格 referrer policy。
- 浏览器 iframe、公开 URL 使用 `SUB2API_EXTENSION_PUBLIC_URL` 对应的公网/可解析域名；后端容器之间可以使用 Docker 服务名。不要把 `http://aux-backend:8787` 配给浏览器。

## 5. 后端开发规范

### 5.1 分层和依赖

保持 `handler -> service -> Store/integration` 的方向：

- handler 只负责 HTTP 输入、鉴权上下文、状态码和响应；不承载业务规则。
- service 负责校验、事务、业务错误和跨 Store 协调；依赖接口而不是 `*ent.Client`。
- integration 封装 Sub2API HTTP 或原始 SQL；不要让 handler 直接执行 SQL。
- 狭窄接口在消费方定义，例如 service 的 `TelemetryStore`、handler 的 provider 接口。
- 构造器命名 `NewThing`；一个 Go 文件通常只负责一个主要类型/概念。

### 5.2 HTTP、错误和日志

所有 API 必须使用统一 envelope：

```json
{"code": 0, "message": "success", "data": {}}
{"code": 400, "message": "...", "reason": "..."}
```

使用 `internal/pkg/response` 的 `Success`、`Created`、`BadRequest`、`Unauthorized`、`Forbidden`、`ServiceUnavailable`、`InternalError` 等函数。禁止返回裸 `gin.H{"error": ...}`。

- service 定义 `ErrXxx` sentinel error，调用方用 `errors.Is`，不要字符串比较。
- 包装错误使用 `fmt.Errorf("...: %w", err)`；并发任务的多个错误使用 `errors.Join`，不要吞掉第二个错误。
- 输入长度、枚举、空值等在写库前校验，并与 Ent schema 的约束保持一致。
- 500 响应使用通用信息，不向客户端泄漏 SQL、路径、凭据或内部堆栈；详细原因写服务端日志。
- 日志应带来源、业务 ID 和必要上下文；绝不打印密码、Sub2API token、JWT、Webhook secret 或 SMTP 密码。
- 请求经过 Gin logger、持久化 `RequestLogger`、Recovery；管理员写操作经过 `OperationLogger`。

### 5.3 路由与中间件

当前路由分组：

- `GET /health`：公开健康检查。
- `/api/aux/*`：公开配置、公开页面、公开资源、发票用户入口和埋点。
- `POST /api/aux/admin/session`、`POST /api/aux/admin/login`：在守卫外完成会话交换/登录。
- `/api/aux/admin/*` 其余端点：必须挂 `AdminGuard`。

`AdminGuard` 校验 `X-Aux-Session`（本系统 HS256 JWT），不是 `X-Aux-Token`；发票用户端点使用 `UserGuard` 校验 `X-Aux-Token`。`TelemetryGuard` 保护匿名埋点：请求体上限 4 KiB、按 IP 令牌桶限流（默认 5 req/s、burst 10），超限返回 413/429。新增匿名写端点必须做同等级限制、校验和审计。

### 5.4 命名、格式与注释

- Go 文件使用 `snake_case.go`，测试文件与源码同目录；前端组件/页面使用 `PascalCase.tsx`，基础模块使用 `kebab-case.ts`，测试与源码同目录。
- Go 导出标识符使用 `PascalCase`，非导出标识符使用 `camelCase`，构造器命名 `NewThing`；前端函数和变量使用 `camelCase`，React 组件使用 `PascalCase`，模块常量使用 `UPPER_SNAKE_CASE`。
- Go 修改后运行 `gofmt -s`；前端保持现有 2 空格风格，以 TypeScript strict、构建和测试作为格式与类型门禁。导入前端模块使用 `@/` 别名，不新增无必要的 barrel 文件。
- 每个文件只承载一个主要概念；接口在消费方定义。新增服务先定义 Store/provider 接口，再注入 Ent 或外部系统实现，测试使用内存 stub/mock。
- 注释写设计原因、边界和安全前提，优先使用中文；不要写重复代码含义的注释、长期 TODO 或注释掉的旧实现。公开 Go 标识符和非直观的 TypeScript API 必须有简短文档。
- 所有外部请求、数据库查询和后台任务都要继承 `context.Context` 并设置合理超时；并发任务必须等待退出，多个错误用 `errors.Join` 保留完整链路。

## 6. 前端开发规范

### 6.1 类型、模块和路由

- TypeScript `strict`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch` 必须通过。
- 使用 `@/` 路径别名直接导入 `src` 模块；不新增 barrel 文件。
- React 组件/页面使用 `PascalCase.tsx`，基础模块使用 `kebab-case.ts`，测试与源码同目录。
- API 请求统一走 `frontend/src/lib/api-client.ts`：默认 15 秒超时、`cache: no-store`，自动附加 `X-Aux-Session` 和（如存在）`X-Aux-Token`。
- 路由以 `frontend/src/App.tsx` 为准。管理员路由必须位于 `AdminGuard` 和 `AdminLayout` 下。

### 6.2 页面身份和埋点

`frontend/src/lib/page-registry.ts` 是静态页面身份的单一真相源，`dynamic-pages.ts` 将数据库动态页以 `page:<slug>` 命名空间合并。路由、埋点和分析必须使用同一 id：

- 静态页面：在 `STATIC_PAGE_REGISTRY` 增加唯一 `id/title/path/visibility`，并在 `App.tsx` 注册对应路由。
- 动态页面：通过 `/admin/pages` 或受控 seed 写入数据库，不要在源码中复制内容。
- 页面访问使用 `trackPageView(pageId)`；功能点击使用 `trackFeatureClick`。埋点失败必须 fire-and-forget，不能阻塞页面或向用户抛错。
- 后端分析只返回原始计数，前端负责与注册表合并；后端不得导入或耦合前端页面列表。

### 6.3 动态内容安全

HTML 动态页必须使用 `SandboxRenderer`：`sandbox="allow-scripts"`、opaque origin、限制 CSP，禁止 `dangerouslySetInnerHTML` 渲染数据库 HTML。通过 `data-feature-id` 和 `postMessage` 做统计，不能把消息当权限凭据。

React/TSX 动态页由 Babel CDN 编译后在宿主上下文通过 `new Function` 执行，**不是沙箱**。它只适用于受信任管理员：

- 使用 `export default` 函数组件；不要写 import 或引用未注入的 npm 模块。
- 不得把 token、密码、内部 URL 或密钥写入数据库代码。
- 修改编译器必须补编译失败、执行失败和安全边界测试；离线环境需要重新评估 Babel CDN 依赖。

### 6.4 视觉和交互风格

保持现有设计系统，不引入另一个颜色或组件体系。shadcn/ui 是全局业务控件的强制统一方案，具体执行规则见第 6.5 节：

- 管理控制台：Geist 字体、中性暖灰背景（约 `#f1f0eb`）、白色/深色表面、靛蓝主色、暖橙状态色；使用 shadcn/ui、Radix 和 Lucide，圆角和阴影克制，信息密度适合重复操作。
- 客户端文档/API 文档：使用 `frontend/tokens.css` 中命名的 OKLCH 变量；暖白纸面、中性文字、酒红强调色，并支持 `data-theme` 的浅色/深色主题。主题只作用于当前页面根元素。
- 发票门户是独立视觉域，沿用其现有 `invoice-*` 变量和响应式规则，不把管理控制台样式泄漏进去。
- 必须复用现有 token、Tailwind utility、shadcn/ui 组件和 `lucide-react` 图标；工具按钮使用图标和 `Tooltip`，避免用长文本模拟图标。不得以“功能简单”或“现有页面用了原生控件”为由跳过组件规范。
- 页面必须覆盖加载、空数据、错误、禁用、成功和移动端状态；文字不能溢出或遮挡。
- 尊重 `prefers-reduced-motion`；GSAP 只用于局部反馈，内容不能依赖滚动动画才能出现。
- 保持键盘焦点、语义标签、可读对比度和响应式断点；不要为装饰添加孤立渐变球或大面积营销式卡片。

### 6.5 shadcn/ui 组件强制执行

本节适用于 `frontend/src/` 宿主应用内所有新增或本次任务改造的业务控件，包括管理控制台、公开文档页和发票门户。各视觉域继续使用自己的 token；统一组件不能成为跨页面覆盖主题的理由。数据库动态内容仍须遵守第 6.3、8 节的渲染和模块注入边界。

- **先查组件再写页面**：修改前必须检查 `frontend/src/components/ui/` 中的组件实现和项目现有组合用法，通过 `@/components/ui/*` 导入。已有业务封装符合本节时直接复用；缺少组件时，按当前 React、Radix 和 Tailwind 版本补齐 shadcn/ui 实现，不得另引 UI 体系或手写外观替代品。
- **禁止原生业务控件替代**：页面中不得新增裸 `<button>`、`<input>`、`<select>`、`<textarea>` 等来替代已有 shadcn/ui 控件，也不得使用 `div + onClick` 模拟按钮、选择框或弹层。组件底层的原生元素、语义布局标签、必要的隐藏文件输入及表单桥接不属于此禁令；不能借这些底层用途为普通可见业务控件开例外。
- **组件与交互同时统一**：必须采用 shadcn/ui 的标准组合、键盘操作、焦点管理、禁用态和弹层行为。仅把原生元素改成组件名，随后自行拆分标准交互或用 CSS 模拟另一套控件，不算满足要求。

| 业务需求 | 必须使用的组件与交互 |
| --- | --- |
| 按钮、输入、文本域、字段标签 | `Button`、`Input`、`Textarea`、`Label` |
| 普通单选下拉、每页条数 | `Select`、`SelectTrigger`、`SelectContent`、`SelectItem`；不得保留浏览器原生下拉框 |
| 搜索式选择、多选账号 | `Popover + Command` 或基于它们的现有业务封装 |
| 单日选择 | `Button + Popover + Calendar`，使用单日模式 |
| 日期范围筛选 | **单个范围按钮 + 同一个 Popover + Calendar 的 `mode="range"`**；按钮显示起止日期，日历连续高亮区间，桌面双月、窄屏单月，提供清除操作。不得默认拆成两个独立日期框或两套单日弹层；只有用户明确要求分开输入时才改变该交互 |
| 分页 | `Pagination`、`PaginationContent`、`PaginationItem` 及其链接或 `Button`；保留真实的禁用语义和可访问名称 |
| 弹窗、侧栏、提示、表格、页签、开关 | 按需使用现有 `Dialog`、`Sheet`、`Tooltip`、`Table`、`Tabs`、`Switch` |

- **允许调整密度，不得重造组件**：尺寸、间距、响应式和颜色通过现有 variant、token 与 `className` 调整；保留组件本身的语义和交互，不为追求“自定义样式”移除可访问性行为。
- **旧代码不是豁免依据**：源码优先用于确认当前行为，不表示旧代码的原生控件符合新规范。本次新增或改造的控件必须遵守本节；未涉及的旧页面不做无关全量替换。
- **交付前逐项核对**：检查本次 diff 中的控件导入、原生元素和组合方式；日期范围必须实测同日、跨月、重新选择、清除和移动端。类型检查、测试与构建通过不能替代浏览器交互及样式检查。发现偏离时须在交付前修正，不得等用户再次指出。

## 7. Skill 使用规范

Skill 是执行任务时的补充方法库，不是本项目事实来源。先以当前源码、测试和本文件为准，再加载与任务直接相关的 skill；不要为了“覆盖更多建议”同时加载互相冲突的技能。

### 7.1 任务类型到 skill 的映射

| 任务类型 | 必选/主 skill | 可选 skill | 使用边界 |
| --- | --- | --- | --- |
| 管理控制台页面、运营看板、管理表单 | `gpt-taste`、`gsap-core`、`gsap-react` | `gsap-scrolltrigger`、`gsap-performance`、`react-development`、`frontend-ui-engineering` | 沿用项目的 Geist、暖灰背景、靛蓝主色、信息密度和 shadcn/Radix 组件。`gpt-taste` 用于视觉层级和交互质感，GSAP 只做局部反馈、进入态或数据变化过渡；不得机械套用营销页的巨大 Hero、AIDA 文案或装饰性卡片。需要滚动驱动动画时才加载 `gsap-scrolltrigger`，遇到复杂或高频动画才加载 `gsap-performance`。 |
| 客户端接入文档、API 文档、帮助中心、教程页 | `hallmark` | `frontend-design`、`react-development` | 优先保证阅读流、标题层级、代码示例、复制操作、目录导航、主题和移动端排版。使用 `frontend/tokens.css` 与文档页面现有主题，不把控制台的运营密度或发票门户的视觉变量带入文档页。 |
| 数据库动态 HTML/React 页面 | `sub2api-extension-page-writer` | 根据内容类型选择 `gpt-taste`（运营/展示页）或 `hallmark`（文档/教程页） | 先按页面 skill 校验 slug、字段、内容大小、资源 URL、seed 和渲染器约束，再做视觉实现。HTML 必须走 iframe 沙箱；动态 React/TSX 是受信任管理员内容，在宿主上下文执行，不能存放秘密。 |
| Sub2API iframe、登录、菜单、域名、CSP、会话交换 | `sub2api-extension-integration` | `api-engineering`、`devsecops` | 先核对 `X-Aux-Token`、`X-Aux-Session`、Sub2API HTTP/数据库边界、`/` 与 `/p/home` 路由、iframe 头部和 CSP。任何身份、跨域或菜单改动都要补集成测试和文档。 |
| Docker、Compose、NGINX、GHCR、发布、更新、回滚 | `sub2api-extension-operations` | `ci-cd-and-automation`、`release-engineering`、`observability` | 以 `deploy/`、`.github/` 和实际启动脚本为准，核对端口、外部 PostgreSQL、卷备份、健康检查、架构镜像和回滚路径。不要仅依据旧文档假定存在独立迁移容器。 |
| Go API、handler、service、中间件、错误响应 | `backend-engineering`、`api-engineering` | `code-review-and-quality`、`debugging-and-error-recovery` | 保持 `handler -> service -> Store/integration`，使用统一 response envelope、sentinel error、context 超时、鉴权和审计约定。skill 的通用 REST 建议必须服从当前 Gin 路由和中间件实现。 |
| Ent schema、PostgreSQL、迁移、查询性能 | `database-engineering` | `backend-engineering`、`performance-optimization` | 只改 `backend/ent/schema/`，通过 Ent 生成代码；确认附属库与 Sub2API 库边界、迁移可回退性、索引和连接池。禁止手改 `backend/ent/` 生成文件。 |
| 复杂 React 组件、路由、状态、测试 | `react-development`、`frontend-ui-engineering` | `gpt-taste`、`gsap-react`、`playwright` | 遵守 TypeScript strict、`@/` 别名、现有 registry、埋点、主题和可访问性；先复用现有组件，再引入新抽象。需要浏览器行为验证时使用 Playwright。 |
| 文档、ADR、README、变更记录 | `documentation-and-adrs` | `hallmark`（文档页面的视觉设计） | 技术文档记录当前实现、决策、影响和验证命令；不要把规划状态写成已实现事实。页面文案和仓库文档是两种交付物，分别遵守内容和视觉规范。 |
| 安全、鉴权、动态执行、文件上传、Webhook | `code-audit`、`devsecops` | `backend-engineering`、`database-engineering` | 重点检查 token/密钥泄漏、路径穿越、动态代码边界、CSP、重放/幂等、限流和日志脱敏。若本机没有对应 skill，以本文件安全约束和源码测试为准。 |

表中的全局 skill 以 skill 名称加载；项目专用 skill 使用仓库内 `.agents/skills/<name>/SKILL.md`。目前仓库内已固定提供：

- `.agents/skills/sub2api-extension-page-writer/SKILL.md`
- `.agents/skills/sub2api-extension-integration/SKILL.md`
- `.agents/skills/sub2api-extension-operations/SKILL.md`

### 7.2 Skill 加载和执行流程

1. 先用 `git status --short`、`rg --files` 和目标模块测试确定任务范围，判断是控制台、文档页、动态页、接口、数据模型还是部署变更。
2. 读取本节映射的主 skill；只有在任务确实需要时才读取可选 skill。项目专用 skill 优先于同名或泛化的全局建议。
3. 把 skill 作为实现方法参考，使用 `AGENTS.md`、当前源码、测试和配置覆盖其中与本项目冲突的默认值。特别是运营控制台不能套用营销网站规则，动态 React 不能被误写成沙箱代码。
4. 实现时复用现有 token、组件、Store、middleware、命令和测试夹具；前端控件必须逐项满足第 6.5 节，不得用 skill 示例或个人偏好覆盖 shadcn/ui 组件与标准交互要求。不要为了满足 skill 示例而引入新的框架、颜色体系或目录层级。
5. 完成后运行受影响层的类型检查、单元测试、构建或部署健康检查；涉及共享鉴权、schema、动态渲染和部署时扩大验证范围。
6. 最终交付说明中写明实际读取过的 skill、验证命令和未覆盖的风险，便于下一位维护者继续工作。

### 7.3 视觉 skill 的冲突处理

- `gpt-taste`、`hallmark`、`frontend-design` 的通用视觉建议不能覆盖本项目现有 token、页面身份、响应式断点、可访问性和信息密度。
- `gsap-*` 只解决动效实现和性能，不决定页面结构、文案或业务流程；动画失败、禁用或 `prefers-reduced-motion` 时内容仍必须完整可用。
- 一个页面只选一个主视觉方向：管理控制台优先 `gpt-taste`，文档/教程优先 `hallmark`。只有跨域页面确实包含两种内容时，才按页面区域拆分并明确各自 token。
- 动态页面先满足 `sub2api-extension-page-writer` 的数据模型和安全约束，再套用视觉 skill；数据库内容不能反向改变宿主应用的鉴权和 CSP。

## 8. 动态页面操作约束

创建或修改动态页面前先阅读 `.agents/skills/sub2api-extension-page-writer/SKILL.md`。关键规则：

- slug 只允许小写字母、数字和连字符，单页 HTML/React 内容上限 256 KiB。
- `visibility=public` 使用 `/p/<slug>`；`visibility=admin` 使用 `/admin/p/<slug>`。
- `metadata.logo` 和其他图片使用浏览器可访问的完整 HTTP(S) URL，优先从 `/admin/files` 复制；不要存相对路径或本机路径。
- `full_bleed`、`scroll_mode` 等字段按渲染器要求使用字符串；`trusted_partners` 当前是 JSON 字符串，修改前先看 `SandboxRenderer` 和现有 seed。
- 新增静态页必须同时更新 registry、路由、页面组件、埋点和测试；新增客户端文档必须更新 `client-guides.ts`、图标/截图资源和相关测试。

## 9. 配置、启动和常用命令

配置优先级为环境变量，其次是当前目录或 `./config/config.yaml`。必需配置由 `backend/internal/config/config.go` 校验：附属数据库 host/user/dbname/port、`JWT_SECRET`、`SUB2API_BASE_URL`。生产必须使用稳定随机 JWT secret，不能每次重启生成新值。

后端本地开发（宿主机直接运行）：

```bash
cd backend
go mod download
make migrate          # 对附属数据库执行幂等 Ent 建表
make dev              # debug，默认 8004；前端 Vite 代理到此端口
make test-unit        # go test -race -count=1 ./...
make test-integration # 需要真实 PostgreSQL，带 integration tag
make vet
make fmt
make tidy
```

前端：

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run dev           # 默认 3100
```

根目录快捷命令：`make dev-config`、`make dev-up`、`make dev-status`、`make dev-health`、`make dev-logs`、`make dev-down`、`make backend-test`、`make frontend-test`。

开发 Compose (`deploy/docker-compose.dev.yml`) 包含 `aux-postgres`、一次性 `aux-migrate` 和 `aux-backend`，并加入已存在的 Sub2API Docker 网络。宿主机直接 `make dev` 时不要使用容器服务名，按 Makefile 的 `DEV_*` 变量连接本机映射端口。

生产 Compose (`deploy/docker-compose.yml`) 不包含 PostgreSQL，使用外部数据库和 GHCR 镜像，默认绑定 `127.0.0.1:8004`。当前服务启动默认执行幂等 `Ent Schema.Create`；设置 `AUTO_MIGRATE=false` 可禁用。发布包含 schema 变化时，先确认迁移策略和回退兼容性，数据库变更不会因二进制回退而撤销。

## 10. 测试、提交和发布

提交前至少运行受影响层的检查；涉及共享 API、鉴权、路由、schema、动态渲染或部署时运行更完整的检查。CI 当前要求：

- Go 1.26.5，`go test -race -count=1 ./...`，golangci-lint v2.9。
- 前端 `pnpm run typecheck`、`pnpm run test`、`pnpm run build`。
- 安全扫描：Go 漏洞扫描和 `pnpm audit --prod --audit-level=high`。

测试原则：测试行为和边界，不要写只重复实现细节的测试；鉴权、错误映射、并发错误、埋点限流、动态渲染失败和文件路径安全应优先覆盖。

Git 提交信息和版本 tag 说明统一使用中文：

- 提交标题、正文和脚注都用中文描述；`feat`、`fix`、`docs`、`refactor` 等英文前缀仅作为 CI 可识别的类型标记，scope、主题和正文必须是中文。推荐格式为 `feat(页面): 新增客户端接入文档`、`fix(鉴权): 修复会话交换失败时的错误映射`。除代码标识符、命令、路径、协议字段和版本号外，不要用英文句子代替中文说明。
- 提交正文需要写清变更原因、主要改动和验证结果；涉及行为、安全、schema 或部署变化时，同时说明兼容性、迁移和回滚影响。不要用“杂项更新”“同步代码”等无法审查的空泛信息。
- tag 名称保留 `vX.Y.Z` 或 `vX.Y.Z-rc.N` 的语义化版本格式，以便 Release 工作流和依赖工具识别；tag 的 annotated message（标题和正文）必须使用中文，并且必须写上该发布版本的实际内容，不能只写版本号。
- 正式版本创建前先把 `CHANGELOG.md` 的“未发布”内容整理为 `## [X.Y.Z] - YYYY-MM-DD`，至少记录新增功能、问题修复、破坏性变化/迁移、配置或环境变量变化、升级步骤和已知限制。tag 说明应与该版本章节一致。

示例：

```bash
git commit -m "feat(页面): 新增客户端接入文档" -m "补充 API 示例、复制操作和移动端排版。已运行前端类型检查与测试。"
git tag -a v0.7.0 -m $'发布版本 v0.7.0：完善客户端文档与动态页面规范\n\n版本内容：\n- 新增客户端接入文档的代码示例和主题适配\n- 修复动态页面资源地址校验问题\n- 数据模型无变化，无需额外迁移\n- 升级后运行健康检查；如异常可回退到 v0.6.2'
git push origin main v0.7.0
```

Release 工作流只构建/发布镜像和 amd64/arm64 更新包，不直接连接生产；生产更新由管理员主动触发并保留原子替换、校验、回退和健康检查流程。

## 11. 变更完成清单

- [ ] 已从当前工作区实际读取 `AGENTS.md` 和 `CLAUDE.md`，并核对相关章节。
- [ ] 已确认页面/接口属于静态核心能力还是数据库动态内容。
- [ ] 已阅读相关 handler、service、Store/integration 和现有测试。
- [ ] 新增管理员 API 位于 `AdminGuard` 下，匿名写端点有体积/速率限制。
- [ ] 响应使用标准 envelope，错误使用 sentinel 和 `errors.Is`。
- [ ] schema、迁移、seed、持久化卷和回退影响已说明。
- [ ] 页面使用 registry、埋点、主题、响应式和可访问性约定。
- [ ] 新增或改造的业务控件使用 shadcn/ui 及标准组合交互，无裸原生控件替代；日期范围采用单入口范围日历。
- [ ] 已在浏览器检查控件的实际样式、键盘焦点、禁用态、清除操作和移动端布局，不以类型检查或测试通过代替 UI 验收。
- [ ] 未泄漏密码、JWT、Sub2API token、Webhook/SMTP 密钥或绝对路径。
- [ ] 已运行对应的 Go/前端测试、类型检查、构建或部署健康检查。
- [ ] 若行为改变，已同步 `README.md`、相关 `docs/`、skill 和 `CHANGELOG.md`。

## 12. 相关资料入口

- `README.md`：产品定位、入口、快速开始和架构概览。
- `docs/INTEGRATION.md`：Sub2API 菜单、官网、iframe 和域名集成。
- `docs/PAGE_API.md`：动态页面管理 API、字段和鉴权。
- `docs/WEBHOOK.md`：Webhook 协议和幂等建议。
- `docs/CLIENT_GUIDES.md`：客户端接入文档维护规则。
- `.github/CICD.md`：CI、测试部署、Release 和通知。
- `deploy/UPDATES.md`、`deploy/nginx/README.md`：生产安装、更新、NGINX 和回滚。
- `.agents/skills/sub2api-extension-integration/SKILL.md`：集成排查。
- `.agents/skills/sub2api-extension-operations/SKILL.md`：部署运维。
- `.agents/skills/sub2api-extension-page-writer/SKILL.md`：页面和动态内容。
