# Phase 1 Research: Dependencies & Data Foundation

**Phase:** 1
**Phase Goal:** The foundational libraries are installed and verified, and the `pages` data model is migrated, so all subsequent frontend and backend work has a stable base.
**Researched:** 2026-08-18
**Confidence:** HIGH

## Summary

Phase 1 is purely additive foundation work in a brownfield project: install three frontend dependency groups (shadcn/ui, GSAP, Monaco) without breaking existing Tailwind/dark-mode/CSS, and add one Ent schema (`page`) without touching existing tables. The risk is integration clobbering (shadcn init rewriting existing config), not novelty — all three libraries are well-documented for this exact stack. The research below captures the exact integration specifics the planner needs.

---

## 1. shadcn/ui Integration into Existing Tailwind 3.4 + React 18 + Vite

### 1.1 Current Frontend State (must not break)

- `frontend/tailwind.config.js`: `darkMode: 'class'`, content globs `['./index.html', './src/**/*.{ts,tsx}']`, empty `theme.extend`, no plugins. **shadcn must extend this, not replace it.**
- `frontend/src/index.css`: starts with `@tailwind base/components/utilities`, then defines extensive custom CSS variables under `:root` and `.teralemo-page` (TERALEMO homepage theming), plus `html.dark .teralemo-page` dark variants. **This custom CSS must survive shadcn init.**
- `frontend/vite.config.ts`: Vite 5 with `@vitejs/plugin-react`, `@` → `src/` alias, vitest config inline. **shadcn uses the `@/` alias.**
- `frontend/tsconfig.json`: has paths config (verify `@/*` mapping exists; if not, add).
- React 18.3.1, React Router 6.26, TypeScript 5.6.

### 1.2 shadcn init — Exact Approach

Run `npx shadcn@latest init` in `frontend/`. The CLI will prompt for config. Key answers to avoid clobbering:

- **Style:** Default (or New York) — both work; New York is more modern.
- **Base color:** Neutral or Slate — pick one consistent with the existing gray palette (existing uses `gray-*` Tailwind classes). Slate aligns best.
- **CSS variables for theming:** Yes — but shadcn will APPEND its `:root`/`.dark` CSS-variable blocks to `index.css`. **Review the diff after init: ensure shadcn's `:root` block is merged with (not replacing) the existing `:root`/`.teralemo-page` blocks.**
- **Components alias:** `@/components` (matches existing `src/components/`)
- **Utils alias:** `@/lib/utils` (shadcn creates `src/lib/utils.ts` with `cn()`)
- **RSC (React Server Components):** No (this is a Vite SPA, not Next.js)
- **tsx:** Yes

**components.json** (created at `frontend/components.json`):
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

### 1.3 Tailwind Config Extension

shadcn init will MODIFY `tailwind.config.js` to add:
- `darkMode: ["class"]` (already `'class'` — keep existing, don't duplicate)
- `content` globs (already present — keep existing, don't duplicate)
- `theme.extend` with shadcn's color tokens (`border`, `input`, `ring`, `background`, `foreground`, primary/secondary/muted/accent/destructive variants, sidebar tokens, etc.) mapped to CSS variables (`hsl(var(--...))`)
- `borderRadius` mapped to CSS vars
- `plugins`: adds `tailwindcss-animate` (must `pnpm add tailwindcss-animate` if init doesn't)

**Critical:** After init, diff `tailwind.config.js`. Ensure `content` still includes `'./index.html'` and `'./src/**/*.{ts,tsx}'` (shadcn may add its own glob — merge, don't replace).

### 1.4 CSS Variables Coexistence

shadcn appends to `src/index.css`:
```css
:root {
  --background: ...; --foreground: ...; /* etc shadcn tokens */
}
.dark {
  --background: ...; /* dark variants */
}
```

The existing `:root` has `font-family` etc. (general). The `.teralemo-page` block has homepage-specific tokens. **shadcn's `:root`/`.dark` are additive CSS variables — they coexist.** Verify:
1. Existing `.teralemo-page` variables untouched.
2. `html.dark` class strategy still works (shadcn uses `.dark` class on `html` — matches existing `html.dark .teralemo-page`).
3. Dark-mode toggle (in `lib/theme.ts`) still applies `dark` class to `html`.

### 1.5 Components to Add

Run `npx shadcn@latest add <component>` for each. All land in `src/components/ui/`:

**Phase 1 (foundation — add all needed for Phases 4/5 now):**
`button card dialog input label table sidebar dropdown-menu form select switch tabs toast tooltip separator scroll-area sheet skeleton`

**Dependency notes:**
- `sidebar` requires `SidebarProvider` wrapper + `Sheet` (for mobile) — added together. The actual layout wiring is Phase 4, but installing the component now is fine.
- `form` requires `react-hook-form` + `@hookform/resolvers` + `zod`. **Decision: install `react-hook-form`, `@hookform/resolvers`, `zod` in Phase 1** (DEP coverage — form is listed; these are form's peer deps). Alternatively defer Form to Phase 5. **Recommend: install react-hook-form + zod now** so `form` component installs cleanly.
- `toast` requires `sonner` or the shadcn toast (uses Radix). shadcn now defaults to `sonner` — install `sonner`.

### 1.6 Supporting Libraries (install with pnpm)

```bash
cd frontend
pnpm add class-variance-authority clsx tailwind-merge tailwindcss-animate lucide-react
pnpm add react-hook-form @hookform/resolvers zod sonner
```
- `class-variance-authority` (cva) — shadcn variant typing
- `clsx` + `tailwind-merge` — `cn()` util deps
- `tailwindcss-animate` — shadcn animation plugin
- `lucide-react` — shadcn default icons
- `react-hook-form` + `@hookform/resolvers` + `zod` — Form component deps (used in Phase 5)
- `sonner` — toast (shadcn default)

Radix primitives install transitively via `shadcn add` (don't install manually).

### 1.7 Verification (no regression)

After shadcn init + component add:
1. `pnpm typecheck` passes (tsc --noEmit)
2. `pnpm test` passes (existing 119 vitest tests — homepage/config/dashboard/admin-guard/api-client/telemetry/page-registry)
3. `pnpm build` succeeds
4. Manual: `pnpm dev` → visit `/` (TERALEMO homepage), `/admin/dashboard`, `/admin/homepage` — visual parity + dark-mode toggle works
5. Render a `<Button>` from `@/components/ui/button` in a scratch route — renders without error

---

## 2. GSAP 3.12 + @gsap/react Integration

### 2.1 Install

```bash
cd frontend
pnpm add gsap @gsap/react
```

- `gsap` 3.12.x — core + plugins (ScrollTrigger included in `gsap/ScrollTrigger`)
- `@gsap/react` 2.1.x — `useGSAP` hook

### 2.2 No Vite Config Change Needed

GSAP works with Vite out of the box. No `optimizeDeps` or worker config needed. Tree-shaking: import from `gsap/ScrollTrigger` (subpath) to avoid pulling all plugins.

### 2.3 useGSAP Pattern (for Phase 5+ page content)

```tsx
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useRef } from 'react'

useGSAP(() => {
  gsap.from('.box', { opacity: 0, y: 20, duration: 0.5 })
}, { scope: containerRef })  // scope limits selector + auto-cleanup
```
`useGSAP` handles `gsap.context()` + cleanup automatically — no manual `gsap.context()`/`revert()` in useEffect.

### 2.4 Verification

1. `pnpm typecheck` passes
2. Render a scratch component using `useGSAP` + `gsap.from` — animation plays, no console errors, no cleanup leak on unmount

---

## 3. Monaco Editor (@monaco-editor/react) Integration

### 3.1 Install

```bash
cd frontend
pnpm add @monaco-editor/react
```

`@monaco-editor/react` 4.x — wraps monaco-editor, handles loader/worker config internally.

### 3.2 Lazy Loading (critical — don't bloat main bundle)

Monaco is ~5MB. **Must lazy-load.** Two options:

**Option A (recommended): React.lazy + dynamic import in the page editor route only**
```tsx
// In PageManagementPage (Phase 5) — NOT global
const Editor = React.lazy(() => import('@monaco-editor/react').then(m => ({ default: m.default })))
```
Editor only loads when `/admin/pages` (edit mode) is visited.

**Option B:** `@monaco-editor/react`'s built-in `loader` uses a CDN by default (loads monaco from jsdelivr). To bundle locally, configure `loader.config({ paths: { vs: '...' } })`. **For Phase 1, default CDN loader is acceptable** (Phase 5 can switch to local bundling if offline requirement emerges).

### 3.3 Vite Worker Config

`@monaco-editor/react` with the default CDN loader needs NO Vite worker config. If Phase 5 switches to local bundling (`monaco-editor` package), then `vite-plugin-monaco-editor` or manual worker config is needed. **Phase 1: just install the package + verify it imports; no Vite config change.**

### 3.4 Verification (Phase 1 — minimal)

1. `pnpm typecheck` passes (package types resolve)
2. A dynamic `import('@monaco-editor/react')` in a scratch route resolves without error (don't need full render in Phase 1 — Phase 5 does the real editor integration)

---

## 4. Ent `page` Schema

### 4.1 Existing Schema Style (mirror exactly — from `ent/schema/page_view.go`)

- Package doc comment (Chinese, references unit like U5)
- `entsql.Annotation{Table: "page_views"}` (snake_case plural table name → `pages`)
- Chinese field comments
- `field.Time("created_at").Default(time.Now).Immutable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"})` for immutable timestamps
- `index.Fields(...)` for query optimization
- `Edges()` returns `nil` (no relations in v1)

### 4.2 New `ent/schema/page.go`

```go
// Package schema 定义附属内容系统的 Ent schema。
//
// 动态页面管理: Page —— 管理员创建的动态页面记录。可 CRUD(非只追加)。
//
// 与 PageView/FeatureClick(只追加埋点)不同, Page 是可变实体:
// 管理员可创建/编辑/删除/启停。page_id 在埋点表里为 "page:<slug>"(命名空间隔离)。
package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Page 是管理员创建的动态页面。
type Page struct {
	ent.Schema
}

func (Page) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "pages"},
	}
}

func (Page) Fields() []ent.Field {
	return []ent.Field{
		field.String("slug").
			MaxLen(128).
			NotEmpty().
			Comment("页面 slug, 路由 /p/<slug> 或 /admin/p/<slug>"),
		field.String("title").
			MaxLen(256).
			NotEmpty().
			Comment("页面标题(展示用)"),
		field.String("visibility").
			MaxLen(16).
			Default("public").
			Comment("可见性: public 或 admin"),
		field.String("content_type").
			MaxLen(16).
			Default("html").
			Comment("内容类型: html 或 react(v2)"),
		field.String("content_html").
			Optional().
			SchemaType(map[string]string{dialect.Postgres: "text"}).
			Comment("HTML 内容(iframe 沙箱渲染)"),
		field.String("content_react").
			Optional().
			SchemaType(map[string]string{dialect.Postgres: "text"}).
			Comment("React/TSX 源码(v2 动态编译渲染)"),
		field.Bool("enabled").
			Default(true).
			Comment("是否启用(停用页 404, 行与埋点保留)"),
		field.Time("created_at").
			Default(time.Now).
			Immutable().
			SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).
			Comment("创建时间"),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now).
			SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).
			Comment("更新时间"),
	}
}

func (Page) Edges() []ent.Edge {
	return nil
}

func (Page) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("slug").Unique(),
		index.Fields("visibility"),
		index.Fields("enabled"),
	}
}
```

### 4.3 Regenerate + Migrate

```bash
cd backend
go generate ./ent          # regenerate ent client with new Page schema
go run ./cmd/server -migrate  # explicit flag (existing convention) — creates pages table
```

**Migrate mechanism** (from `cmd/server/main.go:43,60,186`):
- `flag.Bool("migrate", false, "Create database tables (ent auto-migration) and exit")`
- When `-migrate` passed: runs `migrate.NewSchema(drv).Create(ctx)` then exits (no HTTP server)
- `make migrate` wraps this
- Idempotent — re-running is a no-op (ent auto-migrate is additive for new tables/columns)

### 4.4 Migration Safety (Pitfall 5)

- ent auto-migrate is **additive** — it creates new tables/columns but does NOT drop existing ones. Existing `page_views`/`feature_clicks`/`system_meta` are untouched.
- **Verify after migrate:** connect to dev DB, `\d pages` shows the new table; `\d page_views` unchanged; `\d feature_clicks` unchanged; `\d system_meta` unchanged.
- The `pages` table is MUTABLE (CRUD) — distinct from append-only telemetry. Don't apply `Immutable()` to `updated_at` (it must be mutable). `created_at` IS immutable.

### 4.5 Verification

1. `go generate ./ent` succeeds, `ent/page.go` (client) + `ent/page/` (query) + `ent/pagecreate`/`pageupdate` generated
2. `make vet` passes
3. `make test-unit` passes (existing tests unaffected)
4. `make migrate` creates `pages` table; re-running `make migrate` is a no-op
5. Existing telemetry tables unchanged (query `\d page_views` etc.)

---

## 5. Files This Phase Touches

**New:**
- `frontend/components.json` (shadcn config)
- `frontend/src/lib/utils.ts` (cn util, shadcn)
- `frontend/src/components/ui/*.tsx` (~17 shadcn components)
- `backend/ent/schema/page.go` (new schema)
- `backend/ent/page*.go` + `backend/ent/page/` (generated — don't hand-edit)

**Modified:**
- `frontend/package.json` + `frontend/pnpm-lock.yaml` (new deps)
- `frontend/tailwind.config.js` (shadcn theme extend + animate plugin)
- `frontend/src/index.css` (shadcn CSS variables appended)
- `frontend/tsconfig.json` (verify `@/*` path mapping; add if missing)
- `backend/ent/` (regenerated client code)

**Untouched (must verify):**
- `frontend/src/pages/HomePage.tsx` and `.teralemo-page` CSS
- `frontend/src/pages/admin/DashboardPage.tsx`, `HomepageConfigPage.tsx`
- `frontend/src/layouts/AdminLayout.tsx` (changes in Phase 4, not 1)
- `frontend/src/App.tsx` (changes in Phase 3, not 1)
- `backend/ent/schema/page_view.go`, `feature_click.go`, `system_meta.go`
- `backend/internal/` (no handler/service changes in Phase 1)

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| shadcn init overwrites `tailwind.config.js` content globs | Diff after init; restore `'./index.html'` + `'./src/**/*.{ts,tsx}'` if replaced |
| shadcn `:root` CSS vars clobber `.teralemo-page` vars | They're separate selectors (`:root` vs `.teralemo-page`); verify `.teralemo-page` block intact |
| shadcn dark mode strategy conflicts with `html.dark` | shadcn uses `.dark` class on `html` — matches existing. Verify toggle still works. |
| `form` component install fails without react-hook-form/zod | Install react-hook-form + @hookform/resolvers + zod before/with `form` add |
| Monaco bloats main bundle | Lazy-load via React.lazy in Phase 5; Phase 1 only verifies import resolves |
| Ent regen fails on schema syntax error | Mirror page_view.go style exactly; run `go generate ./ent` and fix compile errors before migrate |
| Migrate touches existing tables | ent auto-migrate is additive; verify with `\d` on all 4 tables post-migrate |

---

## 7. Validation Architecture (for Nyquist / Dimension 8)

**Validation approach for Phase 1:**
- **Regression gate:** existing frontend vitest suite (119 tests) + backend `make test-unit` must pass unchanged after all deps installed + schema added. This is the primary validation — proves no regression.
- **Smoke gate:** a shadcn Button + a gsap animation render in a scratch route (proves deps work at runtime, not just install).
- **Schema gate:** `pages` table exists with all 9 fields; existing 3 tables unchanged (proves migration is additive + correct).
- **Idempotency gate:** `make migrate` twice → second run is a no-op (proves migrate is safe to re-run).

No new unit tests required in Phase 1 (the deps install + schema add are infrastructure; their tests come in Phases 2-6 when code uses them). The regression suite IS the Phase 1 test.

---

## Sources

- Existing `ent/schema/page_view.go` — schema style template
- Existing `cmd/server/main.go:43,60,186` — migrate flag mechanism
- Existing `frontend/tailwind.config.js`, `src/index.css`, `vite.config.ts` — current config state
- `.planning/research/STACK.md` — shadcn/gsap/monaco version + integration guidance
- `.planning/research/PITFALLS.md` — Pitfall 5 (ent migration), Pitfall 7 (shadcn clobbers tailwind)
- `.planning/codebase/CONVENTIONS.md` — Ent schema conventions, envelope, test patterns
- `.planning/codebase/TESTING.md` — existing test counts + commands

---
*Phase 1 research complete: 2026-08-18*
