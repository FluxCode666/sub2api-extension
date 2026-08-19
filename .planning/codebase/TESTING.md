# Testing Patterns

**Analysis Date:** 2026-08-18

This is a brownfield Go backend + React/TypeScript frontend monorepo. Both sides have co-located unit tests run in CI. Integration tests requiring PostgreSQL are isolated behind a build tag and auto-skip when no DB is configured. Follow the patterns below when adding or modifying tests.

## Test Frameworks

### Backend (Go)

**Runner:**
- Go testing (stdlib `testing`) + `go test -race -count=1 ./...`
- Config: `backend/Makefile` (targets `test`, `test-unit`, `test-integration`, `vet`, `fmt`)
- Race detector is **always on** (`-race`) for both unit and integration runs.

**Assertion Library:**
- `github.com/stretchr/testify` v1.11.1 — `assert` (non-fatal) + `require` (fatal, stops the test). Import both:
  ```go
  import (
      "github.com/stretchr/testify/assert"
      "github.com/stretchr/testify/require"
  )
  ```

**Run Commands:**
```bash
make test                      # unit tests only (default; skips integration)
make test-unit                 # go test -race -count=1 ./...
make test-integration          # go test -tags=integration -race -count=1 ./...  (needs PostgreSQL)
make vet                       # go vet ./...
make fmt                       # gofmt -s -w .
```

### Frontend (TS/TSX)

**Runner:**
- Vitest 2.1.9 + jsdom environment, configured in `frontend/vite.config.ts:13-17` (`test.globals: true`, `environment: 'jsdom'`, `setupFiles: './src/test-setup.ts'`).
- `@testing-library/react` 16.3.2 + `@testing-library/jest-dom` 6.4.0 + `@testing-library/user-event` 14.6.4.
- Globals are enabled (`globals: true`) so `describe`/`it`/`expect`/`vi` are available without imports — but the existing tests **do** import them explicitly from `vitest` (`import { describe, it, expect, vi } from 'vitest'`). Match that explicit-import style.

**Assertion Library:**
- Vitest's built-in `expect` + jest-dom matchers (`toBeInTheDocument`, `toHaveAttribute`, `toHaveTextContent`). jest-dom is wired in via `frontend/src/test-setup.ts` (`import '@testing-library/jest-dom/vitest'`) and declared in `tsconfig.json` `types`.

**Run Commands:**
```bash
pnpm run test           # vitest run (single pass, CI mode)
pnpm run test:watch     # vitest (watch mode)
pnpm run typecheck      # tsc --noEmit (run before tests in CI)
pnpm run build          # tsc -b && vite build (build verification)
```

## Test File Organization

**Location:**
- **Co-located**: every test sits next to its source file. Backend `foo.go` → `foo_test.go` in the same package. Frontend `Foo.tsx` → `Foo.test.tsx` in the same directory.
- 14 backend test files (excluding `ent/` generated), 16 frontend test files.

**Naming:**

- Backend: `*_test.go` (Go convention). Test funcs: `Test<Subject>_<Scenario>` (`TestTelemetryService_RecordPageView_Success`, `TestAdminGuard_InvalidSession_Rejected`).
- Frontend: `*.test.tsx` (components/pages) / `*.test.ts` (pure logic). Suites: `describe('<ModuleName>', () => { ... })`, cases `it('<behavior>', () => { ... })`.

**Structure:**
```
backend/internal/
├── handler/
│   ├── telemetry_handler.go
│   ├── telemetry_handler_test.go        # handler-level, uses gin.TestMode + httptest
│   └── admin/
│       └── analytics_handler_test.go
├── service/
│   ├── telemetry_service.go
│   ├── telemetry_service_test.go        # service-level, in-memory mock store
│   └── analytics_service_test.go
├── server/
│   ├── router.go
│   ├── router_test.go                   # route registration + guard boundaries
│   └── ent_integration_test.go          # //go:build integration  (separate)
└── server/middleware/
    ├── admin_guard.go
    └── admin_guard_test.go

frontend/src/
├── App.tsx
├── App.test.tsx                         # routing structure, mocks child pages
├── components/
│   ├── AdminGuard.tsx
│   └── AdminGuard.test.tsx
├── lib/
│   ├── api-client.ts
│   └── api-client.test.ts
└── pages/admin/
    ├── DashboardPage.tsx
    └── DashboardPage.test.tsx
```

## Test Structure

### Backend (Go)

**Suite Organization — table-driven where multi-case, plain funcs where single:**

Single-behavior tests are plain `func TestX_Y(t *testing.T) { ... }`. Multi-branch tests (e.g. error enum, field permutations) use a slice of cases iterated with a `for`/`forEach`:

```go
// From backend/internal/server/middleware (deniedCases pattern, also used in frontend)
const deniedCases = []struct{ error, expectedText string }{ ... }
for _, tc := range deniedCases {
    t.Run(tc.error, func(t *testing.T) { ... })   // or inline assertions
}
```

**Standard handler test shape** (`backend/internal/handler/telemetry_handler_test.go`):

```go
func TestTelemetryHandler_RecordPageView_Success(t *testing.T) {
    store := &handlerMockTelemetryStore{}        // 1. build mock store
    svc := service.NewTelemetryService(store)    // 2. wire service with mock
    h := NewTelemetryHandler(svc)                // 3. wire handler with service
    r := setupTelemetryRouter(h)                 // 4. build a minimal gin router

    w := doTelemetryPost(r, "/api/aux/telemetry/page-view", PageViewRequest{
        PageID: "home", VisitorID: "visitor-abc", IsAdmin: false,
    })                                           // 5. exercise via httptest

    require.Equal(t, http.StatusCreated, w.Code) // 6. assert HTTP + envelope
    env := decodeTelemetryEnvelope(t, w)
    assert.Equal(t, 0, env.Code)
    assert.Len(t, store.pageViews, 1)            // 7. assert side-effect on mock
}
```

**Patterns:**
- **`require` for setup/fatal failures** (parse errors, missing preconditions), **`assert` for the actual assertions** so a test reports multiple failures.
- **`t.Helper()`** in test helpers (`decodeTelemetryEnvelope`, `buildTestDSN`, `newTestAuthService`) so failures point at the caller.
- **`gin.SetMode(gin.TestMode)`** at the top of every router/handler test to suppress noisy logs.
- **Envelope decoding**: tests unmarshal into a local `telemetryEnvelope` struct (with `json.RawMessage` for `data`) to assert the standard envelope shape — see `telemetry_handler_test.go:43-48`.
- **Side-effect assertions on the mock**: after a request, assert `store.pageViews` length/contents to verify the record was persisted with correct fields.

### Frontend (TS/TSX)

**Suite Organization:**

```typescript
// frontend/src/components/AdminGuard.test.tsx
describe('AdminGuard', () => {
  beforeEach(() => {
    exchangeSessionMock.mockReset()
    getAdminSessionMock.mockReturnValue(null)   // reset to a known default
    // ...
  })
  afterEach(() => { vi.clearAllMocks() })

  it('shows loading state initially while verifying', () => { ... })

  // table-driven for enum branches:
  const deniedCases: Array<{ error: string; expectedText: string }> = [ ... ]
  deniedCases.forEach(({ error, expectedText }) => {
    it(`shows denied state with correct message for ${error}`, async () => { ... })
  })
})
```

**Patterns:**
- **Async tests** use `async () => { ... }` with `await waitFor(...)` / `await screen.findByText(...)` (find* retries; get* is synchronous and only after settle).
- **MemoryRouter wrapping**: any component using router hooks (`Navigate`, `useLocation`, `Link`) must be rendered inside `<MemoryRouter initialEntries={[...]}>`. See `renderGuard` helper in `AdminGuard.test.tsx:48-62` and `App.test.tsx`.
- **Role-based queries preferred**: `screen.getByRole('heading', { name: '...' })`, `screen.getByRole('link', { name: ... })` over `getByTestId`/`getByText` where a role exists.
- **`vi.clearAllMocks()` in `afterEach`**; per-mock `mockReset()` in `beforeEach` to also clear return values.

## Mocking

### Backend (Go)

**Framework:** Hand-written in-memory mocks implementing the Store interface. **No mocking framework** (no testify/mock, no gomock). Each test package defines its own mock struct.

**Patterns:**

```go
// backend/internal/service/telemetry_service_test.go:15-35
type mockTelemetryStore struct {
    pageViews     []PageViewRecord
    featureClicks []FeatureClickRecord
    createErr     error // 若非 nil, Create 返回此错误
}

func (m *mockTelemetryStore) CreatePageView(_ context.Context, rec PageViewRecord) error {
    if m.createErr != nil { return m.createErr }
    m.pageViews = append(m.pageViews, rec)
    return nil
}
```

- Mocks store received records in slices so tests can assert what was persisted.
- A single `err` / `createErr` field injects a failure path. For independent failure injection per query, use separate fields (`pageViewErr`, `featureErr` in `analytics_service_test.go:13-18`).
- **Mocks are package-scoped and intentionally differently named across packages** to avoid cross-package confusion: `mockTelemetryStore` (service pkg), `handlerMockTelemetryStore` (handler pkg), `mockAnalyticsStoreForRouter` (server pkg). When adding a mock, pick a name unique to its package and note the convention in a comment.
- `assert.AnError` is the standard injected error sentinel (`store := &mockTelemetryStore{err: assert.AnError}`).

**What to Mock:**
- The Store interface (`TelemetryStore`, `AnalyticsStore`) at the service boundary.
- The provider interface (`analyticsProvider`) at the handler boundary, via the `new<Thing>WithProvider` constructor (`analytics_handler.go:45`).
- External HTTP clients: point `integration.NewSub2APIClient` at an unreachable address (`http://127.0.0.1:1`) for route-structure tests that don't actually call sub2api (`router_test.go:42`).

**What NOT to Mock:**
- The `*ent.Client` / real PostgreSQL in unit tests — that's what the Store interface abstraction is for. Real DB interaction lives only in `//go:build integration` tests.
- The gin engine itself: build a real (minimal) router with `gin.New()` + `gin.TestMode`; exercise it with `httptest.NewRequest` + `httptest.NewRecorder`.

### Frontend (TS)

**Framework:** Vitest `vi.mock` / `vi.fn` / `vi.mocked`. No MSW.

**Patterns:**

```typescript
// frontend/src/lib/api-client.test.ts:17-32 — stub fetch + mock dependencies
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

vi.mock('./admin-auth', () => ({
  getAdminSessionToken: vi.fn(() => null),
  ADMIN_SESSION_HEADER: 'X-Aux-Session',
}))
vi.mock('./embedded', () => ({ getEmbeddedContext: vi.fn(() => null) }))

import { apiClient, apiRequest } from './api-client'   // import AFTER mocks
import { getAdminSessionToken } from './admin-auth'
const mockedGetToken = vi.mocked(getAdminSessionToken)  // typed handle for override
```

```typescript
// frontend/src/components/AdminGuard.test.tsx — mock by @/ alias path
vi.mock('@/lib/admin-auth', () => ({
  exchangeSession: (...args: unknown[]) => exchangeSessionMock(...args),
  getAdminSession: () => getAdminSessionMock(),
  clearAdminSession: () => clearAdminSessionMock(),
  ADMIN_SESSION_HEADER: 'X-Aux-Session',
}))
vi.mock('@/telemetry-sdk', () => ({ trackCurrentPageView: () => trackCurrentPageViewMock() }))
```

- **`vi.mock` paths match how the module is imported by the code under test** (relative `./admin-auth` in `api-client.test.ts`; `@/lib/admin-auth` alias in `AdminGuard.test.tsx`). The factory must export the same surface the SUT imports.
- **Import the SUT after the `vi.mock` calls** (module hoisting handles this, but keep source order readable).
- **Reset in `beforeEach`**: `fetchMock.mockReset()`, `mockedGetToken.mockReturnValue(null)` to return to a known default. Use `mockResolvedValueOnce` for per-test success data, `mockRejectedValueOnce` for failures.
- **Pending-promises for "loading" state**: `exchangeSessionMock.mockReturnValue(new Promise(() => {}))` (never resolves) to assert the loading UI (`AdminGuard.test.tsx:81`).
- **`window.location.reload` mock**: jsdom's `location` is not directly assignable; use `Object.defineProperty(window, 'location', { value: { reload: reloadMock }, writable: true })` in `beforeEach` (`AdminGuard.test.tsx:38-44`).
- **Mock child routes/pages** in routing tests so `App.test.tsx` stays focused on route registration, not page internals: each mocked page renders a distinctive heading (`<h1>dashboard-page</h1>`).

**What to Mock:**
- `fetch` (global, via `vi.stubGlobal('fetch', ...)`).
- Modules providing auth context / external calls (`@/lib/admin-auth`, `@/lib/embedded`, `@/lib/telemetry-sdk`, `@/lib/page-registry`, `@/lib/api-client`).
- Heavy child components when testing a container (`App.test.tsx` mocks all pages).

**What NOT to Mock:**
- React Router itself — use the real `<MemoryRouter>` / `<Routes>` / `<Route>`.
- The component under test (obviously) — mock its dependencies, not itself.

## Fixtures and Factories

**Test Data:**

- Backend: inline literals in each test (no shared fixtures directory). Records built directly: `service.PageViewRecord{PageID: "home", VisitorID: "visitor-abc", IsAdmin: false}`. For repeated data across cases, define a local `store := &mockTelemetryStore{pageViews: []PageViewCount{{PageID: "home", Count: 2}, ...}}`.
- Frontend: inline mock payloads, e.g. `mockOverview` in `DashboardPage.test.tsx:25-36`. A `currentPages` array duplicates the registry entries the test wants active (`DashboardPage.test.tsx:12-17`) so tests don't couple to the real registry contents.

**Location:** No `fixtures/` or `__fixtures__/` directories. Keep data local to the test that uses it.

## Coverage

**Requirements:** No enforced coverage threshold detected. The gates are: backend `go test -race` + `golangci-lint`; frontend `tsc --noEmit` + `vitest run` + `vite build` (all in `.github/workflows/ci.yml`).

**View Coverage:**
```bash
# Backend (not configured by default; run ad-hoc)
cd backend && go test -race -cover ./...

# Frontend (not configured by default; vitest supports it)
cd frontend && pnpm exec vitest run --coverage
```

No coverage report is generated in CI today.

## Test Types

**Unit Tests:**
- Backend: service logic (validation, sorting, aggregation) and handler error-mapping, all with in-memory mocks. This is the default `make test` target. ~all `_test.go` files except `ent_integration_test.go`.
- Frontend: pure logic (`page-registry`, `visitor-id`, `theme`, `api-client` header/timeout behavior) and single-component behavior (`AdminGuard` state machine, `DashboardPage` data rendering).

**Integration Tests:**
- Backend: `//go:build integration` files (currently `backend/internal/server/ent_integration_test.go`). Require a real PostgreSQL reachable via `DATABASE_HOST`/`DATABASE_PORT`/`DATABASE_USER`/`DATABASE_DBNAME`/`DATABASE_PASSWORD` env vars. Run with `make test-integration` (`go test -tags=integration -race ./...`).
- **Auto-skip when no DB**: `buildTestDSN(t)` returns `""` when `DATABASE_USER` or `DATABASE_DBNAME` is unset, and the test calls `t.Skip("skipping ent integration test: no DATABASE_DBNAME configured")`. CI does **not** pass `-tags=integration`, so integration tests never run in CI — they're for local/dev verification only.
- Frontend: no separate integration tier; the frontend↔backend contract is asserted via the envelope-shape unit tests + `App.test.tsx` route registration.

**E2E Tests:**
- An `output/playwright` directory exists but no Playwright config or specs are wired into `package.json` scripts or CI. Treat E2E as **not used** for gating purposes.

## Common Patterns

**Async Testing (backend):**

```go
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
client, err := ent.Open("postgres", dsn)
require.NoError(t, err, "ent.Open should succeed with valid DSN")
defer client.Close()
```

**Async Testing (frontend):**

```typescript
// wait for an element to appear after async work
expect(await screen.findByRole('link', { name: '静态内容示例' })).toBeInTheDocument()

// or waitFor a condition
await waitFor(() => {
  expect(screen.getByTestId('location')).toHaveTextContent('/admin/dashboard')
})

// assert a rejection
await expect(apiRequest('/x')).rejects.toThrow(/503/)
```

**Error Testing (backend) — `errors.Is` against sentinels, never strings:**

```go
err := svc.RecordPageView(context.Background(), "", "visitor-abc", false)
require.ErrorIs(t, err, ErrEmptyPageID)
assert.Empty(t, store.pageViews, "校验失败不应入库")
```

**Error Testing (frontend):**

```typescript
vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('Aux API request failed: 503'))
renderPage()
expect(await screen.findByText('数据暂不可用')).toBeInTheDocument()
```

**Route/guard-boundary testing (backend):** assert the HTTP status that proves a route is/isn't behind `AdminGuard` — `401` means guarded+no-session, `400` (binding error) means the route is **outside** the guard and reached the handler, `404` means unregistered. See `router_test.go` comments (`"埋点端点应在守卫外, 缺字段返回 400 而非 401"`).

## Special Consistency Tests

**page-registry ↔ routes consistency (`frontend/src/lib/page-registry.test.ts`):**

- The `PAGE_REGISTRY` array is the single source of truth for page identity (`KTD7`). `page-registry.test.ts` asserts the registry equals an explicit `expectedPages` snapshot (ids, titles, paths, visibility), uniqueness of ids and paths, and the correctness of the `getPageById`/`getPageByPath`/`getPublicPages`/`getAdminPages` helpers.
- `frontend/src/App.test.tsx` complements this by rendering `App` inside `MemoryRouter` and asserting each registered path renders its page (mocked to a distinctive heading) — including the `/admin` → `/admin/dashboard` redirect. Together these two files guard the **routes ↔ registry** contract: adding a page requires (1) a registry entry, (2) an `App.tsx` `<Route>`, (3) the page component — and the tests will fail if any drifts.
- The registry's module doc explicitly documents these three steps (`page-registry.ts:11-15`); honor them when adding a page and update both test files' expectations in the same change.

## CI Integration

`.github/workflows/ci.yml` runs on every push/PR:

- **backend-test**: `go test -race -count=1 ./...` (unit only, no `-tags=integration`). Go version pinned to `go1.26.5` from `backend/go.mod` and verified.
- **backend-lint**: `golangci-lint v2.9` with `--timeout=30m`.
- **frontend**: `pnpm install --frozen-lockfile` → `pnpm run typecheck` → `pnpm run test` → `pnpm run build` (Node 20, pnpm 9).

Integration tests (PostgreSQL) are not part of the default CI; Docker images are built by `deploy-test.yml` or `deploy-production.yml` only after the reusable CI quality gate passes.

---

*Testing analysis: 2026-08-18*
