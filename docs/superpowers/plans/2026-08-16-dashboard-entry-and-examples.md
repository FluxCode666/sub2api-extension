# Dashboard Entry And Example Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redirect the application root to the authenticated dashboard, add three navigable example pages, hide telemetry from removed pages, and expose a guarded aux status example API.

**Architecture:** React Router remains the source of navigation behavior while `PAGE_REGISTRY` remains the source of analytics page identity. Dashboard rendering intersects backend telemetry with the current registry, so deleted page IDs stay in storage but disappear from current UI totals. A dependency-free Gin admin handler provides the authenticated API example response.

**Tech Stack:** React 18, React Router 6, TypeScript 5.6, Vitest, Testing Library, Go, Gin, Testify.

---

### Task 1: Root Redirect And Current Page Registry

**Files:**
- Create: `frontend/src/App.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/lib/page-registry.ts`
- Modify: `frontend/src/lib/page-registry.test.ts`
- Delete: `frontend/src/pages/HomePage.tsx`

- [x] **Step 1: Write failing route and registry tests**

Add an application test that renders `App` in a `MemoryRouter` at `/`, replaces `AdminGuard` with a pass-through test double, and asserts both the dashboard marker and `useLocation().pathname === '/admin/dashboard'`. Update registry expectations to exactly these entries:

```ts
[
  { id: 'dashboard', path: '/admin/dashboard', visibility: 'admin' },
  { id: 'example-content', path: '/admin/examples/content', visibility: 'admin' },
  { id: 'example-interaction', path: '/admin/examples/interaction', visibility: 'admin' },
  { id: 'example-api', path: '/admin/examples/api', visibility: 'admin' },
]
```

Assert `getPageByPath('/')` is undefined and `getPublicPages()` is empty.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
cd frontend
pnpm test --run src/App.test.tsx src/lib/page-registry.test.ts
```

Expected: FAIL because `/` still renders `HomePage` and the registry still contains `home`.

- [x] **Step 3: Implement the root redirect and registry**

Import `Navigate` in `App.tsx`, replace the root element with:

```tsx
<Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
```

Register all three example routes under `/admin`, remove the `HomePage` import, delete `HomePage.tsx`, and replace `PAGE_REGISTRY` with the four current admin pages.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the same focused test command. Expected: PASS.

### Task 2: Dashboard Links And Current-Page-Only Analytics

**Files:**
- Modify: `frontend/src/pages/admin/DashboardPage.tsx`
- Modify: `frontend/src/pages/admin/DashboardPage.test.tsx`

- [x] **Step 1: Write failing dashboard tests**

Make the registry mock return the four current pages. Return backend page views and feature clicks that also include `home` and `sample-dynamic`. Assert:

- Dashboard renders links whose `href` values match all four current routes.
- `home`, `sample-dynamic`, `未知页面`, `孤儿`, and `(孤儿)` are absent.
- Current visit totals exclude deleted IDs.
- Current feature totals and the feature table exclude deleted IDs.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd frontend
pnpm test --run src/pages/admin/DashboardPage.test.tsx
```

Expected: FAIL because the current component appends orphan rows and renders non-current feature groups.

- [x] **Step 3: Implement registry intersection and links**

Import `Link`. Build rows only from registry entries, filter `feature_clicks` with the registry ID set, remove `isOrphan` and all orphan UI, and render title/path as links. Replace the orphan summary card with:

```tsx
<SummaryCard label="功能点击" value={totalFeatureClicks} />
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run the same dashboard test command. Expected: PASS.

### Task 3: Static And Interaction Example Pages

**Files:**
- Create: `frontend/src/pages/examples/ContentExamplePage.tsx`
- Create: `frontend/src/pages/examples/ContentExamplePage.test.tsx`
- Create: `frontend/src/pages/examples/InteractionExamplePage.tsx`
- Create: `frontend/src/pages/examples/InteractionExamplePage.test.tsx`

- [x] **Step 1: Write failing page tests**

For the static page, assert its heading, structured status list, and metadata are visible. For the interaction page, mock `trackFeatureClick`, click increment, decrement, and reset controls, assert the counter updates, and assert these calls:

```ts
trackFeatureClick('example-interaction', 'increment-counter')
trackFeatureClick('example-interaction', 'decrement-counter')
trackFeatureClick('example-interaction', 'reset-counter')
```

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
cd frontend
pnpm test --run src/pages/examples/ContentExamplePage.test.tsx src/pages/examples/InteractionExamplePage.test.tsx
```

Expected: FAIL because the page modules do not exist.

- [x] **Step 3: Implement both pages**

Create a static content page with a concise heading, operating-status list, and metadata definition list. Create the interaction page with a local integer counter and accessible increment, decrement, and reset buttons. Every user action updates local state and emits its stable telemetry feature ID.

- [x] **Step 4: Run tests and verify GREEN**

Run the same page test command. Expected: PASS.

### Task 4: Guarded Status API

**Files:**
- Create: `backend/internal/handler/admin/example_handler.go`
- Create: `backend/internal/handler/admin/example_handler_test.go`
- Modify: `backend/internal/server/router.go`
- Modify: `backend/internal/server/router_test.go`

- [x] **Step 1: Write failing handler and router tests**

Add a handler test that asserts HTTP 200 and this data contract:

```go
struct {
    Service    string `json:"service"`
    Status     string `json:"status"`
    ServerTime string `json:"server_time"`
}
```

Assert `service == "sub2api-extension"`, `status == "ok"`, and `server_time` parses with `time.RFC3339`. Add router tests proving `/api/aux/admin/examples/status` returns 401 without `X-Aux-Session` and 200 with a valid aux session.

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
cd backend
go test -race -count=1 ./internal/handler/admin ./internal/server -run 'Example|ExamplesStatus'
```

Expected: FAIL because the handler and route do not exist.

- [x] **Step 3: Implement the status handler and guarded route**

Create `ExampleHandler.GetStatus` returning:

```go
response.Success(c, ExampleStatusResponse{
    Service:    "sub2api-extension",
    Status:     "ok",
    ServerTime: time.Now().UTC().Format(time.RFC3339),
})
```

Instantiate the dependency-free handler during route registration and register `GET /examples/status` inside the existing guarded admin group.

- [x] **Step 4: Run tests and verify GREEN**

Run the same backend focused test command. Expected: PASS.

### Task 5: API Example Page

**Files:**
- Create: `frontend/src/pages/examples/APIExamplePage.tsx`
- Create: `frontend/src/pages/examples/APIExamplePage.test.tsx`
- Modify: `frontend/src/App.tsx`

- [x] **Step 1: Write failing API page tests**

Mock `apiClient.get` and `trackFeatureClick`. Cover initial loading, successful service/status/time rendering, refresh success, request failure, and retry. Assert user refresh/retry calls:

```ts
trackFeatureClick('example-api', 'refresh-status')
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd frontend
pnpm test --run src/pages/examples/APIExamplePage.test.tsx
```

Expected: FAIL because the page module does not exist.

- [x] **Step 3: Implement the API page and route**

Use `apiClient.get<AuxEnvelope<ExampleStatus>>('/admin/examples/status')`. Render deterministic loading, success, and error/retry states. Register the page at `examples/api` under the guarded `/admin` route.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the same API page test command. Expected: PASS.

### Task 6: Full Verification, Runtime Smoke, Review, And Commit

**Files:**
- Modify: `docs/superpowers/specs/2026-08-16-root-dashboard-redirect-design.md`
- Create: `docs/superpowers/plans/2026-08-16-dashboard-entry-and-examples.md`

- [x] **Step 1: Run all automated gates**

```bash
cd backend
make test-unit
make vet
make build
cd ../frontend
pnpm test --run
pnpm typecheck
pnpm build
```

Expected: all commands pass.

- [x] **Step 2: Restart the local backend and verify HTTP behavior**

Verify `/health` is 200, the status endpoint is 401 without a session and 200 with a valid admin session, and the removed sub2api stats endpoint remains 404.

- [x] **Step 3: Run browser smoke checks**

Open `http://127.0.0.1:3100/`, verify root navigation reaches `/admin/dashboard` or `/login` according to session state, authenticate if needed, click every dashboard page link, exercise the interaction controls, refresh the API example, and confirm no console errors or overlapping content.

- [x] **Step 4: Independent review**

Review the diff for auth bypass, stale removed-page references, telemetry IDs, route/registry mismatch, accessibility, and test gaps. Fix any findings and rerun affected gates.

- [x] **Step 5: Commit only task-owned files**

Do not stage `deploy/.env.example` or `.pi/`. Commit with:

```bash
git commit -m "feat: add dashboard example pages"
```
