# sub2api-extension 的 Claude 工作规范

你正在维护一个与 Sub2API 配套的独立 Go + React 附属系统。开始任何任务前必须阅读根目录的 [AGENTS.md](AGENTS.md)；它是本项目的完整规范和当前实现事实，本文件是 Claude 的启动入口与强制摘要。

规范持续优化中。用户提出额外的通用开发细节、重复约束或团队习惯时，先询问用户是否要把它沉淀到 `AGENTS.md` 及相关入口；获得确认后再更新，并同步检查引用和内容一致性。单次任务的临时要求不自动写入规范。

## 必须先记住的边界

- 根路径 `/` 跳转 `/admin/dashboard`。官网是数据库动态页 `/p/home`，不要恢复硬编码官网首页。
- 不修改或导入 Sub2API 源码。集成只经过 Sub2API HTTP 身份接口、`custom_menu_items` 受控同步，以及 `SUB2API_DATABASE_*` 的明确只读/受控查询。
- `X-Aux-Token` 是 iframe 传入的 Sub2API token：管理员用它换取本系统会话，发票用户端点由 `UserGuard` 用它验证身份；管理 API 后续请求必须使用本系统签发的 `X-Aux-Session`。
- `/api/aux/admin/session` 和 `/api/aux/admin/login` 在守卫外；其他管理员端点必须位于 `AdminGuard` 下。发票用户端点必须位于 `UserGuard` 下；匿名埋点必须使用 `TelemetryGuard` 的 4 KiB body 限制和按 IP 令牌桶。
- 所有后端响应使用 `internal/pkg/response` 的标准 envelope；不要返回裸 `gin.H{"error": ...}`，不要字符串比较错误。
- HTML 动态页必须通过 `SandboxRenderer` iframe；动态 React/TSX 使用 `new Function` 在宿主上下文执行，只允许受信任管理员，绝不能存放秘密。
- 静态页面身份以 `frontend/src/lib/page-registry.ts` 为准，动态页面 id 为 `page:<slug>`。后端分析不能耦合前端 registry。
- 数据库只保存页面和文件元数据；图片/发票/客户端截图在 `/app/data/assets` 持久卷。不要写入绝对路径或把二进制塞进 PostgreSQL。

## 技术与样式约束

- 后端固定 Go 1.26.5 + Gin + Ent + PostgreSQL；前端固定 React 18 + TypeScript strict + Vite + Tailwind + shadcn/Radix + Lucide。
- 使用现有 Store 接口和 service 分层；不要让 service 直接暴露 `*ent.Client`，不要手改 `backend/ent/` 生成文件。
- 前端使用 `@/` 别名、同目录测试和现有 token。管理端保持 Geist、暖灰背景、白/深色表面、靛蓝主色和克制圆角；客户端/API 文档使用 `frontend/tokens.css` 的 OKLCH 变量与 `data-theme`；发票门户保持自己的 `invoice-*` 视觉域。
- 使用 Lucide 图标、shadcn 组件和可访问的 tooltip；处理加载、空数据、错误、禁用、成功、移动端和 `prefers-reduced-motion` 状态。

## Skill 速查

- 管理控制台、运营看板：`gpt-taste` + `gsap-core` + `gsap-react`；滚动动画或性能问题再加 `gsap-scrolltrigger` / `gsap-performance`。
- 客户端/API 文档、教程：`hallmark`，按需配合 `frontend-design`；优先阅读流、代码示例、主题和响应式。
- 数据库动态页：先读 `.agents/skills/sub2api-extension-page-writer/SKILL.md`，再按内容选 `gpt-taste` 或 `hallmark`；牢记 HTML iframe 沙箱与 React `new Function` 信任边界。
- Sub2API iframe、登录、菜单、域名和 CSP：`.agents/skills/sub2api-extension-integration/SKILL.md`。
- Docker、Compose、NGINX、GHCR、发布和回滚：`.agents/skills/sub2api-extension-operations/SKILL.md`。
- Go API/服务：`backend-engineering` + `api-engineering`；Ent/PostgreSQL：`database-engineering`；复杂 React：`react-development` + `frontend-ui-engineering`；ADR/仓库文档：`documentation-and-adrs`；安全审查：`code-audit` + `devsecops`。

只加载与当前任务直接相关的 skill。skill 是方法参考，项目源码、测试和根目录 `AGENTS.md` 优先；完成后在交付说明中列出使用过的 skill 和验证命令。

## 常用验证

```bash
cd backend && make test-unit && make vet
cd ../frontend && pnpm install --frozen-lockfile && pnpm run typecheck && pnpm run test && pnpm run build
```

涉及真实数据库时再运行 `make test-integration`。本地服务默认后端 8004、Vite 3100；开发容器服务端口 8787；生产 Compose 容器与宿主机默认均使用 8004，并由 NGINX 提供 HTTPS。当前生产服务默认执行幂等 Ent 自动迁移，`AUTO_MIGRATE=false` 可禁用；不要依据旧文档假定一定存在独立迁移容器。

## Claude 执行流程

1. `git status --short`，确认并保留已有改动。
2. 阅读相关源码、测试和 `.agents/skills/` 项目 skill。
3. 先做最小实现，沿用现有命名、错误、响应、鉴权和样式模式。
4. 为共享行为和安全边界补有意义的测试。
5. 运行受影响层的检查，必要时运行完整 CI 等价命令。
6. 若路由、配置、数据模型、部署或用户行为改变，同步 README/docs/CHANGELOG，并在结果中说明验证和剩余风险。

Git 提交标题、正文和 tag 说明使用中文；`feat`、`fix`、`docs`、`refactor` 仅保留为可选的机器类型前缀，scope 和实际描述必须中文。正式 tag 名称使用 `vX.Y.Z`（便于 CI 识别），annotated tag 标题/正文必须包含该版本的中文发布内容，并与 `CHANGELOG.md` 的版本章节一致，至少写明新增、修复、迁移/兼容性、升级和回滚信息。例如：`git tag -a v0.7.0 -m "发布版本 v0.7.0：新增客户端文档，修复动态资源校验；无需迁移，升级后执行健康检查"`。

不要输出、提交或写入密码、JWT、Sub2API token、Webhook/SMTP 密钥、生产 `.env` 或宿主机绝对路径。
