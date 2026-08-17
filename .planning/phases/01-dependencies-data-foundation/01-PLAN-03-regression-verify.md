---
phase: 01-dependencies-data-foundation
plan: 03
type: execute
wave: 2
depends_on: [01, 02]
files_modified: []
autonomous: false
requirements: [DEP-01, DATA-02]
estimate:
  tokens: 20000
  raw_tokens: 10000
  tasks: 2
  confidence: high

must_haves:
  truths:
    - "The existing TERALEMO homepage, dashboard, and config center render unchanged (no regression) after all Phase 1 dependencies are installed"
    - "shadcn Button renders at runtime without console errors"
    - "GSAP useGSAP animation plays at runtime and cleans up on unmount"
    - "Monaco editor package is dynamically importable without error"
    - "pages table exists in DB with all 9 fields; existing page_views/feature_clicks/system_meta tables unchanged"
  artifacts: []
  key_links:
    - "Phase 1 foundation verified ready for Phase 2 (backend APIs) and Phase 4 (sidebar UI)"
---

<objective>
Verify the Phase 1 foundation is stable: run the full test suites (frontend + backend), confirm no regression in existing pages, and smoke-test that the new dependencies (shadcn, GSAP, Monaco) actually work at runtime. This is the gate before Phase 2 begins.

Purpose: Phase 1 is foundation work — its "feature" is a stable, non-regressed base. This plan proves that base exists. Without it, Phases 2-6 build on sand.
Output: Verification evidence (test output, manual smoke checklist completed) recorded in SUMMARY.md.
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
@.planning/phases/01-dependencies-data-foundation/01-VALIDATION.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Run full regression suites (frontend + backend)</name>
  <files></files>
  <read_first>
    - frontend/package.json (verify scripts: test, typecheck, build)
    - backend/Makefile (verify targets: vet, test-unit)
    - .planning/phases/01-dependencies-data-foundation/01-VALIDATION.md (verification map)
  </read_first>
  <action>
    Run the complete frontend regression suite: cd frontend && pnpm test (expect 129 passing — the live-measured pre-Phase-1 baseline), then pnpm typecheck (tsc --noEmit), then pnpm build (tsc -b && vite build). Run the complete backend regression suite: cd backend && make vet, then make test-unit (go test -race, skips integration without DB env). Capture all output. If ANY test fails, STOP — this is a regression from Plan 01 (shadcn/gsap/monaco) or Plan 02 (ent schema) and must be fixed before proceeding. Do not mark this task done with failing tests. Note: verify via exit code (pnpm test exits 0), not by grepping a literal count — the count may grow as Phase 1 adds no tests but future phases will.
  </action>
  <verify>
    <automated>cd frontend && pnpm test exits 0</automated>
    <automated>cd frontend && pnpm typecheck exits 0</automated>
    <automated>cd frontend && pnpm build exits 0</automated>
    <automated>cd backend && make vet exits 0</automated>
    <automated>cd backend && make test-unit exits 0</automated>
  </verify>
  <done>
    All frontend tests pass (exit 0; 129-test pre-Phase-1 baseline preserved), typecheck passes, build passes; backend vet passes, test-unit passes. No regression.
  </done>
</task>

<task type="auto">
  <name>Task 2: Automated environment setup + DB schema verification</name>
  <files></files>
  <read_first>
    - .planning/phases/01-dependencies-data-foundation/01-VALIDATION.md (Manual-Only Verifications table — the psql checks belong here as automated)
    - backend/Makefile (migrate target, dev target)
    - backend/cmd/server/main.go (the -migrate flag mechanism)
  </read_first>
  <action>
    Set up the verification environment (Claude runs this, not the human). Ensure the local aux-pg container is running at 127.0.0.1:15433 (start it if not: docker run -d --name aux-pg ... per README). Verify the pages table schema and that existing tables are unchanged by running psql schema assertions: \d pages (must show 9 fields: id/slug/title/visibility/content_type/content_html/content_react/enabled/created_at/updated_at + unique slug index), \d page_views (unchanged: page_id/visitor_id/is_admin/created_at), \d feature_clicks (unchanged: page_id/feature_id/visitor_id/is_admin/created_at), \d system_meta (unchanged: key/value). Then verify the new dependencies are importable at runtime via node ESM dynamic imports (gsap, @gsap/react, @monaco-editor/react). Start the frontend dev server in the background (pnpm dev) and backend dev server (make dev) so the human checkpoint can visit pages — leave them running for Task 3.
  </action>
  <verify>
    <automated>PGPASSWORD=aux psql -h 127.0.0.1 -p 15433 -U aux -d auxdb -c "\d pages" exits 0 and output contains slug, title, visibility, content_type, content_html, content_react, enabled, created_at, updated_at</automated>
    <automated>PGPASSWORD=aux psql -h 127.0.0.1 -p 15433 -U aux -d auxdb -c "\d page_views" exits 0 and output contains page_id, visitor_id, is_admin, created_at</automated>
    <automated>PGPASSWORD=aux psql -h 127.0.0.1 -p 15433 -U aux -d auxdb -c "\d feature_clicks" exits 0 and output contains page_id, feature_id, visitor_id, is_admin, created_at</automated>
    <automated>PGPASSWORD=aux psql -h 127.0.0.1 -p 15433 -U aux -d auxdb -c "\d system_meta" exits 0 and output contains key, value</automated>
    <automated>cd frontend && node -e "import('gsap').then(()=>import('@gsap/react')).then(()=>import('@monaco-editor/react')).then(()=>console.log('OK')).catch(e=>{console.error(e);process.exit(1)})" exits 0</automated>
    <automated>curl -sf http://localhost:3100/ exits 0 (frontend dev server responding)</automated>
  </verify>
  <done>
    pages table has all 9 fields + unique slug index; page_views/feature_clicks/system_meta unchanged; gsap + @gsap/react + @monaco-editor/react all importable; frontend dev server running and responding at localhost:3100; environment ready for human visual checkpoint.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking-human">
  <name>Task 3: Visual regression + smoke check (human judgment only)</name>
  <files></files>
  <read_first>
    - .planning/phases/01-dependencies-data-foundation/01-RESEARCH.md (Section 1.7, 2.4, 3.4 — smoke expectations)
    - .planning/phases/01-dependencies-data-foundation/01-VALIDATION.md (Manual-Only Verifications — the visual checks)
  </read_first>
  <what-built>
    Phase 1 foundation: shadcn/ui + GSAP + Monaco installed in frontend, pages Ent schema + migrated table in backend. Task 2 already verified DB schema + dependency imports + started dev servers. This checkpoint is for human visual judgment only — confirming existing pages look unchanged.
  </what-built>
  <how-to-verify>
    The dev servers are already running (Task 2 started them). Open http://localhost:3100/ in a browser and verify:
    1. TERALEMO homepage: layout intact, colors correct, hero/animations play, partner carousel works, theme toggle (light↔dark) works.
    2. Dashboard (/admin/dashboard): renders, charts/cards display, dark mode works.
    3. Config center (/admin/homepage): form renders, dark mode works.
    4. shadcn smoke: temporarily add a &lt;Button&gt; from @/components/ui/button to any page — renders with shadcn styling, no console errors. Remove after test.
    5. GSAP smoke: temporarily add a component using useGSAP + gsap.from — animation plays, cleans up on unmount. Remove after test.
    Report any visual regression (broken layout, missing styles, dark mode broken). If the shadcn init in Plan 01 clobbered config, you may see broken styles here.
  </how-to-verify>
  <resume-signal>Type "approved" if all 5 visual checks pass, or describe any visual/integration issues found</resume-signal>
  <verify>
    <human-check>Manual visual smoke (steps 1-5 above) — homepage/dashboard/config parity + dark mode + shadcn Button renders + gsap animation plays</human-check>
  </verify>
  <done>
    Human confirms via resume-signal: homepage/dashboard/config render with visual parity, dark mode works, shadcn Button renders, gsap animation plays.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| None new | This plan is verification-only — no code changes, no new trust boundaries |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-01-06 | None | Verification plan (read-only) | low | accept | No code changes → no new threats. This plan confirms Plans 01/02 introduced none. |
</threat_model>

<verification>
- Full frontend suite: pnpm test (129-test pre-Phase-1 baseline) + pnpm typecheck + pnpm build
- Full backend suite: make vet + make test-unit
- Manual smoke: homepage/dashboard/config visual parity + dark mode + shadcn render + gsap animation + pages table schema + existing tables unchanged
</verification>

<success_criteria>
- All automated suites green (frontend 129-test baseline preserved, typecheck, build; backend vet, test-unit)
- Manual smoke test confirms no visual regression and new deps work at runtime
- pages table exists with correct schema; existing tables untouched
- Phase 1 foundation declared stable and ready for Phase 2
</success_criteria>

<output>
Create `.planning/phases/01-dependencies-data-foundation/03-SUMMARY.md` when done
</output>
