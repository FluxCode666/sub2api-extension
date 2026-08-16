# Dashboard Entry And Example Pages

## Goal

Make the aux-system dashboard the default entry point and provide three real, navigable example pages that demonstrate content, client interaction telemetry, and an authenticated aux API request.

## Routes And Authentication

- `/` redirects to `/admin/dashboard` with history replacement.
- `/admin/dashboard` remains protected by the existing `AdminGuard`.
- An authenticated administrator sees the dashboard.
- An unauthenticated visitor continues through `AdminGuard` and is redirected to `/login`.
- `/login` remains publicly reachable.
- The following example routes share `AdminGuard` and `AdminLayout`:
  - `/admin/examples/content`
  - `/admin/examples/interaction`
  - `/admin/examples/api`
- `/admin` continues to render the dashboard for compatibility.

## Page Registry And Analytics

`PAGE_REGISTRY` contains only the current dashboard and the three example pages. The former public `home` entry and deleted `sample-dynamic` entry are not restored.

The dashboard joins backend telemetry counts to the current registry. Page-view and feature-click groups whose `page_id` is absent from the registry are retained in PostgreSQL but are not shown and do not contribute to current dashboard totals. This hides historical `home` and `sample-dynamic` data without destructive database changes.

Each current page row shows a title and path that both link to its registered route. The dashboard summary shows current page count, current-page visit count, and current-page feature-click count.

## Example Pages

### Static Content

The static content page demonstrates a readable admin content layout with a heading, explanatory copy, a short status list, and structured metadata. It has no API dependency and no feature-click controls.

### Interaction And Telemetry

The interaction page contains a local counter with increment, decrement, and reset controls. Each action updates the local UI and calls `trackFeatureClick` with page ID `example-interaction` and a stable feature ID. These actions appear in the dashboard feature-usage table after refresh.

### Authenticated API

The API example page requests `GET /api/aux/admin/examples/status` through the existing `apiClient`. It renders loading, success, and error states and provides a refresh/retry action. User-initiated refreshes call `trackFeatureClick` with page ID `example-api`.

The new endpoint is inside the guarded admin route group and returns the standard aux envelope:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "service": "aux-system",
    "status": "ok",
    "server_time": "2026-08-16T12:00:00Z"
  }
}
```

It does not call sub2api and does not require an Admin API Key.

## Removed Code

- Replace the root `HomePage` route with `<Navigate to="/admin/dashboard" replace />`.
- Delete the now-unreachable `HomePage` component.
- Remove orphan-page rows, badges, placeholder paths, summary, and explanatory copy from the dashboard.

## Verification

- Route test proves `/` resolves to `/admin/dashboard`.
- Registry tests prove only current dashboard and example routes are registered.
- Dashboard tests prove links work and removed page IDs are absent from rows and totals.
- Interaction tests prove controls update state and emit the expected feature IDs.
- API page tests cover loading, success, refresh, and failure/retry states.
- Backend handler and router tests cover the response contract and admin guard.
- Run complete backend tests with the race detector, `go vet`, and build.
- Run complete frontend tests, TypeScript type checking, and production build.
- Verify the running app and endpoint behavior with real HTTP and browser smoke checks.
