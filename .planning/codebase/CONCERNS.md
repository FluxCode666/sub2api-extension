# Codebase Concerns

**Analysis Date:** 2026-08-18

## Tech Debt

**Static page-registry is the central friction point for dynamic page management:**
- Issue: Page identity (id/title/path/visibility) is hardcoded in a TypeScript array, not DB-driven. The registry is declared the "single source of truth" (KTD7) for routes, telemetry page-id, and the analytics dashboard page list. Adding a page requires three coordinated edits: (1) append to `PAGE_REGISTRY` in `frontend/src/lib/page-registry.ts`, (2) register a matching `<Route>` in `frontend/src/App.tsx`, (3) implement the page component. There is no admin UI to create/publish/unpublish pages — this is all code-deploy gated. The nav in `frontend/src/layouts/AdminLayout.tsx` is *additionally* hardcoded (it does not even read the registry), so a 4th edit is needed to surface a page in navigation.
- Files: `frontend/src/lib/page-registry.ts:39-76`, `frontend/src/App.tsx:36-57`, `frontend/src/layouts/AdminLayout.tsx:21-28`, `frontend/src/lib/page-registry.test.ts:11-48` (test pins the exact array contents, so any dynamic change must also rewrite this assertion).
- Impact: The planned refactor (generic page-management system with dynamic page creation via HTML/React code, route config, route permissions) cannot be incremental — the registry is referenced by telemetry (`trackFeatureClick`/`trackPageView` resolve page id by path), the dashboard (`DashboardPage` joins backend counts by id), and routing. All of these assume a compile-time-fixed id set.
- Fix approach: Introduce a DB-backed `pages` table (new Ent schema under `backend/ent/schema/`) with fields id/slug/title/path/visibility/route_config/render_kind (static-component vs html-snippet vs react-code)/content/order/visible_in_nav. Replace the static `PAGE_REGISTRY` with a runtime-fetched catalog (with a code-level fallback list for bootstrap/admin pages). Make `AdminLayout` derive nav from the catalog (visibility+nav flags), replacing the hardcoded top-bar links. Move the page-registry test to validate catalog invariants (unique ids/paths) rather than an exact array. For HTML/React-code render kinds, add a sandboxed renderer (see "Missing Critical Features").

**Hardcoded navigation in AdminLayout (top bar, not sidebar):**
- Issue: `AdminLayout` renders a top header with two hand-written `NavLink`s (`/admin/dashboard`, `/admin/homepage`). It does not iterate the registry, does not show the example pages, and is a top bar rather than the sidebar layout the refactor targets. Example pages (`/admin/examples/*`) are reachable by URL but have no nav entry.
- Files: `frontend/src/layouts/AdminLayout.tsx:18-30`
- Impact: Navigation cannot grow without code edits; example pages are effectively hidden. Directly conflicts with the refactor goal (sidebar nav + Dashboard + dynamic pages).
- Fix approach: Rewrite `AdminLayout` to a sidebar shell driven by the (future) page catalog. Iterate admin+nav-visible pages into sidebar links. Keep the top bar only for brand/session controls. This is part of the page-management refactor above.

**Homepage config stored as opaque JSON blob in a generic key-value table:**
- Issue: `HomepageConfig` is serialized to JSON and stored as a single `system_meta` row keyed `homepage.config`. There is no schema, no field-level validation at the DB layer, and a read-modify-write update path (`SaveHomepageConfig` queries then creates-or-updates) that is not atomic. `SystemMeta` was originally a placeholder schema from U1 ("占位 schema, 后续单元可按需保留或移除") and is now load-bearing marketing content storage.
- Files: `backend/internal/service/homepage_config_service.go:190-226` (store), `backend/ent/schema/system_meta.go:20-47` (schema), `backend/internal/service/homepage_config_service.go:108-143` (normalize).
- Impact: Concurrent admin saves can race (last-writer-wins, no optimistic locking). No migration story if the config shape changes — old JSON rows silently fall back to defaults on decode error. The "legacy hero title" migration hack (`legacyHomepageHeroTitle` comparison in `normalizeHomepageConfig`) is a code-level data migration that must live forever.
- Fix approach: Give homepage config its own Ent schema with typed columns, or document `system_meta` as a deliberate KV store and add a `version`/`updated_at` column for optimistic concurrency. Remove the legacy-title hack via a one-time data migration.

**Anonymous telemetry accepts arbitrary page_id/feature_id (no registry validation):**
- Issue: `TelemetryService.RecordPageView`/`RecordFeatureClick` only validate non-empty + max length (128). They do NOT validate that `page_id` exists in the page-registry — by design (KTD7 says backend holds no registry). Any anonymous internet client can POST arbitrary `page_id` strings (e.g. `"foo"`, `"dashboard"`) and pollute the `page_views`/`feature_clicks` tables. The analytics overview then aggregates these, and the dashboard relies on the frontend to filter out unknown ids.
- Files: `backend/internal/service/telemetry_service.go:79-129`, `backend/internal/handler/telemetry_handler.go:62-101`, `backend/internal/service/analytics_service.go:67-132`.
- Impact: Telemetry data integrity depends entirely on frontend good behavior. A malicious or buggy client can inject fake page ids that bloat the tables and skew any future backend-side analytics. The dashboard "filters historical/orphan ids client-side" — this is a mitigation, not a guarantee.
- Fix approach: Either (a) accept this as an inherent tradeoff of anonymous telemetry and document it, or (b) add an optional server-side allowlist of page ids (sourced from the future DB-backed page catalog) that the telemetry handler consults before insert, returning 202/200 regardless (to avoid leaking which ids are valid). Recommended once the page catalog exists.

**Example pages and example handler are scaffolding shipped to production:**
- Issue: Three "example" pages (`ContentExamplePage`, `InteractionExamplePage`, `APIExamplePage`) and a backend `ExampleHandler` (`GET /admin/examples/status` returning a hardcoded status string + server time) exist. These are demo/learning artifacts registered in the production route table and page-registry. They consume nav/registry slots and telemetry ids.
- Files: `frontend/src/pages/examples/*.tsx`, `backend/internal/handler/admin/example_handler.go:27-33`, `backend/internal/server/router.go:183-184`, `frontend/src/lib/page-registry.ts:58-75`.
- Impact: Clutter in the page catalog and dashboard; the refactor's "dynamic page creation" makes these redundant. They will need to be deleted or converted into real pages during the refactor.
- Fix approach: During the refactor, delete the example handler + route, remove the three example pages and their registry entries, and drop the corresponding test files. Convert any genuinely useful pattern (the AbortController race-guard in `APIExamplePage`) into a documented utility or a real page.

## Known Bugs

**AdminGuard only calls `trackCurrentPageView` on the first mount; subsequent in-app navigations within `/admin/*` may double-report or miss:**
- Symptoms: The telemetry SDK hooks `history.pushState`/`replaceState`/`popstate` globally, AND `AdminGuard` explicitly calls `trackCurrentPageView()` after a successful session exchange. The `lastRouteKey` dedup in `handleRouteChange` mitigates duplicates, but the two code paths (guard-driven vs history-hook-driven) are an implicit coupling — any future change to one without the other can cause missed or double page-views.
- Files: `frontend/src/components/AdminGuard.tsx:44-64`, `frontend/src/lib/telemetry-sdk.ts:95-120`, `frontend/src/lib/telemetry-sdk.ts:131-165`.
- Trigger: Admin navigates directly to `/admin/dashboard` (guard fires trackCurrentPageView), then clicks to `/admin/homepage` (history hook fires handleRouteChange). The split ownership is fragile.
- Workaround: None needed today due to `lastRouteKey` dedup, but the coupling is a latent bug.

**AdminGuard `useEffect` has empty dependency array but reads stale closure-safe values — ESLint may warn, and re-exchange is impossible without reload:**
- Symptoms: `AdminGuard`'s `check()` runs once on mount. If the session later expires mid-session, guarded API calls start returning 401, but the guard never re-evaluates — the user stays on the page seeing 401-driven error states with no automatic redirect to `/login`. The only recovery is the manual "重试" button (which reloads the page).
- Files: `frontend/src/components/AdminGuard.tsx:40-70`, `frontend/src/components/AdminGuard.tsx:98-103`.
- Trigger: Session JWT expires (default 24h) while admin is actively using the console.
- Workaround: User clicks "重试" (calls `clearAdminSession` + `window.location.reload`).

## Security Considerations

**iframe token forwarding to sub2api `/auth/me` (SSRF / trust boundary):**
- Risk: `POST /api/aux/admin/session` accepts a `token` from the request body and the backend forwards it as `Authorization: Bearer <token>` to `${SUB2API_BASE_URL}/api/v1/auth/me`. `SUB2API_BASE_URL` is operator-configured. If an attacker can influence `SUB2API_BASE_URL` (env var injection), the aux backend becomes an open proxy / SSRF vector. Additionally, the sub2api token transits through the aux backend (logged?).
- Files: `backend/internal/integration/sub2api_client.go:63-113`, `backend/internal/handler/auth_handler.go:64-101`, `backend/internal/config/config.go:66-69`.
- Current mitigation: `SUB2API_BASE_URL` is a required, validated config value loaded at startup (not request-controllable). The sub2api client has a 10s timeout. Token is only forwarded, not logged (gin.Logger logs method/path/status, not headers/body — but confirm `gin.Logger` does not log the request body; it does not by default). The forwarded token is the caller-supplied value, so no aux-system secret leaks upstream.
- Recommendations: (1) Pin `SUB2API_BASE_URL` to an allowlist scheme (http/https) and reject localhost/link-local unless in debug mode. (2) Explicitly assert in tests that the request body is never logged. (3) Consider TLS verification config for the sub2api client (currently uses default `http.Client` with no explicit TLS config — acceptable for same-network Docker, risky for public-URL sub2api).

**Anonymous telemetry write path (rate-limited, 4KB cap) — acceptable but unbounded storage growth:**
- Risk: `/api/aux/telemetry/page-view` and `/feature-click` are anonymous-writable (no auth). Defenses: 4KB body cap (`maxTelemetryBodyBytes`), per-IP token bucket (5 req/s, burst 10). However: (a) the per-IP limiter map (`telemetryLimiter.buckets`) has no eviction — grows unboundedly with distinct IPs (the code comment acknowledges this: "长期运行若 IP 极多可改用 LRU; 当前 MVP 规模无需"). (b) There is no global cap, no per-visitor-id cap, and no retention/TTL on the `page_views`/`feature_clicks` tables — they grow forever.
- Files: `backend/internal/server/middleware/telemetry_guard.go:22-101`, `backend/ent/schema/page_view.go` (no retention column).
- Current mitigation: Per-IP rate limit + body cap mitigate flooding from a single IP. IP spoofing via `X-Forwarded-For` is partially handled (first segment taken), but a client can rotate the XFF header to get fresh buckets.
- Recommendations: (1) Add an LRU/TTL eviction to `telemetryLimiter.buckets` or cap its size. (2) Trust `X-Forwarded-For` only behind a known proxy (gin's `TrustedPlatform`/`TrustedProxies` is not configured — `gin.New()` defaults to trusting all proxies for `c.ClientIP()`, but this code uses its own `clientIP()` reading the header directly, so proxy trust is NOT enforced). (3) Add a retention policy / partitioning for telemetry tables (e.g., drop rows older than N days) before volume becomes a problem. (4) Consider a global write cap (total req/min) in addition to per-IP.

**JWT secret handling — HS256 shared secret, no key rotation:**
- Risk: The aux admin session JWT is signed with a single HS256 shared secret (`JWT_SECRET`). If leaked, an attacker can forge admin sessions valid for `JWT_EXPIRE_HOUR` (default 24h). There is no key rotation mechanism, no `kid` header, no keyring. The secret is read once at startup from config/env.
- Files: `backend/internal/service/auth_service.go:200-244`, `backend/internal/config/config.go:71-75`, `backend/internal/server/middleware/admin_guard.go:34-53`.
- Current mitigation: Secret is required (validate fails if empty); dev default is `dev-secret-not-for-production` (clearly marked, not for prod). JWT lib validates the signing method (`SigningMethodHMAC`) preventing alg-confusion. Claims include `exp`/`iat`/`iss`/`sub`.
- Recommendations: (1) Document the rotation procedure (currently: change env var + restart = all sessions invalidated). (2) Consider supporting a keyring (current + previous secret) for zero-downtime rotation. (3) Ensure `JWT_SECRET` is injected via Docker secret / secret manager, not baked into images (it is not — good). (4) The verification cache (`AuthService.cache`) keyed by sub2api token hash caches the *negative* (non-admin) result for `cacheTTL` (5 min) — a user promoted to admin within 5 min of a failed check stays blocked; document this.

**AdminGuard / LoginPage store session in localStorage (XSS-exfiltratable):**
- Risk: The aux admin session JWT is persisted to `localStorage` under key `aux_admin_session`. Any XSS in the SPA (including in admin-authored page content after the refactor) can exfiltrate the token. localStorage is readable across all JS in the origin.
- Files: `frontend/src/lib/admin-auth.ts:238-251`, `frontend/src/lib/admin-auth.ts:312-332`.
- Current mitigation: Token is validated (JWT exp + HS256 alg + role=admin) before use; invalid/expired entries are cleared. The homepage config renderer sanitizes URLs server-side (`safeHref`/`safeAssetURL` reject non-http(s)/non-fragment schemes) and React escapes text content, so the current homepage content has no obvious XSS sink. But the refactor's "HTML/React code" page content will introduce a major XSS surface.
- Recommendations: (1) For the refactor, render admin-authored HTML in a sandboxed iframe with `sandbox` attr or a strict CSP, never via `dangerouslySetInnerHTML` in the main origin. (2) Evaluate `HttpOnly` cookie session storage instead of localStorage (would require CSRF protection — currently N/A because auth is header-based). (3) Add a strict CSP (`script-src 'self'`) to the SPA.

**Homepage config: admin-provided URLs rendered as `href`/`img src` (open-redirect / limited XSS):**
- Risk: `HomepageConfig` fields (`primaryHref`, `docsHref`, `consoleHref`, partner `logoUrl`/`linkUrl`) are admin-set and rendered as `<a href>` and `<img src>`. Backend `safeHref` allows `#`-prefixed, `/`-prefixed, and http/https URLs; `safeAssetURL` allows only http/https with a host. So `javascript:` URLs are blocked, but `https://evil.com` is allowed (open redirect on CTA clicks — low severity since admin-authored).
- Files: `backend/internal/service/homepage_config_service.go:156-181`, `frontend/src/pages/HomePage.tsx:694-700`.
- Current mitigation: Scheme allowlist blocks `javascript:`/`data:`. React does not inject raw HTML. Partner logos use `<img src>` with an `onError` that hides the image.
- Recommendations: Acceptable for admin-only authoring. When non-admins can contribute content (future), tighten to a domain allowlist.

## Performance Bottlenecks

**Analytics overview scans full tables with no time bound:**
- Problem: `CountPageViewsByPageID` and `CountFeatureClicksByFeature` run `GroupBy + Count()` over the *entire* `page_views` / `feature_clicks` tables on every dashboard load. As telemetry accumulates (append-only, no retention), these aggregations scan increasingly large datasets.
- Files: `backend/internal/service/analytics_store.go:58-103`, `backend/ent/schema/page_view.go:69-77` (indexes exist on page_id, created_at, and composite page_id+created_at, but the GroupBy-on-all-rows query cannot exploit them to bound the scan).
- Cause: No `WHERE created_at > <window>` filter; the dashboard shows all-time totals. Two such queries run concurrently per overview request.
- Improvement path: (1) Add a default time window (e.g., last 30/90 days) to the overview query, with optional `range` param. (2) Materialize daily/rollup counts in a `page_view_daily` table (incremented on insert) for O(pages) dashboard reads. (3) Add pagination/limit to feature-click results (currently returns all distinct page_id+feature_id pairs sorted — unbounded).

**Verification cache is a plain map with no size bound:**
- Problem: `AuthService.cache` (sub2api token verification results) is a `map[string]cachedVerification` keyed by token SHA-256 hash, with TTL-based staleness but no eviction of expired entries and no size cap. Entries are deleted only when re-queried after expiry.
- Files: `backend/internal/service/auth_service.go:115-161`, `backend/internal/service/auth_service.go:54-65`.
- Cause: No background sweeper; expired entries linger until probed.
- Improvement path: Add a periodic sweeper goroutine or an LRU cap. Low priority at MVP admin-traffic scale.

## Fragile Areas

**Ent generated code is a build product — schema changes require regen:**
- Files: `backend/ent/` (entire directory, generated), `backend/ent/schema/*.go` (3 schemas: page_view, feature_click, system_meta), `backend/ent/generate.go:13` (`go:generate go run -mod=mod entgo.io/ent/cmd/ent generate ./schema`).
- Why fragile: Editing `ent/schema/*.go` without running `go generate ./ent` leaves the generated client out of sync — code compiles against stale types, runtime errors or missing methods appear. The generated code is committed to git (no codegen-in-CI observed in the explored files), so a contributor can accidentally commit half-regenerated state. The `SystemMeta` schema comment still says "占位 schema" (placeholder) even though it is now used for homepage config.
- Safe modification: Always run `go generate ./ent` (or `make` equivalent) from `backend/` after any `ent/schema/*.go` change, then run `make migrate` against a dev DB. Verify `backend/ent/` diffs are coherent before committing.
- Test coverage: Integration tests in `backend/internal/server/ent_integration_test.go` exercise the ent client but require a live PostgreSQL (auto-skip without `DATABASE_HOST`).

**page-registry ↔ App.tsx ↔ page-registry.test.ts three-way coupling:**
- Files: `frontend/src/lib/page-registry.ts:39-76`, `frontend/src/App.tsx:36-57`, `frontend/src/lib/page-registry.test.ts:11-48`.
- Why fragile: The test asserts `PAGE_REGISTRY` equals an exact hardcoded array. The registry header comment claims "与 App.tsx 已注册路由一一对应" (one-to-one with App.tsx routes), but nothing enforces this — adding a registry entry without an App.tsx route (or vice versa) silently breaks telemetry (orphan page ids) or routing (untracked pages). The test only checks the registry array, not its consistency with App.tsx.
- Safe modification: When adding/removing a page, edit all three files in lockstep. Add a test that asserts every registry `path` has a corresponding `<Route>` in App.tsx (currently missing).
- Test coverage gaps: No test asserts registry↔App.tsx route consistency.

**telemetry-sdk monkeypatches `history.pushState`/`replaceState` globally:**
- Files: `frontend/src/lib/telemetry-sdk.ts:141-165`.
- Why fragile: `initTelemetry` replaces `history.pushState`/`replaceState` with wrappers for the lifetime of the page. If `resetTelemetry` is not called (test isolation leak) or a third-party lib also patches history, the chain can corrupt. `lastRouteKey` dedup is module-level state shared across the app.
- Safe modification: Avoid calling `initTelemetry` more than once (guarded by `initialized` flag). In tests, always pair with `resetTelemetry`.
- Test coverage: `telemetry-sdk.test.ts` exists and exercises reset.

## Scaling Limits

**Telemetry tables (append-only, no retention):**
- Current capacity: PostgreSQL with indexes on page_id/visitor_id/created_at. Fine for thousands–millions of rows.
- Limit: No retention policy. Every page view = one row forever. At sustained write volume (e.g., 100 req/s sustained across all IPs, bounded only by per-IP limiter), the tables grow ~8.6M rows/day, degrading the full-scan analytics queries (see Performance) within weeks.
- Scaling path: Add time-based retention (partition by `created_at` month, drop old partitions), or a rollup table for dashboard aggregates. Raise the global write ceiling only after adding retention.

**Per-IP rate limiter map (unbounded distinct IPs):**
- Current capacity: A `map[string]*rate.Limiter` with lazy creation, no eviction.
- Limit: Under a distributed flood from many spoofed XFF values (XFF is trusted without proxy validation), the map grows without bound → memory exhaustion. Acknowledged in code comment.
- Scaling path: Cap map size + LRU eviction; validate XFF only against trusted proxies (gin `TrustedProxies`).

## Dependencies at Risk

**`github.com/lib/pq` (Postgres driver) is in maintenance mode:**
- Risk: `lib/pq` v1.12.3 is used as the database driver (imported in `main.go` and via ent's postgres dialect). The project officially recommends `pgx` for new code; `lib/pq` receives only critical fixes.
- Impact: No new features (e.g., advanced pgx features, better prepared-statement handling). Ent supports `pgx` natively.
- Migration plan: Switch ent's dialect driver from `lib/pq` to `github.com/jackc/pgx/v5` (entsql `OpenDB` with a pgx stdlib pool). Low urgency; do alongside any connection-pool tuning.

**React 18 + react-router-dom 6 (pre-React-19 / pre-router-7):**
- Risk: `react@^18.3.1`, `react-router-dom@^6.26.0`. React 19 and React Router 7 are current. The refactor (sidebar nav, dynamic page rendering, shadcn/ui) will add component complexity.
- Impact: shadcn/ui works on React 18/19; fine. But the planned GSAP + shadcn/ui additions should target a known-compatible React version. Staying on 18 is safe short-term.
- Migration plan: Optional upgrade to React 19 + Router 7 during or after the refactor; not blocking.

## Missing Critical Features

**No dynamic page creation / render system (the refactor target):**
- Problem: There is no mechanism for an admin to create a page at runtime (HTML snippet or React code), configure its route, or set route permissions. All pages are compile-time React components. The refactor goal ("convert to a generic page-management system with sidebar nav, Dashboard, dynamic page creation (HTML/React code), route config, route permissions") requires building this from scratch.
- Blocks: The entire dynamic-page-management refactor. Specifically: a `pages` table, an admin UI for page CRUD, a route-registration layer that reads the catalog at runtime, a permission model finer than `public|admin`, and a sandboxed content renderer (HTML/React). None of these exist.
- Files to change: new `backend/ent/schema/page.go`; new handler/service under `backend/internal/handler/admin/` and `backend/internal/service/`; `frontend/src/App.tsx` (dynamic route registration); `frontend/src/layouts/AdminLayout.tsx` (sidebar from catalog); new `frontend/src/pages/admin/PageManagementPage.tsx`; new sandboxed renderer component.

**GSAP and shadcn/ui not yet installed:**
- Problem: The refactor pre-requirement is to install GSAP and shadcn/ui. Neither is in `frontend/package.json` dependencies. Tailwind CSS v3.4 is present (shadcn/ui dependency). No `components.json` (shadcn config) exists.
- Blocks: Any UI work in the refactor that uses shadcn primitives or GSAP animations.
- Files: `frontend/package.json:14-34` (deps), `frontend/` (no `components.json`).
- Pre-install steps: `pnpm add gsap`; `pnpm dlx shadcn@latest init` (will generate `components.json`, `lib/utils.ts`, CSS variables in `index.css`); verify Tailwind v3 (not v4) compatibility with the chosen shadcn version.

**No route-level permission model beyond public/admin binary:**
- Problem: `PageVisibility` is `'public' | 'admin'` only. The refactor wants "route permissions" (presumably per-page role or per-route access control). The current `AdminGuard` is an all-or-nothing admin gate at the `/admin` boundary; individual admin routes have no further permission checks.
- Blocks: Fine-grained page access control in the refactor.
- Files: `frontend/src/lib/page-registry.ts:18-19`, `frontend/src/components/AdminGuard.tsx`, `backend/internal/server/middleware/admin_guard.go`.

**No sidebar layout / dashboard-as-home:**
- Problem: The refactor wants a sidebar nav with Dashboard as the landing page. Currently `AdminLayout` is a top bar; `/admin` redirects to `/admin/dashboard` (so Dashboard is already the index — good), but the shell is a top bar with only 2 links.
- Blocks: The sidebar-nav visual refactor.
- Files: `frontend/src/layouts/AdminLayout.tsx`, `frontend/src/App.tsx:47-48` (index redirect already correct).

## Test Coverage Gaps

**No test asserts page-registry ↔ App.tsx route consistency:**
- What's not tested: That every `path` in `PAGE_REGISTRY` has a matching `<Route>` in `App.tsx`, and vice versa. The registry test only checks the array contents.
- Files: `frontend/src/lib/page-registry.test.ts`, `frontend/src/App.tsx`.
- Risk: A registry entry without a route (or a route without a registry entry) silently breaks telemetry tracking or routing. High likelihood during the refactor.
- Priority: High (add before/during the refactor).

**Telemetry page_id allowlist not enforced (and not tested as a guarantee):**
- What's not tested: Behavior under arbitrary/malicious page_id injection is not asserted as a contract (it's implicitly "anything goes").
- Files: `backend/internal/handler/telemetry_handler_test.go`, `backend/internal/service/telemetry_service_test.go`.
- Risk: Future tightening (allowlist) may break existing tests that assume arbitrary ids are accepted.
- Priority: Low until the page catalog exists.

**AdminGuard session-expiry-mid-session behavior untested:**
- What's not tested: What happens when a valid session expires while the admin is on a guarded page (no automatic re-exchange or redirect). Only the initial exchange is tested.
- Files: `frontend/src/components/AdminGuard.test.tsx`.
- Risk: Latent UX bug (stale session → 401 errors with no redirect).
- Priority: Medium.

**XFF trust / proxy configuration not tested:**
- What's not tested: The `clientIP()` function trusts the first `X-Forwarded-For` segment unconditionally; no test asserts behavior behind/no-behind a trusted proxy. gin's `TrustedProxies` is not configured.
- Files: `backend/internal/server/middleware/telemetry_guard.go:64-78`, `backend/internal/server/router.go:38-40` (`gin.New()` without `SetTrustedProxies`).
- Risk: Rate-limit bypass via XFF spoofing in non-proxied deployments.
- Priority: Medium (matters once deployed behind a real proxy; document the expected deployment topology).

---

*Concerns audit: 2026-08-18*
