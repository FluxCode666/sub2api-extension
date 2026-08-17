# Stack Research

**Domain:** Dynamic page management subsystem (user-supplied HTML/React content) added to existing Go+React app
**Researched:** 2026-08-18
**Confidence:** HIGH

## Recommended Stack

### Core Technologies (additions to existing stack)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| shadcn/ui | latest (CLI-based, not versioned pkg) | Headless UI component library (Button/Card/Dialog/Input/Table/Sidebar...) | Copy-in components over Radix primitives; full source ownership; aligns with existing Tailwind 3.4; no runtime dependency lock-in. Standard for React 18 + Tailwind admin UIs in 2025. |
| GSAP | 3.12.x | Animation engine (gsap context, useGSAP, ScrollTrigger) | User explicitly requested. Industry-standard, framework-agnostic, perf-optimized. `@gsap/react` provides `useGSAP` hook for safe React 18 cleanup. |
| React Router 6 | 6.26.x (existing) | Dynamic route registration | Already in stack. `useRoutes` + lazy route config enables runtime route injection from DB-fetched page definitions. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@gsap/react` | 2.1.x | `useGSAP` hook for React | Every component using gsap — handles context + cleanup automatically |
| `tailwindcss-animate` | 1.0.x | Tailwind animation plugin | Required by shadcn/ui for enter/exit animations (Dialog/Tooltip/Toast) |
| `class-variance-authority` | 0.7.x | Variant typing for components | shadcn/ui components use `cva` for variant definitions |
| `clsx` | 2.1.x | Conditional className composition | shadcn/ui `cn()` util dependency |
| `tailwind-merge` | 2.x | Dedup conflicting Tailwind classes | shadcn/ui `cn()` util dependency — prevents `p-2 p-4` conflicts |
| `lucide-react` | latest | Icon set | shadcn/ui default icon library; sidebar/menu/icons |
| Radix UI primitives | latest (per-component) | Accessible headless components | shadcn/ui builds on these (Dialog/Dropdown/Tooltip/etc.); installed transitively via shadcn add |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| shadcn CLI (`npx shadcn@latest`) | Add components | Run `init` once to create `components.json` + `lib/utils.ts` (cn util); then `add <component>` per component. Configure to use existing `src/` + Tailwind + `@/` alias. |
| `@monaco-editor/react` | Code editor for HTML/React page content | Table-stakes for editing raw code in admin UI (syntax highlight, validation). Lazy-loaded — large bundle, only in page editor route. |

## Installation

```bash
cd frontend

# shadcn/ui init (creates components.json, lib/utils.ts, updates tailwind.config)
npx shadcn@latest init   # choose: TypeScript yes, src/ yes, @/ alias, existing tailwind

# shadcn components (add as needed)
npx shadcn@latest add button card dialog input label table sidebar dropdown-menu \
  form select switch tabs toast tooltip separator scroll-area sheet skeleton

# GSAP
pnpm add gsap @gsap/react

# Code editor for page management
pnpm add @monaco-editor/react

# shadcn transitive deps (init usually installs these, verify)
pnpm add class-variance-authority clsx tailwind-merge tailwindcss-animate lucide-react
```

Backend: no new Go dependencies. Ent schema addition + `go generate ./ent`.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| shadcn/ui | Mantine / Ant Design | If you want a fully themed component lib with less source ownership — but conflicts with Tailwind-first approach and existing styling |
| shadcn/ui | Headless UI (@headlessui/react) | If you only need 1-2 components; shadcn gives more (Table, Form, Sidebar) with Radix backing |
| iframe srcdoc for user HTML | DOMPurify + dangerouslySetInnerHTML | NEVER for user content — sanitizer bypasses are constant; iframe sandbox is the only safe in-process option |
| GSAP | Framer Motion | If animations are purely React-component-based; user explicitly asked for gsap, and gsap is more powerful for arbitrary DOM/page-content animations |
| Monaco | CodeMirror 6 | If bundle size is critical; Monaco is heavier but better DX for code editing. Lazy-load mitigates. |
| Babel standalone (v2 React runtime compile) | SWC (in-browser via wasm) | v2 only — SWC wasm is faster than Babel standalone but larger; Babel standalone is simpler. Defer decision to v2 phase. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `dangerouslySetInnerHTML` for user HTML | XSS — even with DOMPurify, sanitizer bypass CVEs are frequent; user content is untrusted | iframe `sandbox` + `srcdoc` + CSP |
| `eval()` / `new Function()` for user React | Arbitrary code execution in main realm → session theft, full app compromise | v2: isolated iframe realm or Web Worker + SWC/Babel compile; never main realm eval |
| `react-live` / `react-runner` in main realm for user code | Same eval-based execution model — XSS surface | v2: sandboxed iframe compile-and-render |
| Storing page content as JSON in `system_meta` (KV) | Non-atomic read-modify-write, no schema, unbounded growth, no indexing | Dedicated `pages` Ent table with typed columns |
| Auto-migrate on startup for the new `pages` table | Existing codebase uses explicit `-migrate` flag (failure-closed); auto-migrate violates convention | Keep explicit `-migrate`; document in phase |
| Embedding gsap in user HTML v1 content | v1 HTML runs in sandboxed iframe — gsap from parent isn't accessible; CDN load in iframe is fragile | v1: pure HTML/CSS only in sandbox. v2: React pages get gsap via the app's module system |

## Stack Patterns by Variant

**If rendering user HTML (v1):**
- Use `<iframe srcdoc={content} sandbox="allow-scripts" csp="...">` with strict CSP
- Because: sandbox isolates user DOM from parent app; `allow-scripts` enables inline JS but blocks same-origin access; CSP restricts what scripts can load
- Parent communicates with iframe via `postMessage` only (for telemetry hooks)

**If rendering user React (v2):**
- Compile TSX in a sandboxed iframe (separate origin/realm) using Babel standalone or SWC-wasm, render into iframe document
- Because: compilation + execution both happen in isolated realm; parent provides React/shadcn/gsap via `importmap` or pre-bundled UMD exposed on iframe window
- NEVER compile user React in the main app realm

**If integrating shadcn/ui into existing Tailwind:**
- Run `shadcn init` pointing at existing `tailwind.config.js`, `src/index.css`, `@/` alias
- shadcn extends (not replaces) the Tailwind config with CSS variables for theming
- Verify dark mode still works (existing `dark:` variants + shadcn's `[data-mode]` or `dark` class strategy must align)

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| shadcn/ui | Tailwind 3.4 | Yes — shadcn supports Tailwind 3.x; Tailwind 4 migration not needed now |
| shadcn/ui | React 18 | Yes — all Radix primitives are React 18 compatible |
| gsap 3.12 + @gsap/react 2.1 | React 18 | Yes — `useGSAP` designed for React 18 concurrent rendering |
| tailwindcss-animate 1.0 | Tailwind 3.4 | Yes |
| @monaco-editor/react | Vite 5 | Yes — lazy-load via dynamic import to keep main bundle small |

## Sources

- shadcn/ui official docs (shadcn.com) — components.json config, Tailwind integration, dark mode
- GSAP React docs (gsap.com/resources/React) — useGSAP hook, context, ScrollTrigger
- MDN iframe sandbox + CSP — sandbox attribute flags, srcdoc, Content-Security-Policy
- React Router 6 docs — `useRoutes`, lazy routes, dynamic route generation
- Existing codebase `.planning/codebase/STACK.md` — existing versions (don't re-research)

---
*Stack research for: dynamic page management subsystem*
*Researched: 2026-08-18*
