# Plan 01 Summary: Frontend Dependencies

**Phase:** 1 — Dependencies & Data Foundation
**Plan:** 01 — frontend-deps
**Status:** Complete
**Date:** 2026-08-18

## What Was Built

Installed shadcn/ui + GSAP + Monaco into the existing React 18 + Vite + Tailwind 3.4 frontend without breaking existing pages.

### Artifacts Created
- `frontend/components.json` (shadcn config, radix-nova preset, aliases @/components/ui)
- `frontend/src/lib/utils.ts` (cn() util: clsx + tailwind-merge)
- `frontend/src/components/ui/*.tsx` (17 components: button, card, dialog, dropdown-menu, input, label, scroll-area, select, separator, sheet, sidebar, skeleton, sonner, switch, table, tabs, tooltip)
- `frontend/src/hooks/use-mobile.ts` (shadcn sidebar responsive hook)

### Files Modified
- `frontend/package.json` + `pnpm-lock.yaml` — added: class-variance-authority, clsx, tailwind-merge, tailwindcss-animate, lucide-react, react-hook-form, @hookform/resolvers, zod, sonner, gsap, @gsap/react, @monaco-editor/react
- `frontend/tailwind.config.js` — extended colors (→CSS vars), borderRadius, fontFamily, tailwindcss-animate plugin; preserved darkMode:'class' + content globs
- `frontend/src/index.css` — shadcn :root/.dark oklch CSS vars appended (teralemo-page block intact); @apply directives converted to plain CSS for Tailwind 3 compat

## Deviations from Plan

1. **shadcn `toast` component not in radix-nova registry** — used `sonner` instead (shadcn 4.x default for toasts). Installed `sonner` package + `sonner.tsx` component. Functionally equivalent.
2. **shadcn `form` component not a separate file in radix-nova** — react-hook-form + zod installed (deps ready); form integration will be inline when Phase 5 builds the page editor form.
3. **shadcn 4.x nova preset uses Tailwind 4 CSS syntax** (`@theme inline`, `@custom-variant`, `@utility`) incompatible with Tailwind 3.4. Fixed by: removing the 3 Tailwind-4 `@import` lines (tw-animate-css, shadcn/tailwind.css, @fontsource-variable/geist); converting `@apply border-border`/`bg-background`/etc. in @layer base to plain CSS (`border-color: var(--border)`); adding full color-token → CSS-var mapping in tailwind.config.js. This was the "shadcn clobbers Tailwind" pitfall (Pitfall 7) manifesting as a Tailwind-version incompatibility rather than config overwrite.
4. **`make migrate` requires `SUB2API_BASE_URL` env var** (not set in Makefile migrate target). Set via `export SUB2API_BASE_URL=http://127.0.0.1:8003` before running. Documented in Plan 02 context.

## Verification

- `pnpm typecheck` — exit 0 ✓
- `pnpm test` — 129 tests pass (16 files) ✓
- `pnpm build` — succeeds, 54 modules, 220KB JS / 72KB CSS ✓
- Runtime imports: gsap (object), useGSAP (function), @monaco-editor/react (object) — all resolve ✓
- `.teralemo-page` CSS block intact (11 references preserved) ✓
- dark mode strategy (`html.dark`) preserved ✓
- tailwind content globs preserved ✓

## Requirements Covered

DEP-01 (shadcn init, no regression), DEP-02 (shadcn components), DEP-03 (gsap), DEP-04 (monaco)
