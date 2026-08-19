# Project Research Summary

**Project:** sub2api-extension · 通用页面管理系统
**Domain:** Dynamic page management subsystem (user-supplied HTML/React content) added to existing Go+React app
**Researched:** 2026-08-18
**Confidence:** HIGH

## Executive Summary

sub2api-extension is an existing Go (Gin+Ent+PostgreSQL) + React 18 (Vite+Tailwind) app embedded in sub2api via iframe. It currently ships a fixed set of pages (TERALEMO homepage, config center, dashboard, examples) driven by a static code-level page-registry. The goal is to upgrade it into a generic page-management system: admins create pages dynamically (HTML v1, React v2), configure routes and permissions, and pages render on-demand without redeployment.

The recommended approach is a **layered, additive** integration: a new `pages` Ent table + admin/public APIs; a merged page-registry (static core + DB dynamic) preserving the existing KTD7 identity namespace; parameterized dynamic routes (`/p/:slug`, `/admin/p/:slug`); and **iframe-sandboxed HTML rendering** as the v1 content renderer (React dynamic compile deferred to v2). shadcn/ui and GSAP are pre-installed as the UI/animation foundation. The top-bar admin layout is replaced by a shadcn Sidebar driven by the merged registry.

The dominant risk is **XSS via user-supplied content exfiltrating the admin JWT from localStorage**. This is mitigated by rendering all user content in a sandboxed iframe (`sandbox="allow-scripts"`, NO `allow-same-origin`, strict CSP) so user scripts get an opaque origin and cannot reach parent storage. Secondary risks: page_id namespace collision (mitigated by `page:<slug>` namespacing), deep-link refresh 404s (mitigated by parameterized routes + on-demand fetch), and shadcn init clobbering existing Tailwind/dark-mode (mitigated by diff review + existing test verification).

## Key Findings

### Recommended Stack

Add shadcn/ui (copy-in components over Radix + Tailwind), GSAP 3.12 + `@gsap/react` (`useGSAP`), Monaco editor (lazy-loaded) for the page content editor, and supporting libs (clsx, tailwind-merge, class-variance-authority, tailwindcss-animate, lucide-react). No new backend dependencies — just a new Ent schema. See `.planning/research/STACK.md`.

**Core technologies:**
- shadcn/ui: admin UI components (Sidebar, Table, Form, Dialog) — copy-in ownership, aligns with existing Tailwind 3.4
- GSAP 3.12 + @gsap/react: animations (user-requested) — `useGSAP` for safe React 18 cleanup
- Monaco: code editor for page content — lazy-loaded to protect main bundle

### Expected Features

See `.planning/research/FEATURES.md`.

**Must have (table stakes):**
- Page CRUD (create/list/edit/delete + enable/disable) with slug + visibility config
- Sidebar navigation (replaces top nav), driven by merged registry
- iframe sandbox HTML renderer (v1)
- Dynamic route registration (`/p/:slug`, `/admin/p/:slug`)
- Code editor (Monaco) for HTML content

**Should have (competitive):**
- Live preview in editor
- Draft/publish workflow
- Per-page SEO meta

**Defer (v2+):**
- React/TSX dynamic rendering (runtime compile in sandbox)
- Page templates, version history

### Architecture Approach

See `.planning/research/ARCHITECTURE.md`. Additive integration — new `pages` Ent table + service + handlers (admin CRUD under AdminGuard, public fetch under TelemetryGuard); frontend merged registry (static core + DB dynamic) feeds sidebar, routes, and telemetry; parameterized dynamic routes fetch content by slug on-demand and render via `SandboxRenderer` (iframe srcdoc + sandbox + CSP).

**Major components:**
1. `ent/schema/page.go` + service/page + handlers — backend page management
2. merged page-registry (`page-registry.ts` + `dynamic-pages.ts`) — single source of truth
3. `SandboxRenderer.tsx` — isolated iframe content rendering
4. shadcn Sidebar AdminLayout — navigation shell
5. `PageManagementPage.tsx` — admin CRUD UI with Monaco

### Critical Pitfalls

See `.planning/research/PITFALLS.md`.

1. **localStorage JWT + user-content XSS** — render all user content in sandboxed iframe without `allow-same-origin`; never `dangerouslySetInnerHTML`
2. **iframe sandbox escape via flags** — only `allow-scripts`; communicate via `postMessage` only
3. **page_id namespace collision** — namespace dynamic IDs as `page:<slug>`; validate slug uniqueness against static IDs
4. **Deep-link refresh 404** — use parameterized `/p/:slug` route + on-demand fetch, not pre-registered per-page routes
5. **Ent migration breaks telemetry** — only add new schema; test migrate against dev DB with telemetry data

## Implications for Roadmap

Based on research, suggested phase structure (Standard granularity → 6-8 phases):

### Phase 1: Dependencies & Data Foundation
**Rationale:** Everything depends on shadcn/ui being installed and the `pages` table existing. Do the foundational, low-risk work first.
**Delivers:** shadcn/ui + gsap installed and verified against existing UI; `pages` Ent schema migrated; existing tests still pass.
**Addresses:** Active requirements (pre-install deps, pages schema)
**Avoids:** Pitfall 7 (shadcn clobbers Tailwind), Pitfall 5 (Ent migration breaks telemetry)

### Phase 2: Backend Page Service & APIs
**Rationale:** Backend is independently testable without UI; service layer + handlers must exist before frontend can consume.
**Delivers:** `service/page` (CRUD + slug uniqueness + visibility filter + content size limit), admin CRUD API (AdminGuard), public fetch API (TelemetryGuard rate-limit), router wiring, tests.
**Addresses:** Active requirements (dynamic page CRUD backend, route permissions)
**Avoids:** Pitfall 6 (unbounded content size), Pitfall 3 (page_id collision — slug uniqueness validation)

### Phase 3: Frontend Registry Merge & Dynamic Routes
**Rationale:** The merged registry is the seam between backend and frontend UI; routes + sidebar depend on it.
**Delivers:** `dynamic-pages.ts` fetch + merge with static `PAGE_REGISTRY`; parameterized `/p/:slug` + `/admin/p/:slug` routes with on-demand content fetch; loading states; page-registry consistency test updated.
**Addresses:** Active requirements (page-registry evolution, dynamic route registration)
**Avoids:** Pitfall 4 (deep-link refresh 404), Pitfall 3 (page_id namespace)

### Phase 4: Sidebar Layout (UI phase — taste skills)
**Rationale:** Visual shell must be ready before the page management UI lives in it. This is a UI-heavy phase — invoke taste skills for design system/sidebar quality.
**Delivers:** shadcn Sidebar-driven AdminLayout replacing top nav; sidebar items from merged registry; dark mode verified; responsive collapse.
**Addresses:** Active requirements (sidebar menu layout)
**Avoids:** Pitfall 7 (dark mode breakage)

### Phase 5: Page Management UI (UI phase — taste skills)
**Rationale:** The core admin capability — creating pages. UI-heavy — invoke taste skills for form/table/editor UX.
**Delivers:** `PageManagementPage` with list/create/edit/delete/enable-disable; Monaco editor (lazy); form validation (slug uniqueness, content size); confirm dialogs.
**Addresses:** Active requirements (page management page CRUD)
**Avoids:** Pitfall 6 (client-side content limit warning)

### Phase 6: Sandbox Renderer & Dynamic Page Hosts
**Rationale:** The security-critical rendering layer. Comes after CRUD so there's content to render.
**Delivers:** `SandboxRenderer.tsx` (iframe srcdoc + sandbox + CSP); `DynamicPage` + `AdminDynamicPage` host components; postMessage telemetry hooks; end-to-end create→visit flow.
**Addresses:** Active requirements (HTML v1 rendering, dynamic page access)
**Avoids:** Pitfall 1 (localStorage JWT XSS), Pitfall 2 (sandbox escape)

### Phase 7: Dashboard Enhancement & Page-Writing Skill
**Rationale:** Polish + codify conventions. Dashboard enhancement is low-risk once registry merges. The skill captures everything learned.
**Delivers:** Dashboard lists dynamic pages with telemetry; page-writing agent skill (registry/route/guard/telemetry/embedded/available libs/templates conventions).
**Addresses:** Active requirements (Dashboard enhanced, page-writing skill)

### Phase Ordering Rationale

- **1 before 2:** shadcn/ui install + Ent schema are prerequisites for all subsequent work
- **2 before 3:** frontend registry merge consumes the backend API
- **3 before 4 & 5:** sidebar and page management UI both depend on merged registry
- **4 before 5:** page management UI lives inside the sidebar layout
- **6 after 5:** sandbox renderer needs CRUD to exist (content to render)
- **7 last:** polish + skill codification after the model is proven

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 6 (Sandbox Renderer):** CSP policy tuning, postMessage protocol design — security-critical, may need spike
- **Phase 5 (Page Management UI):** Monaco lazy-loading in Vite — integration pattern worth verifying

Phases with standard patterns (skip research-phase):
- **Phase 1, 2, 3, 4, 7:** well-documented (Ent CRUD, React Router, shadcn Sidebar, existing dashboard patterns)

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | shadcn/ui + gsap + Monaco are well-established; versions verified against existing Tailwind 3.4 / React 18 |
| Features | HIGH | Page management is a well-understood domain (CMS patterns); table stakes clear |
| Architecture | HIGH | Additive integration into a well-mapped existing architecture; codebase map de-risked this |
| Pitfalls | HIGH | localStorage-JWT + user-content XSS is the known critical risk; iframe sandbox is the established mitigation |

**Overall confidence:** HIGH

### Gaps to Address

- **CSP exact policy for sandbox iframe:** finalize during Phase 6 planning (which inline styles/scripts to allow)
- **v2 React runtime compile tooling (Babel vs SWC):** defer decision to v2; not blocking v1
- **sub2api `custom_menu_items` for dynamic admin pages:** decide whether each dynamic admin page needs a sub2api menu entry, or if sidebar-only navigation suffices — clarify during Phase 4

## Sources

### Primary (HIGH confidence)
- Existing codebase `.planning/codebase/` (STACK/ARCHITECTURE/STRUCTURE/CONVENTIONS/CONCERNS/TESTING/INTEGRATIONS) — mapped 2026-08-18
- shadcn/ui official docs — components.json, Sidebar, dark mode
- GSAP React docs — useGSAP, context
- MDN iframe sandbox + CSP — isolation model

### Secondary (MEDIUM confidence)
- Payload/Strapi/Builder.io feature analysis — public docs (competitor patterns)

---
*Research completed: 2026-08-18*
*Ready for roadmap: yes*
