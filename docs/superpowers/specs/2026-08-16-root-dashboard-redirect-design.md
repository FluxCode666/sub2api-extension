# Root Dashboard Redirect

## Goal

Visiting the aux-system root path (`/`) must immediately navigate to the existing analytics dashboard at `/admin/dashboard`.

## Behavior

- `/` redirects to `/admin/dashboard` with history replacement.
- `/admin/dashboard` remains protected by the existing `AdminGuard`.
- An authenticated administrator sees the dashboard.
- An unauthenticated visitor continues through `AdminGuard` and is redirected to `/login`.
- `/login` remains publicly reachable.
- The root redirect is not tracked as a content page.

## Implementation

- Replace the root `HomePage` route with React Router's `<Navigate to="/admin/dashboard" replace />`.
- Remove the now-unreachable `HomePage` component and import.
- Remove the obsolete `home` entry from `PAGE_REGISTRY`; the dashboard remains the only registered analytics page.
- Keep both `/admin` and `/admin/dashboard` dashboard routes for compatibility.

## Verification

- Add an application routing test that starts at `/` and observes navigation to `/admin/dashboard`.
- Update page-registry tests to assert that `/` is not a registered analytics page.
- Run the focused routing and registry tests, the complete frontend test suite, TypeScript type checking, and the production build.
- Verify the running application redirects `/` to `/admin/dashboard`, then applies the existing authentication behavior.
