# Pitfalls Research

**Domain:** Dynamic page management subsystem (user-supplied HTML/React content) in existing Go+React app
**Researched:** 2026-08-18
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: localStorage JWT theft via user-content XSS

**What goes wrong:**
Admin creates a dynamic page containing malicious `<script>`. If the page content renders in the main app realm (e.g., via `dangerouslySetInnerHTML`), the script reads `localStorage.getItem('aux-session')` and exfiltrates the admin JWT. Session hijack.

**Why it happens:**
The existing system stores the aux JWT in localStorage (`lib/admin-auth.ts`). This was safe when all page content was trusted code. Introducing user-supplied HTML/React content without isolation turns every dynamic page into an XSS vector against the admin session.

**How to avoid:**
- Render ALL user-supplied content in a sandboxed iframe with `sandbox="allow-scripts"` and WITHOUT `allow-same-origin`. This gives the iframe a unique opaque origin — it cannot access parent `localStorage`, cookies, or DOM.
- Add a strict CSP on the iframe content: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'` (no external loads in v1).
- NEVER use `dangerouslySetInnerHTML` for user content, even with DOMPurify.
- Long-term: consider moving session from localStorage to httpOnly cookie (separate hardening, not blocking v1).

**Warning signs:**
- Any code path where user HTML touches `document`/`window` of the parent app
- `sandbox` attribute missing `allow-scripts` restriction, or including `allow-same-origin`
- DOMPurify appearing as the "security" layer for user content

**Phase to address:**
Sandbox renderer phase (the phase that builds `SandboxRenderer.tsx`). This is the single most critical security control.

---

### Pitfall 2: iframe sandbox escape via misconfigured flags

**What goes wrong:**
Developer adds `allow-same-origin` to the sandbox attribute "so the iframe can load styles" or "so postMessage works." This defeats the sandbox — the iframe shares the parent origin and can read parent localStorage/cookies/DOM.

**Why it happens:**
`allow-same-origin` seems harmless and fixes some convenience issues (shared CSS, same-origin XHR). The security implication (origin isolation lost) is non-obvious.

**How to avoid:**
- Use ONLY `sandbox="allow-scripts"`. No `allow-same-origin`, no `allow-forms`, no `allow-top-navigation`.
- Pass styles INTO the iframe via `srcdoc` (inline `<style>` in the HTML content), not via parent CSS inheritance.
- Communicate parent↔iframe via `postMessage` (works cross-origin), never via direct DOM access.
- Document this in the page-writing skill so page authors understand the constraint.

**Warning signs:**
- `allow-same-origin` anywhere in sandbox attributes
- Code reaching into `iframe.contentDocument` or `iframe.contentWindow.localStorage`
- "It doesn't work unless I add allow-same-origin" — this means the approach is wrong, not that the flag is needed

**Phase to address:**
Sandbox renderer phase.

---

### Pitfall 3: page_id namespace collision breaking telemetry

**What goes wrong:**
Dynamic pages use slugs like `dashboard` or `home` as their page_id, colliding with static core page IDs. Telemetry aggregates them as one page; dashboard shows wrong counts; page-registry consistency tests break.

**Why it happens:**
The existing `page-registry.ts` uses bare IDs (`home`, `dashboard`, `homepage-config`). It's tempting to use the dynamic page's slug directly as the ID.

**How to avoid:**
- Namespace dynamic page IDs: `page:<slug>` (e.g., `page:landing`, `page:docs`). Static core keeps bare IDs.
- Enforce slug uniqueness against static IDs in the service layer (reject `page` with slug `home`/`dashboard`/`homepage-config`).
- Update the page-registry↔routes consistency test to cover the merged registry.
- The page-writing skill must document the ID convention.

**Warning signs:**
- Dynamic page ID == static page ID
- Telemetry counts for a core page suddenly jump after adding a dynamic page
- Registry consistency test failures

**Phase to address:**
Registry merge phase (when building merged registry) + backend service phase (slug uniqueness validation).

---

### Pitfall 4: Dynamic route deep-link refresh 404s

**What goes wrong:**
User navigates to `/p/landing`, then refreshes. The app rebuilds routes from the merged registry, but if the dynamic pages fetch hasn't completed (or fails), the route isn't registered → 404.

**Why it happens:**
SPA dynamic routes are client-side. On refresh, the app must re-fetch page definitions before routing can match. If routing runs before the fetch resolves, dynamic routes don't exist yet.

**How to avoid:**
- Block route rendering until merged registry is loaded (show a loading state in App.tsx).
- If registry fetch fails, fall back to static routes only + a banner; don't crash.
- For public `/p/:slug`, the DynamicPage component fetches page content by slug directly from `/api/aux/pages/:slug` — so even if the sidebar registry isn't loaded, the route handler can resolve the page. Register `/p/:slug` as a static route pattern that dynamically fetches; don't pre-register every slug.
- Test: hard refresh on `/p/<existing-slug>` must work.

**Warning signs:**
- 404 on refresh but works on in-app navigation
- Routes depending on async state without a loading gate

**Phase to address:**
Dynamic routes phase. Key design decision: register `/p/:slug` as a parameterized route (always exists), fetch by slug inside the component — NOT pre-registering one route per page.

---

### Pitfall 5: Ent schema migration breaks append-only telemetry tables

**What goes wrong:**
Adding the `pages` schema and running `go generate ./ent` + migrate accidentally drops or alters the existing `page_views`/`feature_clicks` tables, losing telemetry history.

**Why it happens:**
Ent auto-migrate is generally safe (additive), but if schema annotations drift or migrate config is wrong, it can attempt destructive changes. The existing convention uses an explicit `-migrate` flag (failure-closed), but a careless change can still surprise.

**How to avoid:**
- Only ADD the new `page` schema; don't touch existing schemas.
- Run `go generate ./ent` and inspect the generated migrate schema diff before applying.
- Test migration against a dev DB with existing telemetry data; verify telemetry tables untouched.
- Keep the explicit `-migrate` flag convention (no auto-migrate on startup).
- The `pages` table is mutable (CRUD) — distinct from append-only telemetry. Don't apply `Immutable()` patterns from telemetry to pages.

**Warning signs:**
- Generated migration touching `page_views` or `feature_clicks`
- `make migrate` producing unexpected DDL
- Missing `-migrate` flag in startup

**Phase to address:**
Backend schema phase (first phase).

---

### Pitfall 6: Unbounded page content size

**What goes wrong:**
Admin pastes a 10MB HTML blob (or a huge base64 image). API accepts it, DB stores it, frontend tries to render it in srcdoc → browser freezes, memory spikes, API slow.

**Why it happens:**
No size limit enforced anywhere.

**How to avoid:**
- Enforce max content length (e.g., 256KB) in: API handler (request body limit), service layer (validation), and frontend (editor warning).
- Reject base64-encoded images in content (require external URL or separate asset flow) — or set a lower limit if allowed.
- Existing TelemetryGuard has a 4KB body limit for telemetry; the pages API needs its own larger but bounded limit.

**Warning signs:**
- No `MaxLen`/size check on content field
- API accepting multi-MB bodies
- srcdoc rendering lagging

**Phase to address:**
Backend service phase (validation) + page management UI phase (editor limit).

---

### Pitfall 7: shadcn/ui init clobbers existing Tailwind/CSS config

**What goes wrong:**
Running `shadcn init` overwrites `tailwind.config.js`, `src/index.css`, or the `@/` alias config, breaking existing styling (dark mode, TERALEMO homepage, existing components).

**Why it happens:**
shadcn init modifies Tailwind config to add CSS-variable-based theming. If not pointed at existing config carefully, it can replace rather than extend.

**How to avoid:**
- Run `shadcn init` and carefully review the diff it produces to `tailwind.config.js` and `index.css`.
- Merge shadcn's CSS variables into existing `:root`/`.dark` blocks — don't replace them.
- Verify existing HomePage/AdminLayout still render correctly after init (run existing tests).
- The existing dark mode uses `dark:` variants + `dark` class — confirm shadcn's dark mode strategy aligns (it does by default, but verify).

**Warning signs:**
- Existing pages look broken after shadcn init
- `index.css` lost its existing custom styles
- Dark mode toggle stops working

**Phase to address:**
Dependencies phase (when installing shadcn/ui).

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip slug uniqueness validation in service | Ship CRUD faster | Duplicate routes, telemetry collision | Never — validate from day 1 |
| Hardcode dynamic routes instead of registry merge | Faster first route | Can't scale to many pages; breaks sidebar | Never — do the merge |
| Skip sandbox CSP | Rendering "works" | XSS surface | Never — CSP is mandatory |
| Reuse telemetry 4KB body limit for pages API | Less code | Can't store real page content | Never — pages need their own limit |
| Skip page-registry consistency test update | Less test churn | Silent registry/route drift | Never — update tests with merge |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| shadcn/ui + existing Tailwind | Letting init replace config | Review diff, merge CSS vars, keep existing dark mode |
| gsap + React 18 | Using `useEffect` for animations (cleanup leaks) | Use `useGSAP` from `@gsap/react` for automatic context cleanup |
| Monaco + Vite | Importing synchronously (huge main bundle) | Dynamic import / lazy-load Monaco only in page editor route |
| Ent new schema + existing | Forgetting `go generate ./ent` | Always regen after schema change; verify migrate diff |
| sub2api iframe + new /admin/p routes | Forgetting to add new routes to `custom_menu_items` | Document that admin dynamic pages need sub2api menu config (or are linked from sidebar) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Bootstrap fetch of all pages blocks render | Slow first paint | Fetch only page list (slug/title/visibility) at bootstrap, not content; fetch content on-demand | >50 pages |
| Monaco loaded in main bundle | Huge initial JS | Lazy-load Monaco only in PageManagementPage route | Always |
| Analytics full-scan (existing) | Slow dashboard | (existing issue) add time bound when dynamic pages increase load | >10k telemetry rows |
| srcdoc re-render on every keystroke | Editor lag | Debounce preview; preview is explicit action, not live | Large content |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `allow-same-origin` in sandbox | Full session compromise | Only `allow-scripts` |
| `dangerouslySetInnerHTML` for user content | XSS → JWT theft | iframe sandbox only |
| `eval`/`Function` for user React (v2) | Arbitrary code execution in app realm | Sandbox iframe compile; never main realm |
| No content size limit | DoS, memory exhaustion | 256KB max, validate server + client |
| Trusting XFF for rate-limit (existing) | Rate-limit bypass | (existing) ensure TrustedProxies set; revisit in hardening |
| Public page API without rate-limit | Abuse | Apply TelemetryGuard-style rate-limit to `/api/aux/pages/:slug` |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No slug validation feedback | Admin discovers route conflict on save | Real-time slug uniqueness check in form |
| Delete without confirmation | Accidental page loss | Confirm dialog + soft-disable option first |
| No loading state on dynamic page | Blank screen while fetching | Skeleton/spinner while content loads |
| Sidebar shows disabled pages as active | Confusing nav | Disabled pages hidden or greyed in sidebar |
| Editor without syntax highlight | Hard to write HTML/React | Monaco with HTML/TSX language mode |

## "Looks Done But Isn't" Checklist

- [ ] **Sandbox renderer:** Often missing CSP — verify `csp` attribute set on iframe, not just `sandbox`
- [ ] **Dynamic routes:** Often missing deep-link refresh test — verify hard refresh on `/p/<slug>` works
- [ ] **Page CRUD:** Often missing slug uniqueness against static IDs — verify creating slug `home` is rejected
- [ ] **Telemetry:** Often missing dynamic page_id in telemetry — verify `page:<slug>` flows to page_views
- [ ] **shadcn integration:** Often breaks dark mode — verify dark toggle works on all pages after init
- [ ] **Ent migration:** Often missing regen — verify `go generate ./ent` ran and migrate diff is additive only

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| localStorage JWT compromised | HIGH | Rotate JWT secret; move session to httpOnly cookie; audit access logs |
| page_id collision corrupted telemetry | MEDIUM | Rename dynamic page IDs to namespaced; write migration to fix historical page_views (best-effort) |
| shadcn init broke styling | LOW | git revert config; manually merge shadcn CSS vars |
| Ent migration dropped telemetry | HIGH | Restore from DB backup (this is why explicit `-migrate` + dev-DB test matters) |
| Dynamic routes 404 on refresh | LOW | Switch to parameterized route + on-demand fetch pattern |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| localStorage JWT XSS | Sandbox renderer phase | iframe has no `allow-same-origin`; CSP set; test JS in content can't read parent localStorage |
| iframe sandbox escape | Sandbox renderer phase | Audit sandbox flags; test postMessage-only communication |
| page_id collision | Registry merge phase + backend phase | Test: create page with slug `home` → rejected; telemetry uses `page:<slug>` |
| Deep-link refresh 404 | Dynamic routes phase | Test: hard refresh on `/p/<existing-slug>` renders page |
| Ent migration breaks telemetry | Backend schema phase | Test: migrate dev DB with telemetry data; verify tables intact |
| Unbounded content size | Backend service phase | Test: 257KB content rejected; 256KB accepted |
| shadcn clobbers Tailwind | Dependencies phase | Test: existing HomePage/AdminLayout/tests pass after shadcn init |

## Sources

- Existing codebase `.planning/codebase/CONCERNS.md` — localStorage JWT, static registry friction, telemetry accept arbitrary page_id
- Existing codebase `.planning/codebase/CONVENTIONS.md` — explicit `-migrate` flag, envelope patterns
- MDN iframe sandbox security model
- OWASP XSS prevention cheatsheet (iframe isolation)
- shadcn/ui init behavior (config merging)

---
*Pitfalls research for: dynamic page management subsystem*
*Researched: 2026-08-18*
