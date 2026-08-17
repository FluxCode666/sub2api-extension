# Architecture Research

**Domain:** Dynamic page management subsystem integrated into existing aux-system (Go+Ent backend, React frontend)
**Researched:** 2026-08-18
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌──────────────────────── frontend (React SPA) ────────────────────────┐
│  main.tsx → App.tsx (router root)                                     │
│   ├─ static core routes (/, /login, /admin/dashboard, /admin/homepage)│
│   ├─ /p/:slug          (public dynamic page)  ─┐                      │
│   └─ /admin/p/:slug    (admin dynamic page)    │                      │
│                                                ▼                      │
│  ┌─────────────── merged page-registry ───────────────┐              │
│  │ static core pages (code)  +  dynamic pages (DB)     │              │
│  │ → drives sidebar menu, telemetry page_id, dashboard │              │
│  └─────────────────────────────────────────────────────┘              │
│  ┌─── AdminLayout (sidebar shadcn) ───┐  ┌── SandboxPageRenderer ──┐ │
│  │ sidebar items from merged registry  │  │ <iframe srcdoc sandbox> │ │
│  └─────────────────────────────────────┘  └──────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
         │ /api/aux/admin/pages (CRUD)         │ /api/aux/pages/:slug (fetch)
         ▼ (AdminGuard: X-Aux-Session)         ▼ (public fetch)
┌──────────────────────── backend (Go + Gin + Ent) ─────────────────────┐
│  server/router → handler/admin/pages → service/page → ent.Page        │
│  server/router → handler/pages (public)    → service/page → ent.Page  │
│  middleware: AdminGuard (admin CRUD) | TelemetryGuard (public write)  │
└───────────────────────────────────────────────────────────────────────┘
         │
         ▼
   PostgreSQL
   pages (NEW)  ←─ page_id ──→  page_views / feature_clicks (existing)
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `ent/schema/page.go` (NEW) | Page entity schema | Ent schema: id/slug/title/visibility/content_type/content_html/content_react/enabled/timestamps |
| `service/page` (NEW) | Page business logic | CRUD + slug uniqueness + visibility filter; Store interface for testing |
| `handler/admin/pages` (NEW) | Admin page CRUD HTTP handlers | Under `/api/aux/admin/pages`, AdminGuard; standard envelope |
| `handler/pages` (NEW) | Public page fetch handler | `GET /api/aux/pages/:slug` returns enabled public page content |
| `lib/page-registry.ts` (CHANGED) | Merged registry: static core + dynamic | Fetch dynamic pages at bootstrap, merge with static PAGE_REGISTRY into unified readonly list |
| `lib/dynamic-routes.tsx` (NEW) | Runtime route registration | Build `/p/:slug` + `/admin/p/:slug` route elements from merged registry |
| `components/SandboxRenderer.tsx` (NEW) | iframe sandbox renderer | `<iframe srcdoc sandbox csp>` for user HTML content |
| `layouts/AdminLayout.tsx` (CHANGED) | Sidebar layout (replaces top nav) | shadcn Sidebar; items from merged registry |
| `pages/admin/PageManagementPage.tsx` (NEW) | Page CRUD UI | shadcn Table/Form/Dialog + Monaco editor |
| `pages/DynamicPage.tsx` (NEW) | Dynamic page host component | Fetches page by slug, renders via SandboxRenderer |

## Recommended Project Structure

```
backend/
├── ent/schema/
│   └── page.go                 # NEW — Page entity schema
├── internal/
│   ├── service/
│   │   └── page.go             # NEW — page service + Store interface
│   ├── handler/
│   │   ├── admin/
│   │   │   └── pages.go        # NEW — admin CRUD handlers
│   │   └── pages.go            # NEW — public fetch handler
│   └── server/
│       └── router.go           # CHANGED — register new routes
frontend/src/
├── components/
│   ├── ui/                     # NEW — shadcn components (generated)
│   ├── SandboxRenderer.tsx     # NEW — iframe sandbox
│   └── Sidebar.tsx             # NEW — shadcn sidebar wrapper
├── layouts/
│   └── AdminLayout.tsx         # CHANGED — top nav → sidebar
├── lib/
│   ├── utils.ts                # NEW — cn() util for shadcn
│   ├── page-registry.ts        # CHANGED — static core + merge fn
│   └── dynamic-pages.ts        # NEW — fetch + merge dynamic pages
├── pages/
│   ├── admin/
│   │   └── PageManagementPage.tsx  # NEW — CRUD UI
│   ├── DynamicPage.tsx         # NEW — public dynamic page host (/p/:slug)
│   └── AdminDynamicPage.tsx    # NEW — admin dynamic page host (/admin/p/:slug)
└── App.tsx                     # CHANGED — register dynamic routes
```

### Structure Rationale

- **`ent/schema/page.go`:** schema is the source — `go generate ./ent` produces the client. Mirror existing schema style (entsql table annotation, Chinese comments).
- **`service/page`:** business logic + Store interface seam for testing (mirrors existing auth/telemetry service pattern from CONVENTIONS.md).
- **`handler/admin/pages` vs `handler/pages`:** split by guard boundary — admin CRUD needs AdminGuard, public fetch is open (rate-limited via TelemetryGuard). Mirrors existing handler/admin + handler split.
- **`components/ui/`:** shadcn convention — generated components live here, owned by the project (not node_modules).
- **`lib/dynamic-pages.ts` + `page-registry.ts`:** keep static PAGE_REGISTRY as the immutable core; dynamic-pages.ts fetches DB pages; a merge function produces the unified registry. Static page IDs stay stable; dynamic page IDs use `page:<slug>` to avoid collision.

## Architectural Patterns

### Pattern 1: Merged Registry (Static Core + Dynamic)

**What:** Static core pages (home, dashboard, homepage-config) stay in code; dynamic pages come from DB; a merge function produces a unified readonly registry at bootstrap.
**When to use:** When you have immutable system pages + user-created pages sharing one identity namespace.
**Trade-offs:** Slightly more complex than pure-DB, but preserves stability of core pages and existing telemetry continuity.

```typescript
// lib/page-registry.ts (changed)
export const STATIC_PAGE_REGISTRY: readonly PageEntry[] = [ /* home, dashboard, homepage-config */ ]
// dynamic-pages.ts fetches /api/aux/pages and maps to PageEntry[]
export async function getMergedRegistry(): Promise<readonly PageEntry[]> {
  const dynamic = await fetchDynamicPages()
  return [...STATIC_PAGE_REGISTRY, ...dynamic]
}
// dynamic page id = `page:<slug>` to avoid collision with static ids
```

### Pattern 2: iframe Sandbox Rendering

**What:** User HTML content rendered in `<iframe srcdoc={content} sandbox="allow-scripts">` with a strict CSP header.
**When to use:** Whenever rendering user-supplied HTML/JS.
**Trade-offs:** Isolated DOM (user content can't reach parent app); `postMessage` for telemetry hooks; no shared React context.

```typescript
<iframe
  srcdoc={pageContent}
  sandbox="allow-scripts"          // no allow-same-origin → isolated origin
  csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"
/>
```

### Pattern 3: Runtime Route Registration

**What:** At app bootstrap, fetch dynamic page definitions, build route elements, register them alongside static routes.
**When to use:** SPA with DB-driven routes.
**Trade-offs:** Brief loading state before routes ready; deep-link refresh works (routes rebuild from DB each load).

```typescript
// App.tsx
const routes = useRoutes([
  // static routes...
  { path: '/p/:slug', element: <DynamicPage /> },
  { path: '/admin/p/:slug', element: <AdminGuard><AdminDynamicPage /></AdminGuard> },
])
```
(DynamicPage component looks up slug in merged registry → fetches content → renders sandbox.)

## Data Flow

### Dynamic Page Creation → Visit Flow

```
[Admin creates page in PageManagementPage]
    ↓ (Monaco HTML content)
[POST /api/aux/admin/pages] → AdminGuard → service/page.Create → ent.Page.Create → DB
    ↓
[User visits /p/<slug>]
    ↓
[DynamicPage component] → merged registry lookup → GET /api/aux/pages/:slug
    ↓
[service/page.GetBySlug] → ent.Page.Query → DB → page content
    ↓
[SandboxRenderer] → <iframe srcdoc sandbox> → rendered page
    ↓
[iframe postMessage telemetry] → /api/aux/telemetry/page-view (existing, page_id="page:<slug>")
```

### Sidebar Menu Data Flow

```
[App bootstrap] → getMergedRegistry() → static core + GET /api/aux/pages (list)
    ↓
[AdminLayout Sidebar] maps registry → NavLink items (admin pages only)
```

### Key Data Flows

1. **Page CRUD:** admin UI → admin API (AdminGuard) → service → ent → DB. Standard envelope responses.
2. **Page fetch (public):** DynamicPage → public API (TelemetryGuard rate-limit) → service → ent → content.
3. **Telemetry continuity:** dynamic page id `page:<slug>` flows into existing page_views/feature_clicks via telemetry-sdk — no schema change to telemetry tables, dashboard aggregates automatically.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-100 dynamic pages | In-memory merged registry fetched at bootstrap; fine |
| 100-1000 pages | Add pagination to page list API; sidebar shows curated subset |
| 1000+ pages | Cache page content (Redis); CDN for public page content; consider content versioning |

### Scaling Priorities

1. **First bottleneck:** page content size — enforce max content length (e.g., 256KB) in service layer + API validation
2. **Second bottleneck:** analytics full-scan (existing CONCERNS issue) — add time-bounded queries when dynamic page count grows

## Anti-Patterns

### Anti-Pattern 1: Storing dynamic page content in system_meta KV

**What people do:** Reuse the existing SystemMeta KV table for page content (JSON blob per key).
**Why it's wrong:** Non-atomic read-modify-write, no schema enforcement, no indexing by slug/visibility, unbounded row growth, breaks telemetry page_id model.
**Do this instead:** Dedicated `pages` Ent table with typed columns.

### Anti-Pattern 2: Rendering user HTML with dangerouslySetInnerHTML + DOMPurify

**What people do:** Sanitize HTML then inject into main app DOM.
**Why it's wrong:** Sanitizer bypass CVEs are constant; user scripts reach parent app realm → localStorage JWT theft.
**Do this instead:** iframe sandbox + srcdoc + CSP.

### Anti-Pattern 3: Registering dynamic routes by mutating static PAGE_REGISTRY

**What people do:** Push dynamic pages into the existing `PAGE_REGISTRY` const array at runtime.
**Why it's wrong:** Mutating a `const` array is fragile; breaks the existing registry↔routes consistency test; couples static and dynamic concerns.
**Do this instead:** Separate static core + dynamic fetch + pure merge function producing a new readonly list.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| sub2api (existing) | No change — dynamic admin pages still load via `custom_menu_items` iframe with token | New `/admin/p/:slug` routes work as iframe targets |
| PostgreSQL (existing) | New `pages` table via Ent migration | Explicit `-migrate` flag (existing convention) |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| admin UI ↔ admin pages API | REST, AdminGuard (X-Aux-Session) | Standard envelope |
| DynamicPage ↔ public pages API | REST, TelemetryGuard rate-limit | Public, no session |
| iframe sandbox ↔ parent | postMessage only | Telemetry hooks; no DOM access |
| merged registry ↔ sidebar/dashboard/telemetry | Function call (in-memory) | Single source of truth |

## Suggested Build Order

1. **Dependencies + schema** (no UI yet): install shadcn/ui + gsap; create `pages` Ent schema + migrate. Foundation for everything.
2. **Backend page service + APIs**: service layer, admin CRUD handler, public fetch handler, router wiring. Testable without UI.
3. **Frontend registry merge + dynamic routes**: dynamic-pages fetch, merged registry, dynamic route components (stub render). Sidebar can use merged registry.
4. **Sidebar layout**: replace AdminLayout top nav with shadcn Sidebar. Visual shell ready.
5. **Page management UI**: CRUD page with Monaco editor. Admin can create pages end-to-end.
6. **Sandbox renderer + dynamic page hosts**: real HTML rendering in `/p/:slug` and `/admin/p/:slug`. End-to-end works.
7. **Dashboard enhancement + page-writing skill**: list dynamic pages in dashboard; codify conventions in skill.

## Sources

- Existing codebase `.planning/codebase/ARCHITECTURE.md` — existing layers, KTD7 registry
- Existing codebase `.planning/codebase/STRUCTURE.md` — where to add code
- Existing codebase `.planning/codebase/CONCERNS.md` — friction points (static registry, top nav, localStorage JWT)
- shadcn/ui Sidebar docs — layout primitive
- MDN iframe sandbox — isolation model

---
*Architecture research for: dynamic page management subsystem*
*Researched: 2026-08-18*
