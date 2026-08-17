---
name: aux-page-writer
description: How to create and edit pages in the aux-system (sub2api content host). Use whenever the user wants to add a new page, modify an existing page, create dynamic content, or asks about page routing/permissions/telemetry in aux-system — whether static (code-registered) pages or dynamic (DB-managed) pages. Covers the page-registry contract, route registration, AdminGuard, telemetry page_id namespacing, iframe sandbox rendering, and the available libraries (shadcn/ui, GSAP, Monaco).
---

# aux-system Page Writer

Create and edit pages in aux-system — the sub2api content host. Two page types exist: **static core pages** (code-registered, immutable at runtime) and **dynamic pages** (DB-managed via the Page Management UI). Both share one identity namespace (KTD7) and one telemetry model.

## When to use which page type

| Need | Use |
|------|-----|
| A system-level page that ships with the app (dashboard, config center, examples) | Static core page — edit code |
| A content page an admin creates/edits at runtime without redeploying | Dynamic page — use the Page Management UI (`/admin/pages`) |
| A public landing/marketing page | Dynamic page, visibility=public (`/p/<slug>`) |
| An admin-only internal page | Dynamic page, visibility=admin (`/admin/p/<slug>`) or static core page |

## The page-registry contract (KTD7) — the single source of truth

Every page has a unique `id`, `title`, `path`, and `visibility`. This identity is shared across routing, telemetry, and the dashboard.

**Static core pages** live in `frontend/src/lib/page-registry.ts` (`STATIC_PAGE_REGISTRY` array):
```ts
{ id: 'dashboard', title: '分析仪表盘', path: '/admin/dashboard', visibility: 'admin' }
```

**Dynamic pages** come from the backend `/api/aux/pages` endpoint and are merged at bootstrap via `frontend/src/lib/dynamic-pages.ts` (`getMergedRegistry()`). Their ids are namespaced as `page:<slug>` to avoid collision with static ids.

**Critical rule:** the `id` is the telemetry key. Static pages use bare ids (`home`, `dashboard`); dynamic pages use `page:<slug>`. Never let a dynamic slug collide with a static id — the backend rejects slugs `home`, `dashboard`, `homepage-config`.

## Creating a static core page

1. Add an entry to `STATIC_PAGE_REGISTRY` in `frontend/src/lib/page-registry.ts` (id/title/path/visibility).
2. Register the route in `frontend/src/App.tsx` under the appropriate group (public root, or `/admin` under `AdminGuard`).
3. Create the page component in `frontend/src/pages/` (or `frontend/src/pages/admin/` for admin pages).
4. If the page should appear in the admin sidebar, it auto-appears via `getMergedRegistry()` (static admin pages show in the "核心" group).
5. Run `pnpm test` — the page-registry↔routes consistency test validates the registry.

Static page example (admin, guarded):
```tsx
// src/pages/admin/MyPage.tsx
export default function MyPage() {
  return <div className="space-y-4"><h1 className="text-2xl font-bold">My Page</h1></div>
}
```
```ts
// page-registry.ts — add to STATIC_PAGE_REGISTRY
{ id: 'my-page', title: '我的页面', path: '/admin/my-page', visibility: 'admin' }
```
```tsx
// App.tsx — inside <Route path="/admin" element={<AdminGuard><AdminLayout/></AdminGuard>}>
<Route path="my-page" element={<MyPage />} />
```

## Creating a dynamic page

Dynamic pages are created via the **Page Management UI** at `/admin/pages` — no code changes, no redeploy.

1. Navigate to `/admin/pages` in the admin area.
2. Click "新建页面" (New Page).
3. Fill the form:
   - **标题 (Title):** display title
   - **Slug:** URL identifier (lowercase, digits, hyphens; cannot be `home`/`dashboard`/`homepage-config`)
   - **可见性 (Visibility):** `公开` (public, `/p/<slug>`) or `管理员` (admin, `/admin/p/<slug>`)
   - **内容类型 (Content Type):** `HTML` (v1, sandbox-rendered) or `React` (v2)
   - **内容 (Content):** HTML source (edited in Monaco)
   - **启用 (Enabled):** toggle off to 404 the page without deleting
4. Save. The page is immediately visitable at its route.

Dynamic page content renders in a **sandboxed iframe** (see Security below).

## Routing

| Pattern | Visibility | Guard | Example |
|---------|-----------|-------|---------|
| `/` | public | none | TERALEMO homepage |
| `/p/:slug` | public | none | dynamic public page |
| `/admin/dashboard` | admin | AdminGuard | static core |
| `/admin/p/:slug` | admin | AdminGuard | dynamic admin page |

Dynamic routes (`/p/:slug`, `/admin/p/:slug`) are **parameterized** — registered once in App.tsx, fetch content by slug on-demand. Hard refresh works (routes rebuild from DB each load).

## AdminGuard & sessions

Admin pages (`/admin/*`) are wrapped in `AdminGuard` (`frontend/src/components/AdminGuard.tsx`). It takes a sub2api iframe token, forwards it to the backend `/api/aux/admin/session` for verification, and receives an aux-system JWT stored as `X-Aux-Session`. All admin API calls auto-attach this header via `api-client.ts`.

For dynamic admin pages embedded in sub2api: add the `/admin/p/<slug>` URL to sub2api's `custom_menu_items` config (sub2api injects the token via iframe). See `docs/INTEGRATION.md`.

## Telemetry

Every page view and feature click is tracked. The `page_id` is the page's registry id.

- **Page views:** `trackPageView(pageId)` from `frontend/src/lib/telemetry-sdk.ts`. Dynamic page hosts call this on load.
- **Feature clicks:** inside dynamic page content (sandbox iframe), add `data-feature-id="my-button"` to any clickable element. The SandboxRenderer auto-captures clicks and reports them via `postMessage` → `trackFeatureClick(pageId, featureId)`.

Static pages call `trackPageView`/`trackFeatureClick` directly from their components.

Example — a button in dynamic HTML content that gets tracked:
```html
<button data-feature-id="cta-click">Sign up</button>
```

## Security: iframe sandbox rendering (dynamic HTML content)

Dynamic page HTML renders in `frontend/src/components/SandboxRenderer.tsx` — a sandboxed iframe with strict isolation:

- `sandbox="allow-scripts"` — **no** `allow-same-origin` (the iframe gets an opaque origin, cannot read parent localStorage/JWT/cookies/DOM)
- `srcdoc` injection — content never touches the main app DOM
- CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'` — no external resource loads
- Parent↔iframe communication is `postMessage` only

**Do not** render user HTML with `dangerouslySetInnerHTML` — always use SandboxRenderer. The admin session JWT lives in localStorage; unsandboxed user content could exfiltrate it.

## Available libraries (pre-installed)

When writing page content or static page components, these are available:

- **shadcn/ui** — UI components in `@/components/ui/` (button, card, dialog, input, label, table, sidebar, dropdown-menu, select, switch, tabs, sonner, tooltip, separator, scroll-area, sheet, skeleton). Use `cn()` from `@/lib/utils` for class merging.
- **GSAP 3.12 + @gsap/react** — animations. Use `useGSAP` from `@gsap/react` (not `useEffect`) for automatic context cleanup. Import `gsap` and `gsap/ScrollTrigger` as needed.
- **Monaco editor** — `@monaco-editor/react` (lazy-loaded; only used in the Page Management UI).
- **React Router 6** — `useParams`, `NavLink`, `Link`, `Routes`, `Route`.
- **Tailwind CSS 3.4** — utility classes with `dark:` variants. Dark mode uses `html.dark` class strategy.

**Note for dynamic HTML content:** the sandbox iframe is isolated — it cannot import from the parent app's modules. Dynamic HTML v1 is self-contained (inline `<style>`/`<script>`). GSAP/shadcn in dynamic content is a v2 capability (React dynamic rendering, not yet implemented).

## "Add new page" checklist

**Static page:**
- [ ] Entry added to `STATIC_PAGE_REGISTRY` (unique id, valid path, visibility)
- [ ] Route registered in `App.tsx` (correct group: public root or `/admin` under AdminGuard)
- [ ] Page component created in `src/pages/`
- [ ] `pnpm test` passes (registry↔routes consistency)
- [ ] If admin page: appears in sidebar (automatic via merged registry)

**Dynamic page:**
- [ ] Created via `/admin/pages` UI
- [ ] Slug doesn't conflict with static core ids (`home`/`dashboard`/`homepage-config`)
- [ ] Visibility set correctly (public → `/p/<slug>`, admin → `/admin/p/<slug>`)
- [ ] Content under 256KB
- [ ] Enabled toggle on
- [ ] Visit the route to verify rendering
- [ ] If admin page embedded in sub2api: add to `custom_menu_items`

## File map

| File | Purpose |
|------|---------|
| `frontend/src/lib/page-registry.ts` | Static core page registry (KTD7 source) |
| `frontend/src/lib/dynamic-pages.ts` | Dynamic page fetch + merged registry |
| `frontend/src/lib/telemetry-sdk.ts` | `trackPageView` / `trackFeatureClick` |
| `frontend/src/components/AdminGuard.tsx` | Admin session guard |
| `frontend/src/components/SandboxRenderer.tsx` | iframe sandbox for dynamic HTML |
| `frontend/src/layouts/AdminLayout.tsx` | Sidebar shell (driven by merged registry) |
| `frontend/src/pages/admin/PageManagementPage.tsx` | Dynamic page CRUD UI |
| `frontend/src/pages/DynamicPage.tsx` | Public dynamic page host (`/p/:slug`) |
| `frontend/src/pages/admin/AdminDynamicPage.tsx` | Admin dynamic page host (`/admin/p/:slug`) |
| `frontend/src/App.tsx` | Route root |
| `backend/internal/service/page_service.go` | Page CRUD service + Store interface |
| `backend/internal/handler/admin/page_handler.go` | Admin CRUD endpoints |
| `backend/internal/handler/page_public_handler.go` | Public fetch endpoints |
| `backend/ent/schema/page.go` | Page Ent schema |
