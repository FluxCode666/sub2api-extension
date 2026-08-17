---
phase: 01-dependencies-data-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - frontend/components.json
  - frontend/tailwind.config.js
  - frontend/src/index.css
  - frontend/tsconfig.json
  - frontend/src/lib/utils.ts
  - frontend/src/components/ui/
autonomous: true
requirements: [DEP-01, DEP-02, DEP-03, DEP-04]
estimate:
  tokens: 55000
  raw_tokens: 28000
  tasks: 4
  confidence: med

must_haves:
  truths:
    - "frontend/components.json exists with aliases.ui = @/components/ui and style = new-york"
    - "frontend/src/lib/utils.ts exists and exports a cn() function using clsx + tailwind-merge"
    - "pnpm test exits 0 (existing 129 vitest tests pass unchanged after shadcn/gsap/monaco install)"
    - "pnpm typecheck exits 0"
    - "pnpm build exits 0"
    - "tailwind.config.js still contains content globs ./index.html and ./src/**/*.{ts,tsx} (not replaced by shadcn)"
    - "src/index.css still contains the .teralemo-page block (not removed by shadcn init)"
    - "dark mode toggle (html.dark class strategy) still works on existing pages"
    - "gsap and @gsap/react are importable from frontend source"
    - "@monaco-editor/react is importable via dynamic import from frontend source"
  artifacts:
    - "frontend/components.json"
    - "frontend/src/lib/utils.ts"
    - "frontend/src/components/ui/button.tsx"
    - "frontend/src/components/ui/sidebar.tsx"
    - "frontend/src/components/ui/form.tsx"
  key_links:
    - "shadcn cn() util at @/lib/utils consumed by @/components/ui/* components"
    - "tailwindcss-animate registered in tailwind.config.js plugins"
---

<objective>
Install shadcn/ui (init + core components), GSAP + @gsap/react, and Monaco editor into the existing frontend without breaking the TERALEMO homepage, dashboard, config center, dark mode, or existing tests.

Purpose: Phase 1 foundation — all subsequent frontend phases (Sidebar layout, Page Management UI) depend on shadcn/ui being installed; dynamic page content will use GSAP; the page editor (Phase 5) uses Monaco. Installing now unblocks Phases 4-6.
Output: components.json, lib/utils.ts, ~17 ui/*.tsx components, updated package.json/tailwind.config.js/index.css/tsconfig.json.
</objective>

<execution_context>
@$HOME/.zcode/gsd-core/workflows/execute-plan.md
@$HOME/.zcode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-dependencies-data-foundation/01-RESEARCH.md
@.planning/codebase/STACK.md
@.planning/codebase/STRUCTURE.md
@frontend/tailwind.config.js
@frontend/src/index.css
@frontend/vite.config.ts
@frontend/tsconfig.json
@frontend/package.json
</context>

<tasks>

<task type="tracer">
  <name>Task 1: Install supporting libraries + shadcn init (foundation tracer)</name>
  <files>frontend/package.json, frontend/components.json, frontend/tailwind.config.js, frontend/src/index.css, frontend/src/lib/utils.ts, frontend/tsconfig.json</files>
  <read_first>
    - frontend/tailwind.config.js (current config — must preserve darkMode: 'class', content globs)
    - frontend/src/index.css (current CSS — must preserve @tailwind directives + .teralemo-page variables + html.dark blocks)
    - frontend/tsconfig.json (verify @/* path mapping exists; add if missing)
    - frontend/vite.config.ts (confirm @ alias → src/)
    - frontend/package.json (current deps)
    - .planning/phases/01-dependencies-data-foundation/01-RESEARCH.md (Section 1 — exact shadcn init approach + components.json target)
  </read_first>
  <action>
    In frontend/, install supporting libraries first: `pnpm add class-variance-authority clsx tailwind-merge tailwindcss-animate lucide-react react-hook-form @hookform/resolvers zod sonner`. Then run `npx shadcn@latest init` with answers: style=new-york, baseColor=slate, cssVariables=yes, components alias=@/components, utils alias=@/lib/utils, rsc=no, tsx=yes. This creates components.json, src/lib/utils.ts (cn util), and modifies tailwind.config.js + src/index.css. AFTER init, DIFF tailwind.config.js and src/index.css against git: restore any lost content globs (./index.html, ./src/**/*.{ts,tsx}) if shadcn replaced them; ensure the .teralemo-page CSS variable block and html.dark .teralemo-page block in index.css are intact (shadcn appends its own :root/.dark blocks — these coexist, do not let them overwrite the teralemo blocks). Ensure tsconfig.json has paths mapping "@/*": ["src/*"] (add if shadcn didn't). Do NOT run shadcn add for components yet — that's Task 2.
  </action>
  <verify>
    <automated>cd frontend && pnpm typecheck exits 0 && pnpm test exits 0 && pnpm build exits 0</automated>
    <automated>test -f frontend/components.json && grep -q '"ui": "@/components/ui"' frontend/components.json</automated>
    <automated>test -f frontend/src/lib/utils.ts && grep -q 'export function cn' frontend/src/lib/utils.ts</automated>
    <automated>grep -q "./index.html" frontend/tailwind.config.js && grep -q "./src/\*\*/\*\.{ts,tsx}" frontend/tailwind.config.js</automated>
    <automated>grep -q ".teralemo-page" frontend/src/index.css</automated>
    <automated>grep -q "tailwindcss-animate" frontend/tailwind.config.js</automated>
  </verify>
  <done>
    components.json exists with ui alias @/components/ui; lib/utils.ts exports cn(); tailwind.config.js retains original content globs + adds tailwindcss-animate plugin + shadcn theme tokens; index.css retains .teralemo-page block + appends shadcn :root/.dark vars; existing tests pass (129-test pre-Phase-1 baseline preserved); typecheck + build pass.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add shadcn core components</name>
  <files>frontend/src/components/ui/</files>
  <read_first>
    - frontend/components.json (verify aliases before adding)
    - frontend/src/lib/utils.ts (cn util that components consume)
    - .planning/phases/01-dependencies-data-foundation/01-RESEARCH.md (Section 1.5 — component list + dependency notes)
  </read_first>
  <action>
    In frontend/, run `npx shadcn@latest add button card dialog input label table sidebar dropdown-menu form select switch tabs toast tooltip separator scroll-area sheet skeleton`. This creates ~17 component files under src/components/ui/. Each imports cn() from @/lib/utils and Radix primitives. The `form` component requires react-hook-form + @hookform/resolvers + zod (installed in Task 1). The `sidebar` component pulls in Sheet for mobile. The `toast` uses sonner (installed in Task 1). If any add prompts for overwrite of components.json, answer no. Verify all component files compile.
  </action>
  <verify>
    <automated>cd frontend && pnpm typecheck exits 0</automated>
    <automated>test -f frontend/src/components/ui/button.tsx && test -f frontend/src/components/ui/sidebar.tsx && test -f frontend/src/components/ui/form.tsx && test -f frontend/src/components/ui/table.tsx</automated>
    <automated>cd frontend && pnpm test exits 0</automated>
    <automated>cd frontend && pnpm build exits 0</automated>
  </verify>
  <done>
    All ~17 shadcn components exist under src/components/ui/, import cn() from @/lib/utils, typecheck passes, existing tests pass, build succeeds.
  </done>
</task>

<task type="auto">
  <name>Task 3: Install GSAP + @gsap/react</name>
  <files>frontend/package.json, frontend/pnpm-lock.yaml</files>
  <read_first>
    - frontend/package.json (current deps before add)
    - .planning/phases/01-dependencies-data-foundation/01-RESEARCH.md (Section 2 — gsap integration, no vite config change needed)
  </read_first>
  <action>
    In frontend/, run `pnpm add gsap @gsap/react`. This adds gsap 3.12.x and @gsap/react 2.1.x. No vite.config.ts change needed (gsap works with Vite out of the box). No tailwind change. Do not create any animation components yet — Phase 5+ uses gsap; Phase 1 only installs + verifies importability.
  </action>
  <verify>
    <automated>cd frontend && pnpm typecheck exits 0</automated>
    <automated>cd frontend && node -e "import('gsap').then(()=>import('@gsap/react')).then(()=>console.log('OK')).catch(e=>{console.error(e);process.exit(1)})" exits 0</automated>
    <automated>cd frontend && pnpm test exits 0</automated>
    <automated>grep -q '"gsap"' frontend/package.json && grep -q '"@gsap/react"' frontend/package.json</automated>
  </verify>
  <done>
    gsap + @gsap/react in package.json deps; both importable from ESM; typecheck + existing tests pass.
  </done>
</task>

<task type="auto">
  <name>Task 4: Install Monaco editor</name>
  <files>frontend/package.json, frontend/pnpm-lock.yaml</files>
  <read_first>
    - frontend/package.json (current deps before add)
    - frontend/vite.config.ts (confirm no worker config needed for CDN loader)
    - .planning/phases/01-dependencies-data-foundation/01-RESEARCH.md (Section 3 — Monaco lazy-load, default CDN loader, no vite config change in Phase 1)
  </read_first>
  <action>
    In frontend/, run `pnpm add @monaco-editor/react`. This adds the wrapper (4.x) which uses a CDN loader by default — no Vite worker config needed in Phase 1. Do NOT integrate the editor into any page yet (that is Phase 5). Do NOT add monaco-editor as a direct dep (the wrapper handles loading). Verify the package types resolve and a dynamic import works.
  </action>
  <verify>
    <automated>cd frontend && pnpm typecheck exits 0</automated>
    <automated>grep -q '"@monaco-editor/react"' frontend/package.json</automated>
    <automated>cd frontend && node -e "import('@monaco-editor/react').then(m=>{if(!m.default)process.exit(1);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})" exits 0</automated>
    <automated>cd frontend && pnpm test exits 0</automated>
    <automated>cd frontend && pnpm build exits 0</automated>
  </verify>
  <done>
    @monaco-editor/react in package.json; types resolve; dynamic import works; typecheck + tests + build pass. (Full editor UI integration deferred to Phase 5.)
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| npm registry → frontend deps | Untrusted packages installed via pnpm/npx (shadcn CLI, gsap, monaco wrapper, radix primitives, sonner, zod, react-hook-form) |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-01-01 | Tampering | npm package installs (shadcn CLI, gsap, monaco, radix, sonner, zod, rhf) | high | mitigate | All packages are well-known主流 libraries with high download counts; pin via pnpm-lock.yaml; verify package names match official registries (no typosquats); review shadcn generated component source before committing |
| T-01-SC | Tampering | npx shadcn@latest init + add (executes remote CLI, writes source files) | high | mitigate | shadcn CLI is the official distribution; review generated component files (ui/*.tsx) before committing; diff tailwind.config.js + index.css after init to catch unexpected changes |
| T-01-02 | Information Disclosure | shadcn components.css / index.css | low | accept | CSS variables are non-sensitive; no secrets in frontend config |
</threat_model>

<verification>
- cd frontend && pnpm test (existing 129-test pre-Phase-1 baseline passes — primary regression gate)
- cd frontend && pnpm typecheck (types resolve for all new deps + components)
- cd frontend && pnpm build (production build succeeds, no broken imports)
- Manual: pnpm dev → visit / (TERALEMO homepage), /admin/dashboard, /admin/homepage — visual parity + dark-mode toggle works
- Manual: render <Button> from @/components/ui/button in a scratch route — renders without error
- Manual: scratch route with useGSAP + gsap.from — animation plays, cleans up on unmount
</verification>

<success_criteria>
- shadcn/ui initialized without breaking existing UI (components.json + lib/utils.ts + ~17 ui components)
- GSAP + @gsap/react installed and importable
- Monaco installed and dynamically importable
- Existing 129 frontend tests pass; typecheck + build pass
- No dark-mode regression; .teralemo-page CSS intact
</success_criteria>

<output>
Create `.planning/phases/01-dependencies-data-foundation/01-SUMMARY.md` when done
</output>
