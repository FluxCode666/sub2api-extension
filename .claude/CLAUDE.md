<!-- GSD:project-start source:PROJECT.md -->

## Project

**sub2api-extension · 通用页面管理系统**

sub2api-extension 是 sub2api 的独立附属内容承载系统(Go + Ent 后端 / React 前端,经 iframe 嵌入 sub2api 控制台),提供数据库驱动的官网动态页、动态页面管理、图片资源和分析仪表盘。官网内容通过 `pages` 表运行时读取；`homepage-config` 菜单页已移除，但后端旧配置 API 仍作为兼容代码保留，除非明确迁移，否则不要重新暴露该菜单。

**Core Value:** 管理员能通过管理端 UI 动态创建并发布页面(含路由与权限配置),页面立即可访问——这是整个系统存在的意义,其它一切为此服务。

### Constraints

- **Tech stack**: 后端 Go+Gin+Ent+PostgreSQL 不可替换;前端 React+Vite+TS+Tailwind 不可替换 — 保留现有栈,增量加 gsap/shadcn/ui
- **Compatibility**: 零侵入 sub2api — 所有集成走现有 `custom_menu_items`/`home_content` 接缝,不修改 sub2api 代码
- **Security**: 动态 HTML 必须使用 `SandboxRenderer` iframe；动态 React 代码通过 `new Function` 在主应用上下文执行，不是沙箱，只允许受信任管理员使用 — 防止 XSS 窃取 admin session(localStorage 存 JWT); public 动态页面需复用现有埋点限流
- **Compatibility**: page-registry id 命名空间一致性不可破坏 — 动态页与静态核心页共享同一 id 空间,埋点与仪表盘聚合依赖此
- **Dependencies**: 预装 gsap + shadcn/ui(及 tailwindcss-animate、Radix primitives、clsx、tailwind-merge 等) — 供静态页面与管理端 UI 使用；数据库 HTML 在 iframe 内自包含，不能直接导入宿主模块
- **Performance**: 动态页面渲染不可拖慢管理端首屏 — 沙箱 iframe 懒加载,动态路由按需挂载

### Current implementation authority

- 根路径 `/` 跳转 `/admin/dashboard`；TERALEMO 官网是数据库动态页 `/p/home`，Sub2API 官网是 `/p/sub2api-home`。
- 静态页面注册表以 `frontend/src/lib/page-registry.ts` 为准；当前没有 `home` 或 `homepage-config` 静态项。
- `/admin/pages` 与 `/admin/assets` 是管理操作入口；页面内容、metadata 和图片索引由数据库/持久化卷驱动。seed 和 Ent migration 都是显式运维动作，用户访问不会执行 seed，服务启动也不会自动迁移。
- 公开 `/api/aux/pages` 只返回已启用的 public 页面；AdminLayout 在会话建立后通过受守卫的 `/api/aux/admin/pages` 获取 admin 页面元数据。下方 GSD 生成的架构/规划段落可能保留历史命名；处理页面、嵌入或部署任务时，以本节和 `.agents/skills/` 下的项目 skill 及实时源码为准。

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- Go 1.26.5 - Backend HTTP server, ORM, business logic, sub2api integration (`backend/`)
- TypeScript ~5.6.0 - Frontend SPA, API client, telemetry SDK (`frontend/src/`)
- SQL (PostgreSQL dialect) - Ent-generated schema/migrations, raw `timestamptz`/`text` types defined in `backend/ent/schema/`
- CSS (Tailwind utility classes) - Styling via `frontend/src/index.css` + `frontend/tailwind.config.js`
- YAML - Docker Compose (`deploy/docker-compose*.yml`), CI workflows (`.github/workflows/`), config example (`deploy/config.example.yaml`)
- Dockerfile syntax - Multi-stage build at `Dockerfile`

## Runtime

- Go 1.26.5 (backend runtime; locked and verified in CI via `go version | grep -q 'go1.26.5'` in `.github/workflows/ci.yml`)
- Node.js 20 (frontend build + CI; `node-version: '20'` in `.github/workflows/ci.yml`). Dockerfile builder uses `node:24-alpine` for the image build stage.
- PostgreSQL 18 (`postgres:18-alpine` in `deploy/docker-compose.yml`); production points at external PostgreSQL (no DB image in `deploy/docker-compose.prod.yml`)
- Alpine Linux 3.21 (`alpine:3.21` final runtime image in `Dockerfile`)
- Go modules (`backend/go.mod`, `backend/go.sum`) - module name `sub2api-extension`
- pnpm 9 (frontend; pinned via corepack in `Dockerfile`, `pnpm/action-setup@v4` in CI). Lockfile: `frontend/pnpm-lock.yaml` (present)

## Frameworks

- Gin `github.com/gin-gonic/gin` v1.12.0 - HTTP router/middleware (`backend/internal/server/router.go`, `backend/internal/handler/`)
- Ent ORM `entgo.io/ent` v0.14.6 - Code-generated data layer; schemas in `backend/ent/schema/`, generated code in `backend/ent/` (e.g. `backend/ent/client.go`)
- React 18 `react` ^18.3.1 + `react-dom` ^18.3.1 - SPA UI (`frontend/src/`)
- react-router-dom `^6.26.0` - Client routing (`frontend/src/App.tsx`, `frontend/src/main.tsx`)
- Vite `^5.0.10` (`@vitejs/plugin-react` ^4.3.1) - Dev server + bundler (`frontend/vite.config.ts`)
- Tailwind CSS `^3.4.0` - Utility CSS (`frontend/tailwind.config.js`, `frontend/postcss.config.js` with `autoprefixer` ^10.4.16)
- Viper `github.com/spf13/viper` v1.21.0 - Config loading (env + YAML) in `backend/internal/config/config.go`
- Go testing (`testing` stdlib) + `github.com/stretchr/testify` v1.11.1 - Backend unit/integration tests
- Vitest `^2.1.9` - Frontend test runner (`frontend/vite.config.ts` test block, `frontend/src/test-setup.ts`)
- `@testing-library/react` ^16.3.2 + `@testing-library/jest-dom` ^6.4.0 + `@testing-library/user-event` ^14.6.4 - Component tests
- jsdom `^24.1.3` - DOM environment for Vitest (`environment: 'jsdom'`)
- Vite build (`pnpm run build` = `tsc -b && vite build --config vite.config.ts`) - Frontend production bundle to `frontend/dist/`
- `go build` with CGO disabled, ldflags injecting version/commit/date (`backend/Makefile` `build` target, `Dockerfile` Stage 2)
- Docker Buildx multi-arch (`linux/amd64,linux/arm64`) in `.github/workflows/deploy-test.yml` and `.github/workflows/deploy-production.yml`
- govulncheck (backend security), `pnpm audit --prod --audit-level=high` (frontend security) in `.github/workflows/security-scan.yml`

## Key Dependencies

- `github.com/golang-jwt/jwt/v5` v5.3.1 - Signs/validates the sub2api-extension admin session JWT (HS256) in `backend/internal/service/auth_service.go`; frontend validates expiry client-side in `frontend/src/lib/admin-auth.ts`
- `github.com/lib/pq` v1.12.3 - PostgreSQL driver imported in `backend/cmd/server/main.go` (`_ "github.com/lib/pq"`); DSN built in `backend/internal/config/config.go` `DatabaseConfig.DSN()`
- `github.com/spf13/viper` v1.21.0 - Env-first config with YAML fallback; see `Load()` / `LoadFromEnv()` in `backend/internal/config/config.go`
- `golang.org/x/time` v0.15.0 - `rate.Limiter` token bucket for per-IP throttling on telemetry endpoints (`backend/internal/server/middleware/telemetry_guard.go`)
- `entgo.io/ent` v0.14.6 - Entire data layer (telemetry write + analytics aggregate + system_meta homepage config)
- `github.com/gin-gonic/gin` v1.12.0 - Request pipeline, JSON binding (`ShouldBindJSON`), `gin.Logger`/`gin.Recovery`
- `github.com/go-playground/validator/v10` v10.30.1 (transitive via Gin) - Request struct validation (`binding:"required,email"`)
- `github.com/google/uuid` v1.3.0 (transitive) - Used by Ent; frontend generates visitor IDs via `crypto.randomUUID()` in `frontend/src/lib/visitor-id.ts`
- `react-router-dom` ^6.26.0 - `BrowserRouter` + `Routes`/`Route`; guard via `AdminGuard` component at `frontend/src/components/AdminGuard.tsx`

## Configuration

- Primary source: environment variables (viper `AutomaticEnv()` with `.` → `_` replacer). Docker Compose injects all via `environment:` blocks in `deploy/docker-compose.yml` and `deploy/docker-compose.prod.yml`.
- Secondary: optional `config.yaml` (searched in `.` and `./config/`) - see `deploy/config.example.yaml`.
- Required keys validated in `backend/internal/config/config.go` `validate()`: `database.host/user/dbname/port`, `jwt.secret`, `sub2api.base_url`.
- Defaults set in `setDefaults()`: server port `8787`, host `0.0.0.0`, mode `debug`; db port `5432`, sslmode `disable`; jwt expire `24h`.
- `backend/Makefile` - `dev`, `migrate`, `build`, `test`, `test-unit`, `test-integration`, `vet`, `fmt`, `tidy`. Version from `backend/cmd/server/VERSION` (currently `0.1.0`).
- `frontend/vite.config.ts` - dev server on `0.0.0.0:3100`, proxies `/api` → `http://127.0.0.1:8004` (backend dev port from Makefile `DEV_SERVER_PORT=8004`).
- `frontend/tsconfig.json` - strict mode, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, path alias `@/*` → `src/*`, `moduleResolution: bundler`, `jsx: react-jsx`.
- `Dockerfile` - 3-stage multi-arch build: pnpm frontend build → Go backend build (CGO disabled) → Alpine runtime embedding frontend dist at `/app/frontend/dist` (env `AUX_FRONTEND_DIST=/app/frontend/dist`).

## Platform Requirements

- Go 1.26.5, Node 20, pnpm 9, local PostgreSQL on `127.0.0.1:15433` (per Makefile defaults; brought up via `deploy/docker-compose.yml` `aux-postgres` service host port `15433`).
- `make dev` runs `go run ./cmd/server` on port `8004`; `make migrate` runs `go run ./cmd/server -migrate` (ent auto-migration, one-shot table creation).
- Frontend: `pnpm install` then `pnpm dev` (port 3100, proxies `/api` to backend 8004).
- Single Docker image `ghcr.io/<owner>/sub2api-extension:<tag>` (multi-arch amd64/arm64) built by `.github/workflows/deploy-test.yml` or `.github/workflows/deploy-production.yml`, pushed to GHCR.
- Runtime: Alpine 3.21, non-root user `aux` (uid/gid 1000), `libpq` + `ca-certificates` + `tzdata` installed.
- Backend serves SPA same-origin from `/app/frontend/dist` (avoids CORS); listens on `8787` (Dockerfile `EXPOSE 8787`).
- External PostgreSQL required in prod compose (not bundled); `SUB2API_BASE_URL` must point at a reachable sub2api backend.
- Health check: `GET /health` → `{"status":"ok","service":"sub2api-extension"}` (Dockerfile `HEALTHCHECK` uses `wget` against `localhost:8787/health`).

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- Backend (Go): `snake_case.go` for files, `*_test.go` co-located in the same package. Each file typically owns one domain concept, e.g. `telemetry_service.go` + `telemetry_service_test.go`. See `backend/internal/service/telemetry_service.go`.
- Frontend (TS/TSX): `PascalCase.tsx` for React components/pages (`AdminGuard.tsx`, `DashboardPage.tsx`), `kebab-case.ts` for non-component modules (`api-client.ts`, `page-registry.ts`, `telemetry-sdk.ts`). Tests are `*.test.tsx` / `*.test.ts` co-located next to the source (`AdminGuard.test.tsx`).
- Go: exported `PascalCase` (`NewTelemetryService`, `RecordPageView`), unexported `camelCase` (`setDefaults`, `buildHeaders`). Constructors are `New<Thing>`.
- TS: `camelCase` for functions (`apiRequest`, `trackFeatureClick`, `getAdminSession`), `PascalCase` for React components (`AdminGuard`, `NotFound`).
- Go: `camelCase` / `PascalCase` by export. Receivers are single lowercase letter matching type initial where sensible (`c *gin.Context`, `s *TelemetryService`).
- TS: `camelCase` (`sessionToken`, `routeKey`). Module-level constants are `UPPER_SNAKE_CASE` (`DEFAULT_REQUEST_TIMEOUT_MS`, `AUTH_HEADER`, `TELEMETRY_BASE_URL`, `ADMIN_SESSION_HEADER`).
- Go: `PascalCase` structs (`PageViewRecord`, `OverviewResponse`). Errors are `Err<Pascal>` package-level vars (`ErrEmptyPageID`, `ErrTooLongField`). DTOs get a `DTO` suffix (`PageViewCountDTO`, `FeatureClickCountDTO`). Context keys are a named string type (`type ContextKey string`) — see `backend/internal/server/middleware/admin_guard.go`.
- TS: `PascalCase` interfaces/types (`PageEntry`, `PageVisibility`, `AuxEnvelope<T>`, `ApiRequestOptions`, `GuardState` — the last as a discriminated union). Interfaces for request/response shapes mirror the JSON field names.
- Short, lowercase, single-word where possible: `handler`, `service`, `config`, `middleware`, `response`, `web`, `integration`, `admin`, `server`. The `admin` handler subpackage is imported with an alias: `adminhandler "sub2api-extension/internal/handler/admin"` (see `backend/internal/server/router.go:19`).

## Code Style

- Backend: `gofmt -s -w .` (Makefile `fmt` target, `backend/Makefile:87`). Tabs for indentation (Go default).
- Frontend: 2-space indentation. No separate Prettier config detected — formatting is enforced by `tsc --noEmit` typecheck + build in CI (`.github/workflows/ci.yml`), not a formatter. Match surrounding style.
- Backend: `golangci-lint` v2.9 via GitHub Action (`backend-lint` job, `.github/workflows/ci.yml`). Run locally with `make vet` (`go vet ./...`, `backend/Makefile:82`).
- Frontend: TypeScript `strict: true` + `noUnusedLocals` + `noUnusedParameters` + `noFallthroughCasesInSwitch` (`frontend/tsconfig.json:19-22`). `pnpm run typecheck` (`tsc --noEmit`) is the gate, run in CI before tests.

## Import Organization

- Frontend: `@/*` → `src/*`, configured in both `frontend/tsconfig.json:25-27` (`paths`) and `frontend/vite.config.ts:9-11` (`resolve.alias`). Use `@/lib/api-client` not `../../lib/api-client`.
- Backend: no aliases; use full module path `sub2api-extension/internal/...`.

## Error Handling

- **Sentinel errors** declared as package-level `var ErrXxx = errors.New("...")` in the service layer (`backend/internal/service/telemetry_service.go:22-31`). Callers test with `errors.Is(err, service.ErrEmptyPageID)` — never string matching.
- **Handlers translate errors to HTTP** via the standard envelope. Pattern: map known validation errors to `response.BadRequest` (400), everything else to `response.InternalError` (500). Never leak internal error text in the 500 message — use generic `"failed to record page view"`. See `backend/internal/handler/telemetry_handler.go:69-78`.
- **All errors use `errors.Join`** to preserve concurrent failure chains rather than swallowing the second error — see `analytics_service.go:113` (`#12` fix). Dual goroutine failures must both be retrievable via `errors.Is`.
- **Validation before DB write**: length/emptiness checks happen in the service with the same limits as the Ent schema (`maxIDLength = 128`, `telemetry_service.go:35`) so over-long input returns 400, not a 500 from the DB (`#7` fix).
- `fmt.Errorf("...: %w", err)` for wrapping; error messages reference the config field path (`"config validation: database.host is required"`, `config.go:158`).
- `apiRequest` throws `Error` containing the HTTP status on non-2xx (`frontend/src/lib/api-client.ts:97-101`). Callers catch and show an error state — see `DashboardPage` rendering `数据暂不可用` on failure.
- **Telemetry is fire-and-forget**: `sendTelemetry` uses `fetch(...).catch(() => {})` and a synchronous `try/catch`. Telemetry failures must NEVER throw to the page (`KTD4`, `frontend/src/lib/telemetry-sdk.ts:39-57`).
- **Default request timeout** of 15s via `AbortController`; callers passing their own `signal` opt out of the default timeout (`api-client.ts:59-74`, `#4` fix).

## Logging

- Request logging is left to Gin's access logger. Do not add `fmt.Println` debug statements.
- Frontend telemetry explicitly suppresses output — never `console.error` telemetry failures.

## Comments

- This codebase leans heavily on **Chinese doc comments explaining design decisions**, not restating code. Every exported package, type, and function has a Go doc comment; every frontend module has a block JSDoc header.
- Package comment at top of each file's package clause: explains what the package/file does, mirrors sub2api where relevant, and lists covered design refs (`KTD4`, `R8`, `U5`, `#7`). Example (`backend/internal/service/telemetry_service.go:1-12`):
- Every exported identifier gets a `// Name 描述。` comment. Struct fields with non-obvious meaning get field comments (`// page_id 来自 page-registry 的 id(KTD7)`, `telemetry_handler.go:33`).
- **Design reference tags in comments**: `KTD<n>` (key technical decisions), `R<n>` (requirements), `U<n>` (units/milestones), `#<n>` (issue/bug numbers). These cross-link comments to specs. Always include the relevant tag when touching a decision-bearing area.
- Inline comments explain *why*, in Chinese: `// 与 Ent schema 的 MaxLen(128) 对齐; 在 DB 前校验` (`telemetry_service.go:34`).
- Module-level `/** ... */` header explaining purpose, design points, and covered refs. Example (`frontend/src/lib/page-registry.ts:1-16`, `telemetry-sdk.ts:1-18`).
- `@param` / `@internal` JSDoc tags on exported functions where the signature isn't self-evident (`telemetry-sdk.ts:60-64`).
- Inline `//` comments in Chinese explaining decisions (`// fire-and-forget: 不 await, catch 所有错误`).

## Function Design

- Go: prefer named primitive params over config structs for narrow functions (`RecordPageView(ctx, pageID, visitorID string, isAdmin bool)`). Use a `Record` struct when persisting (`PageViewRecord`).
- TS: options objects for optional params (`ApiRequestOptions`), positional for required (`apiRequest<T>(path, options?)`).
- Go services return `error` as the last value; success returns the DTO/record. Handlers never return error — they write to `gin.Context` and `return`.
- TS: `apiRequest<T>` is generic, returns `Promise<T>`. Telemetry functions return `void`.

## Module Design

- Go: one primary type + its constructor per file; helper types co-located. Interfaces defined at the point of consumption (the service owns `TelemetryStore`, `AnalyticsStore`; the handler owns `analyticsProvider`).
- TS: named exports only (`export function`, `export const`, `export interface`, `export type`). Default export for React components (`export default function AdminGuard()`). No barrel files — import directly from the module file.
- Services define a Store interface and depend on it, not on `*ent.Client`. `*ent.Client` satisfies the interface via an adapter (`backend/internal/service/telemetry_store.go`, `analytics_store.go`). This is the core testability pattern — replicate it for any new service that touches the DB.
- Handlers define a narrow provider interface for the service they call (`analyticsProvider` in `backend/internal/handler/admin/analytics_handler.go:28-30`) and expose a `new<Thing>WithProvider` constructor for tests.

## Anti-Patterns to Avoid

- **Do not** couple the backend to `page-registry`. The analytics service returns raw counts keyed by `page_id`; the frontend joins against the registry (`KTD7`). Backend handlers/services must not import or reference frontend page lists.
- **Do not** return `gin.H{"error": ...}`. Always use `response.Success` / `response.Error` / etc. so every response is the standard envelope (`#11` fix, enforced by `TestSetupRouter_UnknownPathReturnsStandardEnvelope`).
- **Do not** let telemetry failures propagate to the UI — wrap in `.catch(() => {})`.
- **Do not** string-match errors; use `errors.Is` with sentinel errors.
- **Do not** add admin endpoints without the `AdminGuard` middleware (except `session`/`login`, which exchange tokens before a session exists).

## Commit Conventions

- `feat:` / `feat(scope):` new features (`feat: add TERALEMO gateway homepage`, `feat(auth): add standalone admin login`).
- `fix:` / `fix(scope):` bug fixes (`fix(dev): align local service endpoints`, `fix(config): 修复 viper 纯环境变量启动读不到必需项`).
- `docs:` documentation (`docs: expand dashboard examples design`).
- `refactor:` code restructuring without behavior change (`refactor: remove redundant sub2api stats proxy`).
- Commit subjects may be English or Chinese; Chinese is acceptable for fix descriptions.

## Cross-Cutting Conventions

- `X-Aux-Token`: sub2api embedded JWT (used only by `POST /api/aux/admin/session` to exchange for an aux session). Set by `api-client` when embedded context has a token.
- `X-Aux-Session`: sub2api-extension session JWT (issued by this backend, required by all `AdminGuard`-protected endpoints). Set by `api-client` when an admin session exists.
- Both can be present simultaneously on a request. Header-name drift silently breaks all guarded admin requests → covered by regression tests in `api-client.test.ts`.
- Tables `page_views` / `feature_clicks` with `entsql.Annotation{Table: "..."}`, `created_at` as `timestamptz` + `Immutable()`, and indexed `page_id` / `visitor_id` / `created_at` + composite `(page_id, created_at)` for aggregation. Chinese `Comment(...)` on every field. Mirror this for any new telemetry table.
- `page_id` values come from the frontend `PAGE_REGISTRY` (`KTD7`) — keep the `MaxLen(128)` and service-layer `maxIDLength` in sync.

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| main | Process entry: load config, init Ent client, wire DI graph, start HTTP server with graceful shutdown | `backend/cmd/server/main.go` |
| config | Load+validate config from env vars + optional `config.yaml` (viper) | `backend/internal/config/config.go` |
| router | Assemble Gin engine, middleware, route groups, SPA static hosting fallback | `backend/internal/server/router.go` |
| AdminGuard | Validate aux-session JWT (`X-Aux-Session`); inject user claims into context | `backend/internal/server/middleware/admin_guard.go` |
| TelemetryGuard | Body-size cap (4KB) + per-IP token-bucket rate limit on anonymous telemetry writes | `backend/internal/server/middleware/telemetry_guard.go` |
| AuthHandler | `POST /admin/session` (iframe token) and `POST /admin/login` (credentials) → issue aux JWT | `backend/internal/handler/auth_handler.go` |
| TelemetryHandler | `POST /telemetry/{page-view,feature-click}` (anonymous write) | `backend/internal/handler/telemetry_handler.go` |
| AnalyticsHandler | `GET /admin/analytics/overview` (aggregated counts) | `backend/internal/handler/admin/analytics_handler.go` |
| PageHandler / PagePublicHandler | Dynamic page CRUD and public/admin page reads | `backend/internal/handler/admin/page_handler.go`, `backend/internal/handler/page_public_handler.go` |
| ImageAssetHandler | Admin upload/list and public file serving | `backend/internal/handler/admin/image_asset_handler.go` |
| HomepageConfigHandler | Legacy public/admin homepage-config API kept for compatibility; no current menu page | `backend/internal/handler/admin/homepage_config_handler.go` |
| ExampleHandler | `GET /admin/examples/status` (no-DB admin API sample) | `backend/internal/handler/admin/example_handler.go` |
| HealthHandler | `GET /health` | `backend/internal/web/health.go` |
| AuthService | Forward-verify sub2api JWT (TTL cache, SHA-256 key), proxy login, issue/validate aux JWT | `backend/internal/service/auth_service.go` |
| TelemetryService | Validate+insert page-view / feature-click records (append-only) | `backend/internal/service/telemetry_service.go` |
| AnalyticsService | Concurrent GroupBy+Count aggregation; stable sort feature clicks desc | `backend/internal/service/analytics_service.go` |
| HomepageConfigService | Normalize+persist homepage config as JSON in `system_meta`; safe defaults on read failure | `backend/internal/service/homepage_config_service.go` |
| Sub2APIClient | HTTP client to sub2api `/auth/me` and `/auth/login`; sentinel errors | `backend/internal/integration/sub2api_client.go` |
| response | Standard `{code,message,reason,data}` envelope helpers | `backend/internal/pkg/response/response.go` |
| ent | Generated ORM; schema for `pages`, `image_assets`, `page_views`, `feature_clicks`, `system_meta` | `backend/ent/schema/*.go`, `backend/ent/*.go` |
| main.tsx | Frontend bootstrap: parse embedded params, apply theme, init telemetry, mount router | `frontend/src/main.tsx` |
| App.tsx | Route root: `/`, `/login`, `/admin/*` (guarded) | `frontend/src/App.tsx` |
| AdminGuard | Frontend route guard: existing session OR exchange iframe token → aux session | `frontend/src/components/AdminGuard.tsx` |
| page-registry | Single source of truth for page identity (id/title/path/visibility) — KTD7 | `frontend/src/lib/page-registry.ts` |
| admin-auth | Exchange iframe token / login with credentials; persist aux session (localStorage+memory); JWT-expiry validation | `frontend/src/lib/admin-auth.ts` |
| api-client | Fetch wrapper with auto-attached `X-Aux-Session`/`X-Aux-Token` headers + default timeout | `frontend/src/lib/api-client.ts` |
| telemetry-sdk | Auto page-view on route change + manual feature-click; fire-and-forget | `frontend/src/lib/telemetry-sdk.ts` |
| embedded | Parse sub2api iframe query params (token/theme/lang/ui_mode) into in-memory context | `frontend/src/lib/embedded.ts` |
| visitor-id | Persistent anonymous visitor id (localStorage UUID) + admin detection | `frontend/src/lib/visitor-id.ts` |
| theme | Toggle `dark` class on `<html>` (Tailwind `darkMode: 'class'`) | `frontend/src/lib/theme.ts` |
| dynamic-pages | Load/merge database page registry; dynamic page content is fetched on demand | `frontend/src/lib/dynamic-pages.ts` |

## Pattern Overview

- **Dependency injection via constructors.** `main.go` wires `integration.Sub2APIClient` → `service.AuthService` → `handler.AuthHandler`; ent client → store adapters → services → handlers. `SetupRouter` receives assembled handlers as params.
- **Store/provider interfaces for testability.** Each service defines a store interface (`TelemetryStore`, `AnalyticsStore`, `HomepageConfigStore`) implemented by ent adapters; handlers define provider interfaces (`analyticsProvider`, `homepageConfigProvider`, `adminVerifier`) so tests inject mocks without a DB or HTTP.
- **Standard response envelope.** Every API returns `{code, message, reason?, data?}` via `internal/pkg/response`. `code:0` = success; on error `code` = HTTP status.
- **Two distinct JWTs.** sub2api JWT (user-held, forwarded to sub2api for verification, never persisted by aux) vs aux-session JWT (self-signed HS256, stored in frontend localStorage, sent as `X-Aux-Session`). The two are never conflated — the session-exchange/login endpoints sit *outside* AdminGuard.
- **KTD7 page-registry contract.** `frontend/src/lib/page-registry.ts` is the single source of truth for page identity. Routes, telemetry `page_id`, and the analytics dashboard all share the same id namespace. The backend deliberately does *not* hold the registry — it returns raw aggregated counts keyed by `page_id`; the frontend joins registry ↔ counts (zero-access pages show 0; deleted-page history is filtered out client-side).
- **Same-origin single-image deploy.** Backend serves the built frontend dist via `AUX_FRONTEND_DIST`; frontend `api-client` uses relative `/api/aux`, so there is no CORS surface.

## Layers

- Purpose: Process bootstrap and DI wiring.
- Location: `backend/cmd/server/main.go`
- Contains: `main()`, `initEnt()`, `runMigration()` (the `-migrate` flag path), build-time `Version`/`Commit`/`Date` vars.
- Depends on: `config`, `ent`, `handler`, `integration`, `server`, `service`, `web`.
- Used by: process launch (Docker entrypoint, `make dev`).
- Purpose: Gin engine assembly, middleware registration, route grouping, SPA fallback.
- Location: `backend/internal/server/router.go`, `backend/internal/server/middleware/`.
- Contains: `SetupRouter`, `registerCommonRoutes`, `registerAuxRoutes`, `registerFrontendStatic`, `AdminGuard`, `TelemetryGuard`.
- Depends on: `config`, `handler`, `service`, `pkg/response`, `web`.
- Used by: `main.go`.
- Purpose: Request binding, error-code mapping, response envelope.
- Location: `backend/internal/handler/` (auth, telemetry, public pages) and `backend/internal/handler/admin/` (analytics, dynamic pages, image assets, legacy homepage-config, example).
- Contains: One struct per endpoint group with a `New*` constructor. Handlers depend on provider interfaces, not concrete services.
- Depends on: `service`, `integration` (sentinel errors), `pkg/response`.
- Used by: `server` (registered in route groups).
- Purpose: Validation, caching, domain rules, store orchestration.
- Location: `backend/internal/service/`.
- Contains: `AuthService`, `TelemetryService`+`TelemetryStore`, `AnalyticsService`+`AnalyticsStore`, `HomepageConfigService`+`HomepageConfigStore` (+ ent adapters `telemetry_store.go`, `analytics_store.go`, in-file in `homepage_config_service.go`).
- Depends on: `integration` (auth only), `ent` (store adapters).
- Used by: `handler`.
- Purpose: HTTP client to sub2api; sentinel error definitions.
- Location: `backend/internal/integration/sub2api_client.go`.
- Contains: `Sub2APIClient`, `VerifyAdminJWT`, `Login`, `Sub2APIUserInfo`, `Sub2APILoginRequest/Response`, `ErrInvalidToken`, `ErrInvalidCredentials`, `ErrSub2APIUnreachable`.
- Depends on: stdlib `net/http` only (no sub2api imports).
- Used by: `service/auth_service.go`.
- Purpose: Standard envelope serialization.
- Location: `backend/internal/pkg/response/response.go`.
- Used by: all handlers + middleware + router NoRoute.
- Purpose: Generated ORM code + schema definitions.
- Location: `backend/ent/schema/` (source of truth), `backend/ent/*.go` (generated).
- Contains: schemas `PageView` (`page_views`), `FeatureClick` (`feature_clicks`), `SystemMeta` (`system_meta`); generated clients, queries, migrations.
- Used by: `service` store adapters, `main.go` (client init + migration).
- Purpose: Parse embedded context, apply theme, init telemetry, mount `<BrowserRouter><App/></BrowserRouter>`.
- Location: `frontend/src/main.tsx`.
- Depends on: `lib/embedded`, `lib/theme`, `lib/telemetry-sdk`, `App`.
- Purpose: Declare all routes; wrap `/admin/*` in `<AdminGuard><AdminLayout/></AdminGuard>`.
- Location: `frontend/src/App.tsx`.
- Depends on: `layouts`, `components/AdminGuard`, `pages/*`.
- Purpose: API client, auth, telemetry, registry, theme, visitor id, embedded parsing.
- Location: `frontend/src/lib/`.
- Contains: `api-base.ts` (leaf constant), `api-client.ts`, `admin-auth.ts`, `telemetry-sdk.ts`, `page-registry.ts`, `dynamic-pages.ts`, `dynamic-react-compiler.ts`, `embedded.ts`, `visitor-id.ts`, `theme.ts`.
- Dependency order: `api-base` ← `admin-auth` ← `api-client`; `embedded` ← `admin-auth`/`api-client`/`theme`; `page-registry` ← `telemetry-sdk`; `admin-auth` ← `visitor-id`.
- Purpose: Route-level and shared UI.
- Location: `frontend/src/pages/` (DynamicPage, LoginPage, admin/*, examples/*), `frontend/src/layouts/` (PublicLayout, AdminLayout), `frontend/src/components/` (AdminGuard, SandboxRenderer, ErrorState).
- Depends on: `lib/*`, react-router-dom.

## Data Flow

### Primary Request Path — Admin iframe session exchange

### Secondary Flow — Credential login (no iframe)

### Public Telemetry Write Path (anonymous, no AdminGuard)

### Analytics Read Path (admin)

### Dynamic Page Flow

- **Public read (no guard):** `frontend/src/pages/DynamicPage.tsx` → `GET /api/aux/pages/:slug` → `PagePublicHandler.GetBySlug` → `PageService.GetPublicBySlug` → `pages` 表；HTML 交给 `SandboxRenderer`，React 代码交给动态编译器。
- **Admin read/write (AdminGuard):** `PageManagementPage.tsx` → `GET/POST/PUT/DELETE /api/aux/admin/pages/*` → `PageHandler`/`PageService` → `pages` 表。官网 `/p/home` 和 Sub2API 官网 `/p/sub2api-home` 都通过 seed 或该管理页维护。
- **Image flow:** `ImageAssetsPage.tsx` → `/api/aux/admin/assets` 上传/列表，文件写入 `AUX_ASSET_DIR`，数据库 `image_assets.path` 只保存安全相对路径，公开 URL 为 `/api/aux/assets/:id`。

### SPA Static Hosting

- Frontend: React local `useState` per page (no global store). Session/visitor-id/embedded-context live in module-level singletons in `lib/` backed by `localStorage`.
- Backend: stateless request handling except two module-level caches — `AuthService.cache` (sub2api verify results, mutex-guarded, TTL 5min) and `defaultTelemetryLimiter` (per-IP token buckets, mutex-guarded).
- Database is the only durable state. No background jobs, no queues.

## Key Abstractions

- Purpose: Decouple handlers/services from ent + sub2api HTTP so unit tests inject fakes.
- Examples: `service.TelemetryStore` (`telemetry_service.go:57`), `service.AnalyticsStore` (`analytics_store.go:40`), `service.HomepageConfigStore` (`homepage_config_service.go:65`), `service.adminVerifier` (`auth_service.go:70`), `admin.analyticsProvider` (`analytics_handler.go:28`), `admin.homepageConfigProvider` (`homepage_config_handler.go:13`).
- Pattern: interface defined in the consumer package; ent adapter or `*Sub2APIClient` implements it; constructor takes the interface.
- Purpose: One id namespace shared by routes (`App.tsx`), telemetry (`page_id`), and the dashboard.
- Examples: `frontend/src/lib/page-registry.ts` (`PAGE_REGISTRY` array, `getPageByPath`, `getPages`).
- Pattern: `as const` readonly array; `page-registry.test.ts` asserts registry ↔ App.tsx routes consistency. Adding a page = 3 steps (registry entry → App.tsx route → page component), documented in the file header.
- Purpose: Uniform API shape across success/error.
- Examples: `backend/internal/pkg/response/response.go`; mirrored in frontend as `AuxEnvelope<T>` (`api-client.ts:17`).
- Pattern: success `{code:0, message:"success", data}`; error `{code:<http>, message, reason?}`. `ErrorWithReason` carries machine-readable reasons (e.g. `NOT_ADMIN`, `TWO_FACTOR_REQUIRED`) that the frontend switches on.
- Purpose: Layer-crossing error classification without type assertions.
- Examples: `integration.ErrInvalidToken`, `integration.ErrInvalidCredentials`, `integration.ErrSub2APIUnreachable` (`sub2api_client.go:204-210`); `service.ErrNotAdmin`, `service.ErrTwoFactorRequired` (`auth_service.go:42-48`). Service wraps integration sentinels with `%w` so `errors.Is(err, integration.ErrSub2APIUnreachable)` works across layers.
- Pattern: handler `switch { case errors.Is(...): }` maps to HTTP status + reason.
- Purpose: Avoid conflating sub2api identity with aux session.
- Examples: sub2api JWT forwarded only at `/admin/session`+`/admin/login`; aux JWT carried in `X-Aux-Session` (defined in both `admin_guard.go:25` and `admin-auth.ts:20`).

## Entry Points

- Location: `backend/cmd/server/main.go`
- Triggers: Docker `ENTRYPOINT ["/app/aux-server"]`; `make dev` (`go run ./cmd/server`); `make migrate` (`go run ./cmd/server -migrate`).
- Responsibilities: flag parsing (`-version`, `-migrate`), config load, ent init + DB ping, DI wiring, HTTP server lifecycle (graceful shutdown on SIGINT/SIGTERM).
- Location: `frontend/src/main.tsx`
- Triggers: browser loading the SPA (served by backend in prod, by Vite dev server on `:3100` in dev).
- Responsibilities: parse iframe params → apply theme → init telemetry route listener → mount React tree.
- `GET /health` — public, no guard.
- `/api/aux/*` — public group: `GET /api/aux`, `GET /api/aux/homepage/config`, `POST /api/aux/telemetry/{page-view,feature-click}` (TelemetryGuard).
- `/api/aux/admin/session`, `/api/aux/admin/login` — outside AdminGuard (exchange/credential flows).
- `/api/aux/admin/*` (guarded) — dashboard analytics, dynamic page CRUD, image asset upload/list, legacy homepage-config API, and examples status.

## Architectural Constraints

- **Threading/concurrency:** Gin handles one goroutine per request (standard net/http model). `AnalyticsService.GetOverview` explicitly fans out two concurrent store queries with a `sync.WaitGroup` + mutex; `AuthService.cache` and `defaultTelemetryLimiter.buckets` are mutex-guarded maps. No worker pools, no queues.
- **Module-level mutable state (singletons):**
- **Circular imports — explicitly avoided:** `frontend/src/lib/api-base.ts` exists as a dependency-free leaf so `api-client` (imports `admin-auth`) and `admin-auth` (needs base URL) don't cycle. Backend has no known circular packages.
- **Migration is explicit, not automatic:** `main.go` does *not* auto-migrate on startup (avoids prod schema drift). Use `make migrate` / `-migrate` flag once, or rely on the Docker image which ships with schema. `ent_integration_test.go` is gated behind `//go:build integration` and self-skips without `DATABASE_DBNAME`.
- **Backend never imports sub2api packages.** All sub2api interaction is HTTP via `internal/integration`. sub2api-extension is a standalone Go module (`module sub2api-extension`).
- **Telemetry is append-only.** `TelemetryService` exposes only `Create*`; `page_views`/`feature_clicks` have no update/delete paths and `created_at` is `Immutable()`.
- **Telemetry must never block the UI (KTD4).** `telemetry-sdk.ts` uses fire-and-forget `fetch` + `catch`; backend returns errors but the SDK discards them.
- **Public write surface is defended.** Telemetry endpoints are anonymous-writable and sit behind `TelemetryGuard` (body limit + rate limit) — without it, unbounded writes could exhaust storage / pollute analytics (#7).
- **Failure-closed on sub2api unreachability.** `AuthService` returns `ErrSub2APIUnreachable` (wrapped) → handler maps to 503; no session is issued when sub2api cannot be reached.

## Anti-Patterns

### Module-level mutable singletons in router/middleware/lib

### Status-code-then-JSON ordering assumption for sub2api responses

## Error Handling

- Service/integration layers define exported sentinel `var Err... = errors.New(...)`; cross-layer wrapping uses `fmt.Errorf("%w: ...", sentinel, cause)` to preserve `errors.Is` chains (see `auth_service.go:145`, `:182`).
- Handlers `switch { case errors.Is(err, X): response.<Status>(...) }` — e.g. `auth_handler.go:73-83` and `:125-137`. Distinct user-facing reasons are carried via `response.ErrorWithReason` (403 `NOT_ADMIN` vs `TWO_FACTOR_REQUIRED`).
- Frontend maps HTTP status → typed `SessionError`/`LoginError` unions (`admin-auth.ts:126-137`, `:219-230`); UI renders localized messages from a `Record<Error, string>` (`AdminGuard.tsx:28`, `LoginPage.tsx:20`).
- Concurrent aggregation errors are joined, not swallowed (`analytics_service.go:113` `errors.Join(firstErr, secondErr)` — #12).
- Dynamic public page reads fail closed when the page is missing, disabled, or not public; the public HTML comes from the database and is not silently replaced by a hard-coded React homepage.

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

- `.agents/skills/sub2api-extension-page-writer/SKILL.md` — 页面注册、动态页面、HTML 沙箱、动态 React、元数据与图片资源规范。
- `.agents/skills/sub2api-extension-operations/SKILL.md` — Docker、GitHub Actions、GHCR、NGINX、环境隔离、持久化与回滚规范。
- `.agents/skills/sub2api-extension-integration/SKILL.md` — sub2api iframe、custom_menu_items、home_content、登录会话、域名、CSP 与集成故障排查。
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
