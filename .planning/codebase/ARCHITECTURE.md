<!-- refreshed: 2026-08-18 -->
# Architecture

**Analysis Date:** 2026-08-18

## System Overview

aux-system is an independently-deployed web application that acts as a content carrier for the external `sub2api` host. It is embedded zero-code-change via sub2api's iframe mechanisms (`home_content` URL + `custom_menu_items` with token). The system is a Go (Gin + Ent) backend that also serves a React 18 SPA from the same process (single-image, same-origin — no CORS).

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                    External Host: sub2api (unchanged)                     │
│  home_content iframe ──► aux-system /   (public homepage)                │
│  custom_menu_items iframe (+token) ──► aux-system /admin/*               │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │ token in query string
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          Frontend SPA (React 18)                          │
│  `frontend/src/main.tsx` (bootstrap) → `frontend/src/App.tsx` (routes)   │
│  ┌────────────────┬──────────────────┬─────────────────────────────────┐ │
│  │ HomePage (/)   │ LoginPage (/login)│ AdminGuard → AdminLayout        │ │
│  │ `pages/HomePage│ `pages/LoginPage │ `/admin/{dashboard,homepage,    │ │
│  │ .tsx`          │ .tsx`            │  examples/*}`                   │ │
│  └───────┬────────┴────────┬─────────┴──────────────┬──────────────────┘ │
│          │                 │                        │ X-Aux-Session      │
│          │ lib/            │ lib/                   │ X-Aux-Token        │
│          │ homepage-config │ admin-auth             │ lib/api-client     │
│          ▼                 ▼                        ▼                    │
└──────────────────────────────────────────────────────────────────────────┘
                                  │ relative /api/aux (same-origin)
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     Backend (Go + Gin + Ent)                              │
│  `backend/cmd/server/main.go` (DI wiring) → `internal/server/router.go`  │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Middleware: AdminGuard (X-Aux-Session) · TelemetryGuard (limit) │   │
│  ├──────────────────────────────────────────────────────────────────┤   │
│  │  handler/        auth · telemetry · admin/{analytics,homepage,    │   │
│  │                  example}                                          │   │
│  ├──────────────────────────────────────────────────────────────────┤   │
│  │  service/       auth (sub2api forward-verify + aux JWT) ·         │   │
│  │                 telemetry · analytics · homepage_config           │   │
│  ├──────────────────────────────────────────────────────────────────┤   │
│  │  integration/   sub2api_client (HTTP → sub2api /auth/me,/login)   │   │
│  │  pkg/response   standard envelope {code,message,reason,data}      │   │
│  ├──────────────────────────────────────────────────────────────────┤   │
│  │  ent/  (generated ORM) ← schema/{page_view,feature_click,system_  │   │
│  │                            meta}                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────┬───────────────────────────────────┬───────────────────────┘
               │                                   │
               ▼                                   ▼
   ┌───────────────────────┐         ┌──────────────────────────┐
   │ self-owned PostgreSQL │         │ sub2api backend (external)│
   │ page_views /          │         │ GET /api/v1/auth/me        │
   │ feature_clicks /      │         │ POST /api/v1/auth/login    │
   │ system_meta           │         └──────────────────────────┘
   └───────────────────────┘
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
| HomepageConfigHandler | Public `GET /homepage/config` + admin `GET/PUT /admin/homepage/config` | `backend/internal/handler/admin/homepage_config_handler.go` |
| ExampleHandler | `GET /admin/examples/status` (no-DB admin API sample) | `backend/internal/handler/admin/example_handler.go` |
| HealthHandler | `GET /health` | `backend/internal/web/health.go` |
| AuthService | Forward-verify sub2api JWT (TTL cache, SHA-256 key), proxy login, issue/validate aux JWT | `backend/internal/service/auth_service.go` |
| TelemetryService | Validate+insert page-view / feature-click records (append-only) | `backend/internal/service/telemetry_service.go` |
| AnalyticsService | Concurrent GroupBy+Count aggregation; stable sort feature clicks desc | `backend/internal/service/analytics_service.go` |
| HomepageConfigService | Normalize+persist homepage config as JSON in `system_meta`; safe defaults on read failure | `backend/internal/service/homepage_config_service.go` |
| Sub2APIClient | HTTP client to sub2api `/auth/me` and `/auth/login`; sentinel errors | `backend/internal/integration/sub2api_client.go` |
| response | Standard `{code,message,reason,data}` envelope helpers | `backend/internal/pkg/response/response.go` |
| ent | Generated ORM; schema for `page_views`, `feature_clicks`, `system_meta` | `backend/ent/schema/*.go`, `backend/ent/*.go` |
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
| homepage-config | Load/normalize homepage config from public endpoint | `frontend/src/lib/homepage-config.ts` |

## Pattern Overview

**Overall:** Layered DI-wired monolith (backend) + SPA with guard components (frontend). Backend mirrors the sub2api backend's `SetupRouter` style but is an independent Go module that never imports sub2api packages — integration is HTTP-only.

**Key Characteristics:**
- **Dependency injection via constructors.** `main.go` wires `integration.Sub2APIClient` → `service.AuthService` → `handler.AuthHandler`; ent client → store adapters → services → handlers. `SetupRouter` receives assembled handlers as params.
- **Store/provider interfaces for testability.** Each service defines a store interface (`TelemetryStore`, `AnalyticsStore`, `HomepageConfigStore`) implemented by ent adapters; handlers define provider interfaces (`analyticsProvider`, `homepageConfigProvider`, `adminVerifier`) so tests inject mocks without a DB or HTTP.
- **Standard response envelope.** Every API returns `{code, message, reason?, data?}` via `internal/pkg/response`. `code:0` = success; on error `code` = HTTP status.
- **Two distinct JWTs.** sub2api JWT (user-held, forwarded to sub2api for verification, never persisted by aux) vs aux-session JWT (self-signed HS256, stored in frontend localStorage, sent as `X-Aux-Session`). The two are never conflated — the session-exchange/login endpoints sit *outside* AdminGuard.
- **KTD7 page-registry contract.** `frontend/src/lib/page-registry.ts` is the single source of truth for page identity. Routes, telemetry `page_id`, and the analytics dashboard all share the same id namespace. The backend deliberately does *not* hold the registry — it returns raw aggregated counts keyed by `page_id`; the frontend joins registry ↔ counts (zero-access pages show 0; deleted-page history is filtered out client-side).
- **Same-origin single-image deploy.** Backend serves the built frontend dist via `AUX_FRONTEND_DIST`; frontend `api-client` uses relative `/api/aux`, so there is no CORS surface.

## Layers

**Backend — `cmd` (entry):**
- Purpose: Process bootstrap and DI wiring.
- Location: `backend/cmd/server/main.go`
- Contains: `main()`, `initEnt()`, `runMigration()` (the `-migrate` flag path), build-time `Version`/`Commit`/`Date` vars.
- Depends on: `config`, `ent`, `handler`, `integration`, `server`, `service`, `web`.
- Used by: process launch (Docker entrypoint, `make dev`).

**Backend — `internal/server` (HTTP transport):**
- Purpose: Gin engine assembly, middleware registration, route grouping, SPA fallback.
- Location: `backend/internal/server/router.go`, `backend/internal/server/middleware/`.
- Contains: `SetupRouter`, `registerCommonRoutes`, `registerAuxRoutes`, `registerFrontendStatic`, `AdminGuard`, `TelemetryGuard`.
- Depends on: `config`, `handler`, `service`, `pkg/response`, `web`.
- Used by: `main.go`.

**Backend — `internal/handler` (HTTP handlers):**
- Purpose: Request binding, error-code mapping, response envelope.
- Location: `backend/internal/handler/` (auth, telemetry) and `backend/internal/handler/admin/` (analytics, homepage-config, example).
- Contains: One struct per endpoint group with a `New*` constructor. Handlers depend on provider interfaces, not concrete services.
- Depends on: `service`, `integration` (sentinel errors), `pkg/response`.
- Used by: `server` (registered in route groups).

**Backend — `internal/service` (business logic):**
- Purpose: Validation, caching, domain rules, store orchestration.
- Location: `backend/internal/service/`.
- Contains: `AuthService`, `TelemetryService`+`TelemetryStore`, `AnalyticsService`+`AnalyticsStore`, `HomepageConfigService`+`HomepageConfigStore` (+ ent adapters `telemetry_store.go`, `analytics_store.go`, in-file in `homepage_config_service.go`).
- Depends on: `integration` (auth only), `ent` (store adapters).
- Used by: `handler`.

**Backend — `internal/integration` (external HTTP):**
- Purpose: HTTP client to sub2api; sentinel error definitions.
- Location: `backend/internal/integration/sub2api_client.go`.
- Contains: `Sub2APIClient`, `VerifyAdminJWT`, `Login`, `Sub2APIUserInfo`, `Sub2APILoginRequest/Response`, `ErrInvalidToken`, `ErrInvalidCredentials`, `ErrSub2APIUnreachable`.
- Depends on: stdlib `net/http` only (no sub2api imports).
- Used by: `service/auth_service.go`.

**Backend — `internal/pkg/response` (cross-cutting):**
- Purpose: Standard envelope serialization.
- Location: `backend/internal/pkg/response/response.go`.
- Used by: all handlers + middleware + router NoRoute.

**Backend — `ent/` (persistence):**
- Purpose: Generated ORM code + schema definitions.
- Location: `backend/ent/schema/` (source of truth), `backend/ent/*.go` (generated).
- Contains: schemas `PageView` (`page_views`), `FeatureClick` (`feature_clicks`), `SystemMeta` (`system_meta`); generated clients, queries, migrations.
- Used by: `service` store adapters, `main.go` (client init + migration).

**Frontend — `main.tsx` (bootstrap):**
- Purpose: Parse embedded context, apply theme, init telemetry, mount `<BrowserRouter><App/></BrowserRouter>`.
- Location: `frontend/src/main.tsx`.
- Depends on: `lib/embedded`, `lib/theme`, `lib/telemetry-sdk`, `App`.

**Frontend — `App.tsx` (routing):**
- Purpose: Declare all routes; wrap `/admin/*` in `<AdminGuard><AdminLayout/></AdminGuard>`.
- Location: `frontend/src/App.tsx`.
- Depends on: `layouts`, `components/AdminGuard`, `pages/*`.

**Frontend — `lib/` (framework-free modules):**
- Purpose: API client, auth, telemetry, registry, theme, visitor id, embedded parsing.
- Location: `frontend/src/lib/`.
- Contains: `api-base.ts` (leaf constant), `api-client.ts`, `admin-auth.ts`, `telemetry-sdk.ts`, `page-registry.ts`, `embedded.ts`, `visitor-id.ts`, `theme.ts`, `homepage-config.ts`.
- Dependency order: `api-base` ← `admin-auth` ← `api-client`; `embedded` ← `admin-auth`/`api-client`/`theme`; `page-registry` ← `telemetry-sdk`; `admin-auth` ← `visitor-id`.

**Frontend — `pages/` + `layouts/` + `components/` (UI):**
- Purpose: Route-level and shared UI.
- Location: `frontend/src/pages/` (HomePage, LoginPage, admin/*, examples/*), `frontend/src/layouts/` (PublicLayout, AdminLayout), `frontend/src/components/` (AdminGuard, ErrorState).
- Depends on: `lib/*`, react-router-dom.

## Data Flow

### Primary Request Path — Admin iframe session exchange

1. sub2api loads aux-system `/admin/dashboard` in an iframe with `?token=<sub2api-jwt>&...` (browser request).
2. `frontend/src/main.tsx:12` `initEmbeddedContext(window.location.search)` parses `token` into in-memory context (never persisted, never sent to sub2api).
3. `frontend/src/App.tsx:46` renders `<AdminGuard>`; `frontend/src/components/AdminGuard.tsx:55` calls `exchangeSession()`.
4. `frontend/src/lib/admin-auth.ts:91` `POST /api/aux/admin/session { token }` (10s `AbortController` timeout).
5. `backend/internal/server/router.go:157` routes to `AuthHandler.CreateSession` (`backend/internal/handler/auth_handler.go:64`) — this route is **outside** AdminGuard.
6. `AuthService.VerifyAdminToken` (`backend/internal/service/auth_service.go:115`) checks the SHA-256-keyed TTL cache; on miss calls `Sub2APIClient.VerifyAdminJWT` (`backend/internal/integration/sub2api_client.go:63`) → `GET sub2api /api/v1/auth/me`.
7. Role `admin` → `AuthService.IssueSession` (`auth_service.go:200`) signs aux-session JWT (HS256, `iss=aux-system`, exp from `JWT_EXPIRE_HOUR`).
8. Response envelope returned; `admin-auth.ts` `saveSession` persists to `localStorage` (`aux_admin_session`) + memory.
9. Subsequent guarded requests: `frontend/src/lib/api-client.ts:40` `buildHeaders` auto-attaches `X-Aux-Session: <aux-jwt>`; `backend/internal/server/middleware/admin_guard.go:36` validates via `AuthService.ValidateSession` and injects claims into context.

### Secondary Flow — Credential login (no iframe)

1. `frontend/src/pages/LoginPage.tsx:49` calls `loginWithCredentials(email, password)` (`admin-auth.ts:170`).
2. `POST /api/aux/admin/login` → `AuthHandler.Login` (`auth_handler.go:116`) → `AuthService.LoginAdmin` (`auth_service.go:172`) → `Sub2APIClient.Login` (`sub2api_client.go:148`) → `POST sub2api /api/v1/auth/login`.
3. 2FA → `ErrTwoFactorRequired` → 403 `TWO_FACTOR_REQUIRED`; non-admin → `ErrNotAdmin` → 403 `NOT_ADMIN`; bad creds → 401. On success, same `IssueSession` path as above.

### Public Telemetry Write Path (anonymous, no AdminGuard)

1. Route change in SPA → `frontend/src/lib/telemetry-sdk.ts:95` `handleRouteChange` resolves `page_id` via `getPageByPath` from `page-registry.ts` (unregistered paths are skipped to avoid 404 noise; admin routes only count after AdminGuard confirms the session).
2. `sendTelemetry` (`telemetry-sdk.ts:39`) `fetch POST /api/aux/telemetry/page-view` (or `/feature-click`) with `keepalive: true`, fire-and-forget — all errors silently dropped (KTD4: telemetry never blocks the page).
3. `backend/internal/server/router.go:142` routes through `middleware.TelemetryGuard()` (`telemetry_guard.go:84`): wraps body with `MaxBytesReader` (4KB), per-IP token bucket (5 req/s, burst 10) → 413 / 429 on exceed.
4. `TelemetryHandler.RecordPageView` (`telemetry_handler.go:62`) binds JSON, calls `TelemetryService.RecordPageView` (`telemetry_service.go:79`) which validates non-empty + max-length 128, then `entTelemetryStore.CreatePageView` inserts one row (append-only, per-visit count).
5. `is_admin` is determined client-side by `visitor-id.ts:isCurrentUserAdmin()` (presence of aux session).

### Analytics Read Path (admin)

1. `frontend/src/pages/admin/DashboardPage.tsx:62` `GET /admin/analytics/overview` via `apiClient.get` (auto `X-Aux-Session`).
2. AdminGuard validates → `AnalyticsHandler.GetOverview` (`analytics_handler.go:56`) → `AnalyticsService.GetOverview` (`analytics_service.go:67`).
3. Two concurrent goroutines: `CountPageViewsByPageID` + `CountFeatureClicksByFeature` (`analytics_store.go`) via ent `GroupBy`+`ent.Count()`. Errors joined with `errors.Join` (#12: don't swallow the second concurrent error).
4. Feature clicks stable-sorted by count desc, then page_id, then feature_id.
5. Frontend joins: `getPages()` (registry) ↔ `page_views` map by `page_id` (zero-access → 0); filters `feature_clicks` to current registry ids (deleted-page history retained in DB but hidden).

### Homepage Config Flow

- **Public read (no guard):** `frontend/src/pages/HomePage.tsx:260` `loadHomepageConfig()` (`homepage-config.ts:66`) → `GET /api/aux/homepage/config` → `HomepageConfigHandler.GetPublicConfig` (`homepage_config_handler.go:27`) → on store error falls back to `DefaultHomepageConfig()` (homepage stays usable). Frontend also falls back to `DEFAULT_HOMEPAGE_CONFIG` on any error.
- **Admin read/write (AdminGuard):** `HomepageConfigPage.tsx` → `GET/PUT /api/aux/admin/homepage/config` → `HomepageConfigHandler.GetConfig`/`UpdateConfig`. `HomepageConfigService.normalizeHomepageConfig` (`homepage_config_service.go:108`) bounds text lengths, sanitizes hrefs (only `#`/`/`/http(s) allowed), caps partners at 24, drops empty-named partners. Stored as JSON in `system_meta` row keyed `homepage.config`.

### SPA Static Hosting

1. On startup `registerFrontendStatic` (`router.go:87`) reads `AUX_FRONTEND_DIST`; if it points to a real dir, registers `/assets/*` → `dist/assets` and sets the package-level `indexHandler` to serve `index.html`.
2. `NoRoute` (`router.go:59`): `/api/*` and `/health` → standard 404 envelope; other paths → `indexHandler` (SPA history fallback) if configured, else 404 envelope.

**State Management:**
- Frontend: React local `useState` per page (no global store). Session/visitor-id/embedded-context live in module-level singletons in `lib/` backed by `localStorage`.
- Backend: stateless request handling except two module-level caches — `AuthService.cache` (sub2api verify results, mutex-guarded, TTL 5min) and `defaultTelemetryLimiter` (per-IP token buckets, mutex-guarded).
- Database is the only durable state. No background jobs, no queues.

## Key Abstractions

**Store/Provider interfaces (testability seam):**
- Purpose: Decouple handlers/services from ent + sub2api HTTP so unit tests inject fakes.
- Examples: `service.TelemetryStore` (`telemetry_service.go:57`), `service.AnalyticsStore` (`analytics_store.go:40`), `service.HomepageConfigStore` (`homepage_config_service.go:65`), `service.adminVerifier` (`auth_service.go:70`), `admin.analyticsProvider` (`analytics_handler.go:28`), `admin.homepageConfigProvider` (`homepage_config_handler.go:13`).
- Pattern: interface defined in the consumer package; ent adapter or `*Sub2APIClient` implements it; constructor takes the interface.

**page-registry (KTD7 single source of truth):**
- Purpose: One id namespace shared by routes (`App.tsx`), telemetry (`page_id`), and the dashboard.
- Examples: `frontend/src/lib/page-registry.ts` (`PAGE_REGISTRY` array, `getPageByPath`, `getPages`).
- Pattern: `as const` readonly array; `page-registry.test.ts` asserts registry ↔ App.tsx routes consistency. Adding a page = 3 steps (registry entry → App.tsx route → page component), documented in the file header.

**Standard response envelope:**
- Purpose: Uniform API shape across success/error.
- Examples: `backend/internal/pkg/response/response.go`; mirrored in frontend as `AuxEnvelope<T>` (`api-client.ts:17`).
- Pattern: success `{code:0, message:"success", data}`; error `{code:<http>, message, reason?}`. `ErrorWithReason` carries machine-readable reasons (e.g. `NOT_ADMIN`, `TWO_FACTOR_REQUIRED`) that the frontend switches on.

**Sentinel errors with `errors.Is` chains:**
- Purpose: Layer-crossing error classification without type assertions.
- Examples: `integration.ErrInvalidToken`, `integration.ErrInvalidCredentials`, `integration.ErrSub2APIUnreachable` (`sub2api_client.go:204-210`); `service.ErrNotAdmin`, `service.ErrTwoFactorRequired` (`auth_service.go:42-48`). Service wraps integration sentinels with `%w` so `errors.Is(err, integration.ErrSub2APIUnreachable)` works across layers.
- Pattern: handler `switch { case errors.Is(...): }` maps to HTTP status + reason.

**Two-JWT split:**
- Purpose: Avoid conflating sub2api identity with aux session.
- Examples: sub2api JWT forwarded only at `/admin/session`+`/admin/login`; aux JWT carried in `X-Aux-Session` (defined in both `admin_guard.go:25` and `admin-auth.ts:20`).

## Entry Points

**Backend process:**
- Location: `backend/cmd/server/main.go`
- Triggers: Docker `ENTRYPOINT ["/app/aux-server"]`; `make dev` (`go run ./cmd/server`); `make migrate` (`go run ./cmd/server -migrate`).
- Responsibilities: flag parsing (`-version`, `-migrate`), config load, ent init + DB ping, DI wiring, HTTP server lifecycle (graceful shutdown on SIGINT/SIGTERM).

**Frontend bootstrap:**
- Location: `frontend/src/main.tsx`
- Triggers: browser loading the SPA (served by backend in prod, by Vite dev server on `:3100` in dev).
- Responsibilities: parse iframe params → apply theme → init telemetry route listener → mount React tree.

**HTTP route groups (backend):**
- `GET /health` — public, no guard.
- `/api/aux/*` — public group: `GET /api/aux`, `GET /api/aux/homepage/config`, `POST /api/aux/telemetry/{page-view,feature-click}` (TelemetryGuard).
- `/api/aux/admin/session`, `/api/aux/admin/login` — outside AdminGuard (exchange/credential flows).
- `/api/aux/admin/*` (guarded) — `GET /api/aux/admin`, `GET /api/aux/admin/analytics/overview`, `GET/PUT /api/aux/admin/homepage/config`, `GET /api/aux/admin/examples/status`.

## Architectural Constraints

- **Threading/concurrency:** Gin handles one goroutine per request (standard net/http model). `AnalyticsService.GetOverview` explicitly fans out two concurrent store queries with a `sync.WaitGroup` + mutex; `AuthService.cache` and `defaultTelemetryLimiter.buckets` are mutex-guarded maps. No worker pools, no queues.
- **Module-level mutable state (singletons):**
  - `backend/internal/server/router.go:78` `indexHandler` (reset to nil at top of `SetupRouter` to avoid cross-test residue).
  - `backend/internal/server/middleware/telemetry_guard.go:60` `defaultTelemetryLimiter` (process-global per-IP buckets; no eviction — acceptable at MVP scale, LRU noted as future need).
  - `backend/internal/service/auth_service.go` per-instance `cache` map (instance-scoped, not global).
  - `frontend/src/lib/admin-auth.ts:236` `cachedSession` (memory mirror of localStorage).
  - `frontend/src/lib/embedded.ts:56` `currentContext`.
  - `frontend/src/lib/visitor-id.ts:19` `memoryVisitorId`.
  - `frontend/src/lib/telemetry-sdk.ts:25-31` `initialized` / `unsubscribeHistory` / `lastRouteKey` (test-reset via `resetTelemetry`).
- **Circular imports — explicitly avoided:** `frontend/src/lib/api-base.ts` exists as a dependency-free leaf so `api-client` (imports `admin-auth`) and `admin-auth` (needs base URL) don't cycle. Backend has no known circular packages.
- **Migration is explicit, not automatic:** `main.go` does *not* auto-migrate on startup (avoids prod schema drift). Use `make migrate` / `-migrate` flag once, or rely on the Docker image which ships with schema. `ent_integration_test.go` is gated behind `//go:build integration` and self-skips without `DATABASE_DBNAME`.
- **Backend never imports sub2api packages.** All sub2api interaction is HTTP via `internal/integration`. aux-system is a standalone Go module (`module aux-system`).
- **Telemetry is append-only.** `TelemetryService` exposes only `Create*`; `page_views`/`feature_clicks` have no update/delete paths and `created_at` is `Immutable()`.
- **Telemetry must never block the UI (KTD4).** `telemetry-sdk.ts` uses fire-and-forget `fetch` + `catch`; backend returns errors but the SDK discards them.
- **Public write surface is defended.** Telemetry endpoints are anonymous-writable and sit behind `TelemetryGuard` (body limit + rate limit) — without it, unbounded writes could exhaust storage / pollute analytics (#7).
- **Failure-closed on sub2api unreachability.** `AuthService` returns `ErrSub2APIUnreachable` (wrapped) → handler maps to 503; no session is issued when sub2api cannot be reached.

## Anti-Patterns

### Module-level mutable singletons in router/middleware/lib

**What happens:** `indexHandler` (`router.go:78`), `defaultTelemetryLimiter` (`telemetry_guard.go:60`), `cachedSession` (`admin-auth.ts:236`), `currentContext` (`embedded.ts:56`), `memoryVisitorId` (`visitor-id.ts:19`), and telemetry-sdk flags (`telemetry-sdk.ts:25-31`) are package-level mutable variables shared across all callers in the process.
**Why it's wrong:** Cross-test state leakage; `SetupRouter` already has to defensively reset `indexHandler = nil` to work around this. The frontend lib singletons require explicit `reset*` helpers in tests.
**Do this instead:** For new backend middleware state, prefer per-router-instance fields on a struct constructed in `main.go` and passed into `SetupRouter`, rather than package vars. For frontend lib state, keep the existing module-singleton pattern (it's load-bearing for `localStorage` mirroring) but always expose a `reset*` test helper — see `resetTelemetry`, `resetVisitorId`, `clearVisitorIdMemoryCache`.

### Status-code-then-JSON ordering assumption for sub2api responses

**What happens:** `sub2api_client.go:88` and `:175` deliberately check `resp.StatusCode == 401` *before* attempting JSON decode, because reverse proxies/gateways may return non-JSON 401 bodies. Decoding first would misclassify a token failure as "unreachable".
**Why it matters (as a constraint, not a bug):** Any new sub2api endpoint integration must preserve this ordering or the R4 error-grading semantics (token-expired vs service-unreachable) break.
**Do this instead:** When adding a new sub2api call, mirror `VerifyAdminJWT`/`Login`: check 401 first → `ErrInvalidToken`/`ErrInvalidCredentials`; only then unmarshal the envelope; treat other non-200 as generic errors; wrap network failures with `%w: ErrSub2APIUnreachable`.

## Error Handling

**Strategy:** Sentinel errors + `errors.Is` classification at handler boundaries; standard envelope on the wire.

**Patterns:**
- Service/integration layers define exported sentinel `var Err... = errors.New(...)`; cross-layer wrapping uses `fmt.Errorf("%w: ...", sentinel, cause)` to preserve `errors.Is` chains (see `auth_service.go:145`, `:182`).
- Handlers `switch { case errors.Is(err, X): response.<Status>(...) }` — e.g. `auth_handler.go:73-83` and `:125-137`. Distinct user-facing reasons are carried via `response.ErrorWithReason` (403 `NOT_ADMIN` vs `TWO_FACTOR_REQUIRED`).
- Frontend maps HTTP status → typed `SessionError`/`LoginError` unions (`admin-auth.ts:126-137`, `:219-230`); UI renders localized messages from a `Record<Error, string>` (`AdminGuard.tsx:28`, `LoginPage.tsx:20`).
- Concurrent aggregation errors are joined, not swallowed (`analytics_service.go:113` `errors.Join(firstErr, secondErr)` — #12).
- Public homepage read degrades to defaults instead of erroring (`homepage_config_handler.go:43`, `homepage-config.ts:78`) — the public homepage must stay usable when the DB blips.

## Cross-Cutting Concerns

**Logging:** `log` standard library (stdout). `gin.Logger()` middleware for request logs; `gin.Recovery()` for panics. No structured logger / no log levels. Startup logs config (mode, DB host/port/db) and shutdown progress.

**Validation:** Backend uses Gin `binding:"required"`/`email` tags on request structs (`auth_handler.go:33,53`, `telemetry_handler.go:33-50`) for shape, then service-layer semantic validation (non-empty trimmed, max length 128 — `telemetry_service.go:82-90`, aligned with ent `MaxLen(128)` so over-long values 400 instead of 500). `HomepageConfigService.normalizeHomepageConfig` enforces content bounds + URL safety. Frontend `isValidAdminSession` (`admin-auth.ts:287`) validates session shape *and* JWT HS256+exp before trusting localStorage.

**Authentication:** Two-tier. (1) sub2api JWT → forwarded to sub2api `/auth/me` (TTL-cached, SHA-256 keyed) — only at session-exchange/login. (2) aux-session JWT (HS256, `X-Aux-Session`) — validated by `AdminGuard` middleware on every guarded request. Frontend `AdminGuard` component gates routes; `api-client` auto-attaches the header. Session expiry is checked both client-side (JWT `exp` decode) and server-side (`ValidateSession`).

**Authorization:** Role check `role == "admin"` enforced in `AuthService.VerifyAdminToken`/`LoginAdmin` before issuing an aux session. There are no finer-grained permissions — any aux session can access all `/admin/*` endpoints.

**CORS:** None. Same-origin deploy (backend serves frontend). Dev mode uses Vite proxy (`vite.config.ts:22` `/api` → `http://127.0.0.1:8004`).

**Configuration:** `backend/internal/config/config.go` — viper with env-var precedence (`DATABASE_*`, `SERVER_*`, `JWT_*`, `SUB2API_BASE_URL`, `AUX_FRONTEND_DIST`); optional `config.yaml`; `validate()` rejects missing required fields. `LoadFromEnv()` is the env-only path used by Docker.

---

*Architecture analysis: 2026-08-18*
