# Feature Research

**Domain:** Dynamic page management subsystem (admin creates pages with HTML/React content, configures routes/permissions)
**Researched:** 2026-08-18
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = the page management system feels broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Create page (CRUD C) | Core value — admin must create pages | LOW | Form: title, slug, visibility, content_type, content |
| List pages (CRUD R) | Admin needs to see/manage existing pages | LOW | Table view with columns: title, slug, route, visibility, status, actions |
| Edit page (CRUD U) | Content/routes change | LOW | Reuse create form prefilled |
| Delete page (CRUD D) | Pages get retired | LOW | Soft consideration: deleting breaks routes/telemetry history; confirm dialog |
| Enable/disable page | Toggle visibility without deleting | LOW | `enabled` bool; disabled pages 404 but row + telemetry retained |
| Route config (slug) | Admin controls the URL | LOW | slug → `/p/:slug` or `/admin/p/:slug` based on visibility; uniqueness validation |
| Permission config (public/admin) | Admin controls who sees it | LOW | Binary, maps to AdminGuard |
| Code content editor | Admin writes HTML/React | MEDIUM | Monaco editor with syntax highlight; lazy-loaded |
| Sidebar navigation | Admin navigates between dashboard/pages-mgmt/pages | MEDIUM | Driven by merged registry (static core + dynamic) |
| Live preview | Admin sees page before saving | MEDIUM | Render in sandbox iframe from current editor content |
| Form validation | Bad slugs/duplicate routes caught | LOW | slug format, uniqueness, required fields |

### Differentiators (Competitive Advantage)

Features that set this apart. Not required for MVP, valuable later.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| React page rendering (v2) | Beyond HTML — full React components with shadcn/gsap | HIGH | Runtime TSX compile in sandbox; defer to v2 phase |
| Page templates | Pre-built page starting points | MEDIUM | Seed templates (landing, doc, form); v1.x |
| Draft/publish workflow | Edit without breaking live page | MEDIUM | `status: draft|published`; v1.x |
| Version history | Rollback bad edits | HIGH | `page_versions` table; v2+ |
| SEO meta per page | title/description/og tags | LOW | v1.x — columns on pages table |
| Reusable blocks | Compose pages from shared blocks | HIGH | v2+ — overlaps with visual editor |
| Per-page telemetry drill-down | See analytics for one page | MEDIUM | Dashboard enhancement; v1.x |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Visual drag-drop page builder | "Make it like Webflow" | Enormous build effort; diverges from code-first value; brittle | Code editor + templates; defer visual builder indefinitely |
| Server-side rendering for dynamic pages | "SEO for dynamic pages" | SPA + iframe-embed model has no SSR path; sub2api embeds via iframe anyway | Client-side rendering; SEO via meta tags only if needed |
| Multi-tenant page namespaces | "Each team gets own pages" | Adds tenant isolation complexity to every query/route/permission; current model is single-tenant | Single-tenant; revisit if sub2api multi-tenancy emerges |
| Real-time collaborative editing | "Like Google Docs for pages" | Massive infra (CRDT/websocket); low value for single-admin editing | Single-editor with optimistic locking (version field) |
| Public page creation by non-admins | "Let users build pages" | Breaks trust boundary — only admins create content | Admin-only creation; public only consumes |

## Feature Dependencies

```
[Dynamic page CRUD (backend + DB)]
    └──requires──> [pages Ent schema]
                       └──requires──> [go generate ./ent]

[Sidebar layout]
    └──requires──> [shadcn/ui installed (Sidebar component)]
    └──requires──> [merged page-registry (static + dynamic)]

[Page management UI]
    └──requires──> [Dynamic page CRUD API]
    └──requires──> [Monaco editor (lazy)]
    └──requires──> [shadcn Form/Table/Dialog]

[Dynamic route registration]
    └──requires──> [Bootstrap fetch of page definitions]
    └──requires──> [merged page-registry]

[iframe sandbox renderer]
    └──requires──> [Dynamic route registration] (rendered inside dynamic route)

[Dashboard enhancement]
    └──enhances──> [merged page-registry] (list dynamic pages + their telemetry)

[React dynamic rendering v2]
    └──requires──> [iframe sandbox renderer] (reuse isolation)
    └──requires──> [runtime TSX compile tooling]
```

### Dependency Notes

- **Dynamic page CRUD requires pages Ent schema:** schema must exist before API handlers; `go generate ./ent` after schema edit
- **Sidebar requires shadcn/ui:** the shadcn Sidebar component is the layout primitive; must `init` shadcn first
- **Page management UI requires Monaco + shadcn Form:** editor needs code editing; form needs shadcn inputs
- **Dashboard enhances merged registry:** once registry merges dynamic pages, dashboard automatically lists them; telemetry aggregation already works on page_id
- **React v2 requires sandbox:** reuse the v1 iframe isolation; don't build a separate isolation mechanism

## MVP Definition

### Launch With (v1)

Minimum viable — validate that admin can create → configure → publish → visit a dynamic page.

- [ ] pages Ent schema + migrate — data foundation
- [ ] Backend admin CRUD API (`/api/aux/admin/pages`, AdminGuard) — manage pages
- [ ] Backend public fetch API (`/api/aux/pages/:slug`) — serve page content
- [ ] shadcn/ui + gsap pre-install — dependency foundation
- [ ] Sidebar layout (replaces top nav) — navigation shell
- [ ] Page management page (list/create/edit/delete/enable-disable) — admin CRUD UI
- [ ] Monaco code editor (HTML mode) — content editing
- [ ] Merged page-registry (static core + dynamic) — single source of truth
- [ ] Dynamic route registration (`/p/:slug`, `/admin/p/:slug`) — routes work
- [ ] iframe sandbox renderer (HTML v1) — safe rendering
- [ ] Dashboard enhanced (lists dynamic pages) — analytics continuity
- [ ] Page-writing skill — codified conventions for creating pages

### Add After Validation (v1.x)

- [ ] Live preview in editor — when CRUD is stable
- [ ] Draft/publish workflow — when multiple admins edit
- [ ] SEO meta per page — when public pages need discoverability
- [ ] Per-page telemetry drill-down — when dashboard needs depth

### Future Consideration (v2+)

- [ ] React/TSX dynamic rendering — after HTML v1 proves the model
- [ ] Page templates — after enough pages exist to see patterns
- [ ] Version history — when edits become frequent/risky

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Page CRUD (backend + UI) | HIGH | MEDIUM | P1 |
| Sidebar layout | HIGH | MEDIUM | P1 |
| iframe sandbox HTML render | HIGH | MEDIUM | P1 |
| Dynamic route registration | HIGH | MEDIUM | P1 |
| shadcn/ui + gsap pre-install | HIGH | LOW | P1 |
| Dashboard enhancement | MEDIUM | LOW | P1 |
| Page-writing skill | MEDIUM | LOW | P1 |
| Live preview | MEDIUM | MEDIUM | P2 |
| Draft/publish | MEDIUM | MEDIUM | P2 |
| React v2 rendering | HIGH | HIGH | P3 |
| Version history | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Payload CMS | Strapi | Builder.io | Our Approach |
|---------|-------------|--------|------------|--------------|
| Page CRUD | ✓ | ✓ | ✓ | Ent table + admin API |
| Route config | ✓ slug-based | ✓ slug-based | ✓ path-based | slug → /p or /admin/p prefix |
| Content editor | WYSIWYG + code | WYSIWYG + code | Visual builder | Code-first (Monaco), no WYSIWYG |
| Permissions | Role-based | Role-based | Role-based | Binary public/admin (matches sub2api embed) |
| Rendering | Server-rendered | Server-rendered | Client SDK | Client iframe sandbox (SPA model) |
| Templates | ✓ | ✓ | ✓ | v1.x (deferred) |
| Versioning | ✓ | ✓ | ✓ | v2 (deferred) |

Our differentiation: code-first content (not WYSIWYG), iframe-sandboxed rendering (safe), binary permission mapped to sub2api embed model, lightweight (no full CMS overhead).

## Sources

- Payload CMS / Strapi / Builder.io feature sets (public docs)
- Existing codebase `.planning/codebase/ARCHITECTURE.md` — existing capabilities
- Existing codebase `.planning/codebase/CONCERNS.md` — friction points (static registry, top nav, localStorage JWT)
- PROJECT.md Active requirements

---
*Feature research for: dynamic page management subsystem*
*Researched: 2026-08-18*
