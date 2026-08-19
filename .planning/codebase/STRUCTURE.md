# Codebase Structure

**Analysis Date:** 2026-08-18

## Directory Layout

```
sub2api-extension/
├── backend/                 # Go (Gin + Ent) backend, standalone module `sub2api-extension`
│   ├── cmd/server/          # Process entry (main.go + VERSION)
│   ├── ent/                 # Generated Ent ORM + schema definitions
│   │   └── schema/          # Source-of-truth entity schemas (edit here, regen)
│   ├── internal/
│   │   ├── config/          # Config load/validate (viper + env)
│   │   ├── handler/         # HTTP handlers
│   │   │   └── admin/       # Admin-guarded handlers (analytics, homepage, example)
│   │   ├── integration/     # External HTTP client (sub2api)
│   │   ├── pkg/response/    # Standard response envelope
│   │   ├── server/          # Gin router assembly
│   │   │   └── middleware/  # AdminGuard, TelemetryGuard
│   │   ├── service/         # Business logic + store interfaces + ent adapters
│   │   └── web/             # Health handler
│   ├── bin/                 # Built binary output (make build)
│   ├── Makefile             # dev/migrate/build/test targets
│   ├── go.mod / go.sum      # Go 1.26.5 module
│   └── server               # (legacy/empty — see Notes)
├── frontend/                # React 18 + Vite + TypeScript SPA
│   ├── src/
│   │   ├── components/      # AdminGuard, ErrorState
│   │   ├── layouts/         # PublicLayout, AdminLayout
│   │   ├── lib/             # Framework-free modules (api, auth, telemetry, registry)
│   │   ├── pages/           # Route components
│   │   │   ├── admin/       # DashboardPage, HomepageConfigPage
│   │   │   └── examples/    # Content/Interaction/API example pages
│   │   ├── App.tsx          # Route root
│   │   ├── main.tsx         # Bootstrap (embedded parse, theme, telemetry, mount)
│   │   ├── index.css        # Tailwind entry + custom homepage CSS
│   │   └── test-setup.ts    # Vitest setup (jest-dom matchers)
│   ├── public/              # Static assets (favicon)
│   ├── dist/                # Build output (gitignored; embedded by backend in prod)
│   ├── index.html           # SPA shell
│   ├── package.json         # pnpm, React 18, react-router-dom 6, Vitest
│   ├── vite.config.ts       # Vite + Vitest + @ alias + dev proxy
│   ├── tsconfig.json        # Strict TS, @/* path alias
│   └── tailwind.config.js   # darkMode: 'class'
├── deploy/                  # Deployment configs
│   ├── docker-compose.yml           # Dev/single-host: aux-postgres + aux-backend
│   ├── docker-compose.prod.yml      # Prod (external PostgreSQL)
│   ├── config.example.yaml          # Sample backend config
│   └── build-and-push.sh            # Image build/push script
├── docs/
│   ├── INTEGRATION.md       # sub2api iframe integration guide
│   └── superpowers/         # (planning/spec docs — not app code)
├── output/playwright/       # Playwright test artifacts (not app code)
├── .github/workflows/       # CI: ci.yml, deploy-test.yml, deploy-production.yml, security-scan.yml
├── .planning/codebase/      # GSD codebase maps (this file lives here)
├── Dockerfile               # 3-stage: frontend build → backend build → runtime (single image)
├── README.md
└── .gitignore
```

## Directory Purposes

**`backend/`:**
- Purpose: Go backend, independent module (`module sub2api-extension`, Go 1.26.5).
- Contains: `cmd/` (entry), `internal/` (all app code, unexported packages), `ent/` (ORM), `Makefile`, `go.mod`/`go.sum`.
- Key files: `cmd/server/main.go`, `internal/server/router.go`, `ent/schema/*.go`.

**`backend/cmd/server/`:**
- Purpose: Process entrypoint. One binary, one command.
- Contains: `main.go` (bootstrap + DI + lifecycle), `VERSION` (read by Makefile/CI for ldflags).
- Note: `main.go` also holds `-migrate` subcommand path (flag-driven, not a separate binary).

**`backend/ent/`:**
- Purpose: Ent ORM — generated code + schema source.
- Contains: `schema/` (3 hand-edited schemas), generated `*.go` per entity (`pageview/`, `featureclick/`, `systemmeta/`), `migrate/`, `enttest/`, `hook/`, `predicate/`, `runtime/`, `generate.go`.
- Key files: `ent/schema/page_view.go`, `ent/schema/feature_click.go`, `ent/schema/system_meta.go`, `ent/generate.go`.
- Edit rule: edit only `schema/*.go`; regenerate with `go generate ./ent` from `backend/`.

**`backend/internal/config/`:**
- Purpose: Config loading (viper), defaults, validation, DSN builder.
- Key files: `config.go` (`Load`, `LoadFromEnv`, `validate`, `DatabaseConfig.DSN`), `config_test.go`.

**`backend/internal/server/`:**
- Purpose: Gin engine assembly + route registration + middleware.
- Key files: `router.go` (`SetupRouter`, `registerCommonRoutes`, `registerAuxRoutes`, `registerFrontendStatic`, `NoRoute`), `middleware/admin_guard.go`, `middleware/telemetry_guard.go`, `router_test.go`, `ent_integration_test.go` (build-tagged `integration`).

**`backend/internal/handler/`:**
- Purpose: HTTP request handlers (binding, error mapping, envelope).
- Contains: `auth_handler.go`, `telemetry_handler.go` at top level; `admin/` subpackage for guarded handlers.
- Key files: `auth_handler.go`, `telemetry_handler.go`, `admin/analytics_handler.go`, `admin/homepage_config_handler.go`, `admin/example_handler.go`.

**`backend/internal/service/`:**
- Purpose: Business logic, store interfaces, ent adapters.
- Key files: `auth_service.go`, `telemetry_service.go`+`telemetry_store.go`, `analytics_service.go`+`analytics_store.go`, `homepage_config_service.go` (store adapter in-file).

**`backend/internal/integration/`:**
- Purpose: External HTTP integration (sub2api only).
- Key files: `sub2api_client.go` (`Sub2APIClient`, sentinel errors), `sub2api_client_test.go`.

**`backend/internal/pkg/response/`:**
- Purpose: Standard envelope helpers shared across handlers/middleware/router.
- Key files: `response.go`.

**`backend/internal/web/`:**
- Purpose: Non-API web handlers (currently just health).
- Key files: `health.go`.

**`frontend/src/`:**
- Purpose: All frontend source.
- Contains: `main.tsx`, `App.tsx`, `components/`, `layouts/`, `lib/`, `pages/`, `index.css`, `test-setup.ts`.

**`frontend/src/lib/`:**
- Purpose: Framework-free TypeScript modules (the app's "engine"). No React imports (except types where unavoidable).
- Key files: `api-base.ts` (leaf constant `AUX_API_BASE_URL = '/api/aux'`), `api-client.ts`, `admin-auth.ts`, `telemetry-sdk.ts`, `page-registry.ts`, `embedded.ts`, `visitor-id.ts`, `theme.ts`, `homepage-config.ts`.

**`frontend/src/pages/`:**
- Purpose: Route-level React components.
- Contains: `HomePage.tsx`, `LoginPage.tsx`, `admin/` (DashboardPage, HomepageConfigPage), `examples/` (ContentExamplePage, InteractionExamplePage, APIExamplePage).

**`frontend/src/components/`:**
- Purpose: Shared React components.
- Key files: `AdminGuard.tsx` (route guard), `ErrorState.tsx` (shared error UI).

**`frontend/src/layouts/`:**
- Purpose: Shell layouts wrapping `<Outlet/>`.
- Key files: `PublicLayout.tsx`, `AdminLayout.tsx` (admin nav).

**`deploy/`:**
- Purpose: Docker Compose + sample config + build script.
- Key files: `docker-compose.yml` (dev, with `aux-postgres`), `docker-compose.prod.yml` (external PG), `config.example.yaml`, `build-and-push.sh`.

**`docs/`:**
- Purpose: Project documentation.
- Key files: `INTEGRATION.md` (sub2api iframe/menu integration guide — the canonical "how to wire aux into sub2api" doc).

**`.github/workflows/`:**
- Purpose: CI/CD.
- Key files: `ci.yml` (backend test+lint, frontend test+typecheck+build), `deploy-test.yml` (test image/deployment), `deploy-production.yml` (versioned production image/deployment), `security-scan.yml`.

## Key File Locations

**Entry Points:**
- `backend/cmd/server/main.go`: Go process entry; DI wiring; `-migrate` flag.
- `frontend/src/main.tsx`: SPA bootstrap (embedded parse → theme → telemetry → mount).
- `frontend/src/App.tsx`: Route declarations.
- `backend/internal/server/router.go`: HTTP route table.

**Configuration:**
- `backend/internal/config/config.go`: config load/validate.
- `deploy/config.example.yaml`: sample backend config.
- `deploy/docker-compose.yml`: runtime env vars (canonical source of deployment config).
- `frontend/vite.config.ts`: Vite/Vitest config + dev proxy (`/api` → `127.0.0.1:8004`).
- `frontend/tsconfig.json`: TS strict + `@/*` path alias.
- `frontend/tailwind.config.js`: `darkMode: 'class'`, content globs.
- `Dockerfile`: 3-stage build; sets `AUX_FRONTEND_DIST=/app/frontend/dist`.

**Core Logic:**
- `backend/internal/service/auth_service.go`: sub2api forward-verify + aux JWT issue/validate + TTL cache.
- `backend/internal/integration/sub2api_client.go`: HTTP client to sub2api `/auth/me`, `/auth/login`.
- `backend/internal/service/analytics_service.go`: concurrent aggregation + sort.
- `backend/internal/service/homepage_config_service.go`: normalize + persist to `system_meta`.
- `backend/internal/server/middleware/admin_guard.go`: `X-Aux-Session` validation.
- `backend/internal/server/middleware/telemetry_guard.go`: body limit + per-IP rate limit.
- `frontend/src/lib/page-registry.ts`: KTD7 single source of truth for page identity.
- `frontend/src/lib/admin-auth.ts`: session exchange/login/persist.
- `frontend/src/lib/api-client.ts`: fetch wrapper + header injection.
- `frontend/src/lib/telemetry-sdk.ts`: route-listener page-view + manual feature-click.
- `frontend/src/components/AdminGuard.tsx`: frontend route guard.

**Persistence:**
- `backend/ent/schema/page_view.go`: `page_views` table (append-only).
- `backend/ent/schema/feature_click.go`: `feature_clicks` table (append-only).
- `backend/ent/schema/system_meta.go`: `system_meta` key/value (used for homepage config JSON).

**Testing:**
- Backend: `*_test.go` co-located in each package; `backend/internal/server/ent_integration_test.go` (build-tagged `integration`).
- Frontend: `*.test.tsx` / `*.test.ts` co-located in `src/`; `frontend/src/test-setup.ts` (jest-dom).
- E2E artifacts: `output/playwright/` (not wired into CI unit test runs).

## Naming Conventions

**Backend files (Go):**
- `snake_case.go` for files: `auth_handler.go`, `telemetry_guard.go`, `sub2api_client.go`, `homepage_config_service.go`, `ent_integration_test.go`.
- Package = directory name: `handler`, `admin`, `service`, `integration`, `response`, `middleware`, `config`, `web`, `server`, `schema`, `ent`.
- Test files: `<name>_test.go`; integration tests additionally carry `//go:build integration`.
- Exported types: `PascalCase` (`AuthService`, `TelemetryHandler`, `Sub2APIClient`, `OverviewResponse`).
- Errors: `Err<Name>` sentinels (`ErrNotAdmin`, `ErrInvalidToken`, `ErrSub2APIUnreachable`).
- Constructors: `New<Thing>(...)` (`NewAuthService`, `NewTelemetryHandler`, `NewEntTelemetryStore`).
- Config env vars: `UPPER_SNAKE` prefixed by section (`DATABASE_HOST`, `JWT_SECRET`, `SUB2API_BASE_URL`, `AUX_FRONTEND_DIST`).

**Frontend files (TS/TSX):**
- Components/layouts/pages: `PascalCase.tsx` (`AdminGuard.tsx`, `DashboardPage.tsx`, `AdminLayout.tsx`).
- Lib modules: `kebab-case.ts` (`api-client.ts`, `page-registry.ts`, `admin-auth.ts`).
- Tests: `<name>.test.ts(x)` co-located next to source.
- Types/interfaces: `PascalCase` (`AuxEnvelope<T>`, `AdminSession`, `PageEntry`, `EmbeddedContext`).
- Constants: `UPPER_SNAKE` (`AUX_API_BASE_URL`, `PAGE_REGISTRY`, `DEFAULT_HOMEPAGE_CONFIG`, `ADMIN_SESSION_HEADER`, `SESSION_STORAGE_KEY`).
- Page id strings (telemetry/registry): `kebab-case` matching the route segment (`home`, `dashboard`, `homepage-config`, `example-content`, `example-interaction`, `example-api`).

**Directories:**
- Backend: lowercase single-word packages under `internal/`; `admin/` is the only nested handler subpackage.
- Frontend: lowercase plural for collections (`components/`, `layouts/`, `pages/`, `lib/`); `admin/` and `examples/` nest under `pages/`.

**Routes / APIs:**
- Backend API prefix: `/api/aux` (public + telemetry) and `/api/aux/admin` (guarded). Health at `/health`.
- Frontend routes: `/`, `/login`, `/admin/<page>`, `/admin/examples/<page>`. Admin route segments match `page-registry.ts` `path` values.

## Where to Add New Code

**New admin page (the canonical 3-step flow, documented in `page-registry.ts`):**
1. Add an entry to `PAGE_REGISTRY` in `frontend/src/lib/page-registry.ts` (id / title / path / visibility `'admin'`). The id is now the telemetry + dashboard identity.
2. Register the route in `frontend/src/App.tsx` under the `<AdminGuard><AdminLayout/></AdminGuard>` parent (path must match the registry entry).
3. Implement the page component under `frontend/src/pages/admin/` (or `frontend/src/pages/examples/` for sample pages). Co-locate `<Name>.test.tsx`.
4. (If the page needs backend data) Add handler in `backend/internal/handler/admin/`, service in `backend/internal/service/` (with a store interface if it touches ent), register the route in `registerAuxRoutes` guarded group (`backend/internal/server/router.go:164`), wire it in `main.go`.

**New public page:**
- Same registry step with `visibility: 'public'`; route in `App.tsx` outside AdminGuard; component in `frontend/src/pages/`. Public telemetry (`page_id`) flows automatically via `telemetry-sdk.ts`.

**New telemetry feature-click point:**
- Call `trackFeatureClick(pageId, featureId)` from `frontend/src/lib/telemetry-sdk.ts` in an event handler. `pageId` must come from `page-registry.ts`; `featureId` is a frontend-convention string (e.g. `'refresh-status'`, `'save-config'`, `'increment-counter'`).

**New backend endpoint (guarded):**
- Handler in `backend/internal/handler/admin/` (or top-level `handler/` if not admin-scoped) with a `New*` constructor taking a provider interface.
- Register in the `guarded` group in `backend/internal/server/router.go:164` (after the analytics/homepage/example routes).
- Wire the handler in `backend/cmd/server/main.go` (construct service from a store adapter built on the shared ent client) and pass into `SetupRouter`.

**New backend endpoint (public/anonymous-write):**
- Add to the `aux` group (`router.go:131`). If it writes data anonymously, protect it with `middleware.TelemetryGuard()` (or a similar guard) — do not expose unbounded anonymous writes (#7).

**New ent entity / schema change:**
- Add/edit `backend/ent/schema/<entity>.go` (mirror the `Annotations`/`Fields`/`Edges`/`Indexes` style of existing schemas; use `entsql.Annotation{Table: "..."}` for table name; `Immutable()` `created_at` for append-only).
- Run `go generate ./ent` from `backend/` to regenerate.
- Add a store interface + ent adapter in `backend/internal/service/` (mirror `TelemetryStore`/`entTelemetryStore`).
- Migration is manual: `make migrate` (dev) or rebuild the Docker image (prod). Startup never auto-migrates.

**New shared frontend utility:**
- Add to `frontend/src/lib/` as a framework-free module (no React imports). If it needs the API base URL, import from `api-base.ts` to avoid cycles. If it needs session/embedded context, import from `admin-auth.ts`/`embedded.ts`.

**New shared UI component:**
- Add to `frontend/src/components/` as `PascalCase.tsx`. Reuse `ErrorState.tsx` for load-failure UI; reuse the `loading`/`ok`/`error` state-machine pattern seen in `DashboardPage.tsx` / `APIExamplePage.tsx`.

**New external integration (non-sub2api):**
- Add a client in `backend/internal/integration/` mirroring `sub2api_client.go` (HTTP client + sentinel errors + `%w` wrapping of network errors). Inject via an interface in the consuming service.

**Tests:**
- Backend unit test: `<name>_test.go` co-located, no build tag. Use `testify` (`assert`/`require`/`mock`); inject fake stores/providers via the interfaces.
- Backend integration test (needs PostgreSQL): add `//go:build integration` and self-skip when `DATABASE_DBNAME` unset (see `ent_integration_test.go`).
- Frontend test: `<name>.test.ts(x)` co-located, Vitest + `@testing-library/react`. Reset lib singletons via their `reset*` helpers in `beforeEach`.

## Special Directories

**`backend/ent/` (generated):**
- Purpose: Ent ORM generated code.
- Generated: Yes (`go generate ./ent`).
- Committed: Yes (generated output is checked in so CI/build doesn't need to run codegen).
- Edit rule: only edit `backend/ent/schema/`; never hand-edit other `ent/*.go`.

**`backend/bin/`:**
- Purpose: `make build` binary output.
- Generated: Yes.
- Committed: No (gitignored).

**`frontend/dist/`:**
- Purpose: Vite production build output; embedded into the backend Docker image at `/app/frontend/dist`.
- Generated: Yes (`pnpm run build`).
- Committed: No (gitignored).

**`frontend/node_modules/`:**
- Generated: Yes (pnpm).
- Committed: No.

**`output/playwright/`:**
- Purpose: Playwright test run artifacts (screenshots/traces).
- Generated: Yes.
- Committed: No (not part of the app).

**`docs/superpowers/`:**
- Purpose: Planning/spec documents (plans/, specs/).
- Generated: No.
- Committed: Yes (but not application code — don't import from here).

**`.planning/codebase/`:**
- Purpose: GSD codebase maps (STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, CONCERNS).
- Generated: Yes (by `/gsd:map-codebase`).
- Committed: Yes (consumed by `/gsd:plan-phase` and `/gsd:execute-phase`).

**`deploy/`:**
- Purpose: Deployment configs only. Not imported by app code.
- Committed: Yes.

**Notes:**
- `backend/server/` (top-level, distinct from `backend/internal/server/`) appears in the listing but is not part of the application code path — the live router lives in `backend/internal/server/`. Treat `backend/internal/server/` as the authoritative location.
- The backend has no `configs/` or `migrations/` directory: config is env-first (`config.go`) and migrations are ent auto-migration driven by `backend/ent/schema/` + `backend/ent/migrate/` (generated).

---

*Structure analysis: 2026-08-18*
