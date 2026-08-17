# Roadmap: aux-system · 通用页面管理系统

## Overview

This roadmap transforms aux-system from a statically-driven page host into a generic page-management system. The journey moves foundation-first: pre-install the UI/animation/editor dependencies and stand up the `pages` data model; build the backend page service and CRUD/public APIs; evolve the frontend page-registry into a merged (static core + DB dynamic) single source of truth and wire parameterized dynamic routes; replace the top-nav admin shell with a shadcn Sidebar driven by that registry; ship the page-management UI (Monaco editor) that lets admins create/edit/delete/enable pages; render published HTML in a sandboxed iframe with postMessage telemetry; and finally enhance the Dashboard and codify all conventions into a reusable page-writing agent skill. Each phase delivers an end-to-end verifiable capability, and every v1 requirement maps to exactly one phase.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Dependencies & Data Foundation** - Pre-install shadcn/ui, GSAP, Monaco and migrate the `pages` Ent schema without breaking existing UI/tests
- [ ] **Phase 2: Backend Page Service & APIs** - Admin CRUD + public fetch APIs over the `pages` table with slug uniqueness, size limits, and telemetry-safe delete
- [ ] **Phase 3: Frontend Registry Merge & Dynamic Routes** - Merge static core + DB dynamic pages into one registry; register `/p/:slug` and `/admin/p/:slug` parameterized routes with on-demand fetch
- [ ] **Phase 4: Sidebar Layout** - Replace top-nav AdminLayout with a shadcn Sidebar driven by the merged registry; dark mode + responsive collapse verified
- [ ] **Phase 5: Page Management UI** - Admin page CRUD screen with Monaco editor, live slug validation, enable/disable, and confirm dialogs
- [ ] **Phase 6: Sandbox Renderer & Dynamic Page Hosts** - Render user HTML in a sandboxed iframe (strict CSP) with postMessage telemetry hooks and loading/error states
- [ ] **Phase 7: Dashboard Enhancement & Page-Writing Skill** - Dashboard surfaces dynamic-page telemetry; codify page-writing conventions into a reusable agent skill

## Phase Details

### Phase 1: Dependencies & Data Foundation
**Goal**: The foundational libraries are installed and verified, and the `pages` data model is migrated, so all subsequent frontend and backend work has a stable base.
**Mode**: mvp
**Depends on**: Nothing (first phase)
**Requirements**: DEP-01, DEP-02, DEP-03, DEP-04, DATA-01, DATA-02, DATA-03
**Success Criteria** (what must be TRUE):
  1. The existing TERALEMO homepage, config center, and dashboard render unchanged (no style/dark-mode regression) after shadcn/ui, GSAP, and Monaco are installed
  2. A shadcn component (e.g., Button) and a GSAP animation can be rendered in a scratch page without errors
  3. A `pages` table exists in PostgreSQL with id/slug/title/visibility/content_type/content_html/content_react/enabled/created_at/updated_at, alongside the untouched page_views/feature_clicks/system_meta tables
  4. Running the explicit `-migrate` flag applies the new schema idempotently; re-running it is a no-op
**Plans**: TBD
**UI hint**: no

### Phase 2: Backend Page Service & APIs
**Goal**: The backend can create, read, update, delete, and serve dynamic pages via documented APIs, so a page created through the API is immediately fetchable by its slug with correct visibility and rate-limit enforcement.
**Mode**: mvp
**Depends on**: Phase 1
**Requirements**: API-01, API-02, API-03, API-04, API-05, API-06, API-07
**Success Criteria** (what must be TRUE):
  1. An authenticated admin can create, list, get-by-id, update, and delete a page via `/api/aux/admin/pages*` and receive standard envelope responses
  2. An unauthenticated request can fetch an enabled public page's content by slug (`GET /api/aux/pages/:slug`) but cannot fetch a disabled or admin-visibility page
  3. An unauthenticated request can list public page slugs/titles/visibilities (`GET /api/aux/pages`) without any content bodies
  4. Creating a page with a slug colliding with a static core page id, or content over 256KB, is rejected with a clear error
  5. Deleting a page leaves its historical page_view/feature_click rows intact
**Plans**: TBD
**UI hint**: no

### Phase 3: Frontend Registry Merge & Dynamic Routes
**Goal**: The frontend treats static core pages and DB-backed dynamic pages as one read-only registry, and visiting a dynamic page slug (public or admin) loads its content on demand instead of 404ing.
**Mode**: mvp
**Depends on**: Phase 2
**Requirements**: REG-01, REG-02, REG-03, REG-04, ROUTE-01, ROUTE-02, ROUTE-03, ROUTE-04
**Success Criteria** (what must be TRUE):
  1. The static PAGE_REGISTRY (home/dashboard/homepage-config) remains immutable and is merged with DB dynamic pages into a single read-only registry where dynamic ids are namespaced `page:<slug>`
  2. Visiting `/p/<slug>` (for a public page) and `/admin/p/<slug>` (for an admin page, after AdminGuard) renders the page's content fetched on demand by slug
  3. A hard refresh on `/p/<slug>` or `/admin/p/<slug>` renders correctly (no 404) with a loading state during bootstrap
  4. Visiting a non-existent slug shows the existing 404 page
  5. The page-registry↔routes consistency test passes against the merged registry
**Plans**: TBD
**UI hint**: no

### Phase 4: Sidebar Layout
**Goal**: The admin area is navigated via a shadcn Sidebar whose items are driven by the merged registry, replacing the top-nav, so admins have a scalable navigation shell for all current and future admin pages.
**Mode**: mvp
**Depends on**: Phase 3
**Requirements**: SIDE-01, SIDE-02, SIDE-03, SIDE-04
**Success Criteria** (what must be TRUE):
  1. The admin area renders a shadcn Sidebar layout instead of the previous top navigation bar
  2. Sidebar menu items reflect the admin-visibility entries of the merged registry (dashboard, homepage-config, plus any admin dynamic pages)
  3. The sidebar collapses/expands and renders correctly in light and dark modes across desktop and mobile widths
  4. The existing dashboard and homepage-config pages render and function correctly inside the new sidebar layout
**Plans**: TBD
**UI hint**: yes

### Phase 5: Page Management UI
**Goal**: An admin can fully manage dynamic pages through a UI — creating, editing, deleting, and enabling/disabling pages with an in-browser code editor and clear validation — without touching code or the database directly.
**Mode**: mvp
**Depends on**: Phase 4
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07
**Success Criteria** (what must be TRUE):
  1. The `/admin/pages` screen lists dynamic pages in a table showing title, slug, route, visibility, status, and per-row actions
  2. An admin can create a page (title/slug/visibility/content_type/HTML content) with a Monaco editor for HTML and real-time slug uniqueness validation, and the new page appears in the list
  3. An admin can edit an existing page (form prefilled), delete a page via a confirm dialog noting telemetry history is retained, and toggle a page's enabled state (disabled pages 404 but their row and telemetry persist)
  4. Form validation rejects missing required fields, malformed slugs, duplicate slugs, and content over 256KB with clear per-field errors
  5. The Monaco editor lazy-loads, highlights HTML syntax, and warns when content exceeds 256KB
**Plans**: TBD
**UI hint**: yes

### Phase 6: Sandbox Renderer & Dynamic Page Hosts
**Goal**: Published dynamic pages render their user-supplied HTML safely inside a sandboxed iframe that cannot reach the parent app's storage, with telemetry flowing back via postMessage — closing the create→visit loop end to end.
**Mode**: mvp
**Depends on**: Phase 5
**Requirements**: RENDER-01, RENDER-02, RENDER-03, RENDER-04, TEL-01, TEL-02
**Success Criteria** (what must be TRUE):
  1. User-supplied HTML renders inside an `<iframe srcdoc sandbox="allow-scripts">` with a strict CSP (no `allow-same-origin`), and a script in the sandboxed content cannot read the parent app's localStorage/JWT
  2. The sandboxed content communicates with the parent only via postMessage (e.g., telemetry hooks); there is no direct DOM access to the parent
  3. Visiting a created public page end-to-end (create in admin → visit `/p/<slug>`) renders the content and records a page_view with page_id `page:<slug>`; a feature click inside the page records a feature_click with the same page_id
  4. While content loads, a loading skeleton shows; if content fails to load, an error state shows
**Plans**: TBD
**UI hint**: no

### Phase 7: Dashboard Enhancement & Page-Writing Skill
**Goal**: The Dashboard surfaces telemetry for dynamic pages, and the conventions learned across all phases are codified into a reusable page-writing agent skill so future pages (static or dynamic) follow one contract.
**Mode**: mvp
**Depends on**: Phase 6
**Requirements**: DASH-01, DASH-02, SKILL-01, SKILL-02, SKILL-03, QUAL-01, QUAL-02
**Success Criteria** (what must be TRUE):
  1. The Dashboard lists dynamic pages (from the merged registry) alongside their page-view counts and feature-usage metrics
  2. Deleted or disabled dynamic pages' historical data is preserved but not displayed on the Dashboard
  3. A page-writing agent skill exists that encodes the aux-system page contract (registry/route/guard/telemetry/embedded context/available libs gsap+shadcn/ui/templates) for both static core pages and dynamic pages, including reusable templates and an "add new page" checklist
  4. The sidebar layout and page-management UI pass a taste-skills audit for design system adherence, component consistency, and visual quality, and dark mode works across all new UI
**Plans**: TBD
**UI hint**: no

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Dependencies & Data Foundation | 0/0 | Not started | - |
| 2. Backend Page Service & APIs | 0/0 | Not started | - |
| 3. Frontend Registry Merge & Dynamic Routes | 0/0 | Not started | - |
| 4. Sidebar Layout | 0/0 | Not started | - |
| 5. Page Management UI | 0/0 | Not started | - |
| 6. Sandbox Renderer & Dynamic Page Hosts | 0/0 | Not started | - |
| 7. Dashboard Enhancement & Page-Writing Skill | 0/0 | Not started | - |
