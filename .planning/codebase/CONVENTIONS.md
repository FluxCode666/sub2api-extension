# Coding Conventions

**Analysis Date:** 2026-08-18

This is a brownfield Go backend + React/TypeScript frontend monorepo (`sub2api-extension`, an auxiliary content/telemetry system that mirrors the `sub2api` envelope style but is a standalone Go module). Conventions below are derived from the existing code; follow them when adding code.

## Naming Patterns

**Files:**

- Backend (Go): `snake_case.go` for files, `*_test.go` co-located in the same package. Each file typically owns one domain concept, e.g. `telemetry_service.go` + `telemetry_service_test.go`. See `backend/internal/service/telemetry_service.go`.
- Frontend (TS/TSX): `PascalCase.tsx` for React components/pages (`AdminGuard.tsx`, `DashboardPage.tsx`), `kebab-case.ts` for non-component modules (`api-client.ts`, `page-registry.ts`, `telemetry-sdk.ts`). Tests are `*.test.tsx` / `*.test.ts` co-located next to the source (`AdminGuard.test.tsx`).

**Functions:**

- Go: exported `PascalCase` (`NewTelemetryService`, `RecordPageView`), unexported `camelCase` (`setDefaults`, `buildHeaders`). Constructors are `New<Thing>`.
- TS: `camelCase` for functions (`apiRequest`, `trackFeatureClick`, `getAdminSession`), `PascalCase` for React components (`AdminGuard`, `NotFound`).

**Variables:**

- Go: `camelCase` / `PascalCase` by export. Receivers are single lowercase letter matching type initial where sensible (`c *gin.Context`, `s *TelemetryService`).
- TS: `camelCase` (`sessionToken`, `routeKey`). Module-level constants are `UPPER_SNAKE_CASE` (`DEFAULT_REQUEST_TIMEOUT_MS`, `AUTH_HEADER`, `TELEMETRY_BASE_URL`, `ADMIN_SESSION_HEADER`).

**Types:**

- Go: `PascalCase` structs (`PageViewRecord`, `OverviewResponse`). Errors are `Err<Pascal>` package-level vars (`ErrEmptyPageID`, `ErrTooLongField`). DTOs get a `DTO` suffix (`PageViewCountDTO`, `FeatureClickCountDTO`). Context keys are a named string type (`type ContextKey string`) — see `backend/internal/server/middleware/admin_guard.go`.
- TS: `PascalCase` interfaces/types (`PageEntry`, `PageVisibility`, `AuxEnvelope<T>`, `ApiRequestOptions`, `GuardState` — the last as a discriminated union). Interfaces for request/response shapes mirror the JSON field names.

**Packages:**

- Short, lowercase, single-word where possible: `handler`, `service`, `config`, `middleware`, `response`, `web`, `integration`, `admin`, `server`. The `admin` handler subpackage is imported with an alias: `adminhandler "sub2api-extension/internal/handler/admin"` (see `backend/internal/server/router.go:19`).

## Code Style

**Formatting:**

- Backend: `gofmt -s -w .` (Makefile `fmt` target, `backend/Makefile:87`). Tabs for indentation (Go default).
- Frontend: 2-space indentation. No separate Prettier config detected — formatting is enforced by `tsc --noEmit` typecheck + build in CI (`.github/workflows/ci.yml`), not a formatter. Match surrounding style.

**Linting:**

- Backend: `golangci-lint` v2.9 via GitHub Action (`backend-lint` job, `.github/workflows/ci.yml`). Run locally with `make vet` (`go vet ./...`, `backend/Makefile:82`).
- Frontend: TypeScript `strict: true` + `noUnusedLocals` + `noUnusedParameters` + `noFallthroughCasesInSwitch` (`frontend/tsconfig.json:19-22`). `pnpm run typecheck` (`tsc --noEmit`) is the gate, run in CI before tests.

## Import Organization

**Backend (Go) — three groups, blank-line separated, alphabetized within group:**

1. Standard library (`bytes`, `context`, `errors`, `net/http`, ...).
2. Project-internal (`sub2api-extension/internal/...`).
3. Third-party (`github.com/gin-gonic/gin`, `github.com/stretchr/testify/...`).

Example (`backend/internal/handler/telemetry_handler.go:11-18`):
```go
import (
	"errors"

	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)
```

Test files add `testing` to group 1 and the testify packages (`assert`, `require`) to group 3.

**Frontend (TS/TSX) — three groups:**

1. External packages (`react`, `react-router-dom`, `vitest`, `@testing-library/...`).
2. `@/`-aliased internal modules (`@/lib/...`, `@/components/...`, `@/pages/...`).
3. Relative imports (`./page-registry`, `./App`).

`vi.mock(...)` calls come **after** the external/test imports and **before** importing the module under test (module hoisting). See `frontend/src/lib/api-client.test.ts:13-32`.

**Path Aliases:**

- Frontend: `@/*` → `src/*`, configured in both `frontend/tsconfig.json:25-27` (`paths`) and `frontend/vite.config.ts:9-11` (`resolve.alias`). Use `@/lib/api-client` not `../../lib/api-client`.
- Backend: no aliases; use full module path `sub2api-extension/internal/...`.

## Error Handling

**Backend (Go):**

- **Sentinel errors** declared as package-level `var ErrXxx = errors.New("...")` in the service layer (`backend/internal/service/telemetry_service.go:22-31`). Callers test with `errors.Is(err, service.ErrEmptyPageID)` — never string matching.
- **Handlers translate errors to HTTP** via the standard envelope. Pattern: map known validation errors to `response.BadRequest` (400), everything else to `response.InternalError` (500). Never leak internal error text in the 500 message — use generic `"failed to record page view"`. See `backend/internal/handler/telemetry_handler.go:69-78`.
- **All errors use `errors.Join`** to preserve concurrent failure chains rather than swallowing the second error — see `analytics_service.go:113` (`#12` fix). Dual goroutine failures must both be retrievable via `errors.Is`.
- **Validation before DB write**: length/emptiness checks happen in the service with the same limits as the Ent schema (`maxIDLength = 128`, `telemetry_service.go:35`) so over-long input returns 400, not a 500 from the DB (`#7` fix).
- `fmt.Errorf("...: %w", err)` for wrapping; error messages reference the config field path (`"config validation: database.host is required"`, `config.go:158`).

**Frontend (TS):**

- `apiRequest` throws `Error` containing the HTTP status on non-2xx (`frontend/src/lib/api-client.ts:97-101`). Callers catch and show an error state — see `DashboardPage` rendering `数据暂不可用` on failure.
- **Telemetry is fire-and-forget**: `sendTelemetry` uses `fetch(...).catch(() => {})` and a synchronous `try/catch`. Telemetry failures must NEVER throw to the page (`KTD4`, `frontend/src/lib/telemetry-sdk.ts:39-57`).
- **Default request timeout** of 15s via `AbortController`; callers passing their own `signal` opt out of the default timeout (`api-client.ts:59-74`, `#4` fix).

## Logging

**Framework:** Backend uses Gin's built-in `gin.Logger()` + `gin.Recovery()` middleware (`backend/internal/server/router.go:39-40`). No structured logging library (zap/zap) detected. Frontend has no logging framework — console is not used for app logic (telemetry failures are swallowed silently).

**Patterns:**

- Request logging is left to Gin's access logger. Do not add `fmt.Println` debug statements.
- Frontend telemetry explicitly suppresses output — never `console.error` telemetry failures.

## Comments

**When to Comment:**

- This codebase leans heavily on **Chinese doc comments explaining design decisions**, not restating code. Every exported package, type, and function has a Go doc comment; every frontend module has a block JSDoc header.

**Backend (Go) — Chinese Go doc comments:**

- Package comment at top of each file's package clause: explains what the package/file does, mirrors sub2api where relevant, and lists covered design refs (`KTD4`, `R8`, `U5`, `#7`). Example (`backend/internal/service/telemetry_service.go:1-12`):
  ```go
  // Package service 提供附属内容系统的业务逻辑层。
  //
  // telemetry_service 负责埋点数据的入库与校验。
  //
  // 设计要点:
  //   - 依赖存储抽象接口 TelemetryStore,使测试可注入 mock(不依赖真实 DB)。
  //   - 只追加: 仅提供 Create 方法,不提供更新/删除。
  //
  // Covers KTD4(埋点 = 前端 SDK + 后端存储), R8(页面访问埋点), R11(自有采集)。
  ```
- Every exported identifier gets a `// Name 描述。` comment. Struct fields with non-obvious meaning get field comments (`// page_id 来自 page-registry 的 id(KTD7)`, `telemetry_handler.go:33`).
- **Design reference tags in comments**: `KTD<n>` (key technical decisions), `R<n>` (requirements), `U<n>` (units/milestones), `#<n>` (issue/bug numbers). These cross-link comments to specs. Always include the relevant tag when touching a decision-bearing area.
- Inline comments explain *why*, in Chinese: `// 与 Ent schema 的 MaxLen(128) 对齐; 在 DB 前校验` (`telemetry_service.go:34`).

**Frontend (TS) — Chinese JSDoc/block comments:**

- Module-level `/** ... */` header explaining purpose, design points, and covered refs. Example (`frontend/src/lib/page-registry.ts:1-16`, `telemetry-sdk.ts:1-18`).
- `@param` / `@internal` JSDoc tags on exported functions where the signature isn't self-evident (`telemetry-sdk.ts:60-64`).
- Inline `//` comments in Chinese explaining decisions (`// fire-and-forget: 不 await, catch 所有错误`).

**JSDoc/TSDoc:** Used on frontend exported functions with multi-line `/** */` blocks. Backend uses Go doc comments (no JSDoc equivalent needed).

## Function Design

**Size:** Functions stay small and single-purpose. The largest handlers (~40 lines, `RecordPageView`) still only do bind → validate → call service → respond. Services split validation from persistence.

**Parameters:**

- Go: prefer named primitive params over config structs for narrow functions (`RecordPageView(ctx, pageID, visitorID string, isAdmin bool)`). Use a `Record` struct when persisting (`PageViewRecord`).
- TS: options objects for optional params (`ApiRequestOptions`), positional for required (`apiRequest<T>(path, options?)`).

**Return Values:**

- Go services return `error` as the last value; success returns the DTO/record. Handlers never return error — they write to `gin.Context` and `return`.
- TS: `apiRequest<T>` is generic, returns `Promise<T>`. Telemetry functions return `void`.

**Constructors:** Always `New<Thing>(deps...) *Thing`. Inject store/interface dependencies (not concrete `*ent.Client`) so tests can substitute mocks — `NewTelemetryService(store TelemetryStore)`, `NewAnalyticsService(store AnalyticsStore)`, `NewAnalyticsHandler(svc *service.AnalyticsService)`.

## Module Design

**Exports:**

- Go: one primary type + its constructor per file; helper types co-located. Interfaces defined at the point of consumption (the service owns `TelemetryStore`, `AnalyticsStore`; the handler owns `analyticsProvider`).
- TS: named exports only (`export function`, `export const`, `export interface`, `export type`). Default export for React components (`export default function AdminGuard()`). No barrel files — import directly from the module file.

**Dependency injection via interfaces:**

- Services define a Store interface and depend on it, not on `*ent.Client`. `*ent.Client` satisfies the interface via an adapter (`backend/internal/service/telemetry_store.go`, `analytics_store.go`). This is the core testability pattern — replicate it for any new service that touches the DB.
- Handlers define a narrow provider interface for the service they call (`analyticsProvider` in `backend/internal/handler/admin/analytics_handler.go:28-30`) and expose a `new<Thing>WithProvider` constructor for tests.

**Append-only tables:** `PageView` and `FeatureClick` are append-only — services expose only `Create*` methods, never update/delete. `created_at` is `Immutable()` in the Ent schema. Do not add mutation methods to these services.

**Barrel Files:** None. Import from the specific module path.

## Anti-Patterns to Avoid

- **Do not** couple the backend to `page-registry`. The analytics service returns raw counts keyed by `page_id`; the frontend joins against the registry (`KTD7`). Backend handlers/services must not import or reference frontend page lists.
- **Do not** return `gin.H{"error": ...}`. Always use `response.Success` / `response.Error` / etc. so every response is the standard envelope (`#11` fix, enforced by `TestSetupRouter_UnknownPathReturnsStandardEnvelope`).
- **Do not** let telemetry failures propagate to the UI — wrap in `.catch(() => {})`.
- **Do not** string-match errors; use `errors.Is` with sentinel errors.
- **Do not** add admin endpoints without the `AdminGuard` middleware (except `session`/`login`, which exchange tokens before a session exists).

## Commit Conventions

**Conventional Commits** (from `git log`):

- `feat:` / `feat(scope):` new features (`feat: add TERALEMO gateway homepage`, `feat(auth): add standalone admin login`).
- `fix:` / `fix(scope):` bug fixes (`fix(dev): align local service endpoints`, `fix(config): 修复 viper 纯环境变量启动读不到必需项`).
- `docs:` documentation (`docs: expand dashboard examples design`).
- `refactor:` code restructuring without behavior change (`refactor: remove redundant sub2api stats proxy`).
- Commit subjects may be English or Chinese; Chinese is acceptable for fix descriptions.

## Cross-Cutting Conventions

**API envelope:** Standard `{code, message, data?}` success / `{code, message, reason?}` error, implemented in `backend/internal/pkg/response/response.go`. Success uses `code: 0` and HTTP 200/201; errors set `code` = HTTP status. Frontend mirrors this as `AuxEnvelope<T>` (`frontend/src/lib/api-client.ts:17-21`) and treats non-zero `code` as failure (see `DashboardPage.test.tsx:149-158`).

**Auth headers (two independent headers, do not conflate):**

- `X-Aux-Token`: sub2api embedded JWT (used only by `POST /api/aux/admin/session` to exchange for an aux session). Set by `api-client` when embedded context has a token.
- `X-Aux-Session`: sub2api-extension session JWT (issued by this backend, required by all `AdminGuard`-protected endpoints). Set by `api-client` when an admin session exists.
- Both can be present simultaneously on a request. Header-name drift silently breaks all guarded admin requests → covered by regression tests in `api-client.test.ts`.

**Append-only telemetry schema (Ent):**

- Tables `page_views` / `feature_clicks` with `entsql.Annotation{Table: "..."}`, `created_at` as `timestamptz` + `Immutable()`, and indexed `page_id` / `visitor_id` / `created_at` + composite `(page_id, created_at)` for aggregation. Chinese `Comment(...)` on every field. Mirror this for any new telemetry table.
- `page_id` values come from the frontend `PAGE_REGISTRY` (`KTD7`) — keep the `MaxLen(128)` and service-layer `maxIDLength` in sync.

**Config validation:** Required config keys (`database.host/user/dbname`, `jwt.secret`, `sub2api.base_url`) are registered as empty-string viper defaults so `AutomaticEnv` can populate them, then `validate()` enforces presence (`backend/internal/config/config.go:111-178`). When adding a required config field, follow both steps.

---

*Convention analysis: 2026-08-18*
