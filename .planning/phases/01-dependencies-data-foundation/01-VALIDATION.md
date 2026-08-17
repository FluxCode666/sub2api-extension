---
phase: 1
slug: dependencies-data-foundation
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-18
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (frontend) + go test (backend) — both existing |
| **Config file** | `frontend/vite.config.ts` (vitest inline) / `backend/Makefile` (go test) |
| **Quick run command** | `cd frontend && pnpm test` (frontend) / `cd backend && make test-unit` (backend) |
| **Full suite command** | `cd frontend && pnpm test && pnpm typecheck` + `cd backend && make vet && make test-unit` |
| **Estimated runtime** | ~30 seconds (frontend ~20s, backend ~10s) |

---

## Sampling Rate

- **After every task commit:** Run the relevant quick command (frontend deps task → `pnpm test`; backend schema task → `make test-unit`)
- **After every plan wave:** Run full suite command (both frontend + backend)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

Phase 1 is a foundation phase — its validation is primarily **regression** (existing suites stay green) plus **smoke** (new deps render, new table exists). Per-task map will be finalized when PLAN.md tasks are defined, but the verification approach per requirement:

| Requirement | Verification Type | Automated Command | Manual Check |
|-------------|-------------------|-------------------|--------------|
| DEP-01 (shadcn init, no regression) | regression + smoke | `pnpm test && pnpm typecheck && pnpm build` | Visit `/`, `/admin/dashboard`, `/admin/homepage` — visual parity + dark toggle |
| DEP-02 (shadcn components added) | smoke | `pnpm typecheck` (all ui/* resolve) | Render `<Button>` in scratch route |
| DEP-03 (gsap installed) | smoke | `pnpm typecheck` | Render `useGSAP` animation in scratch route |
| DEP-04 (monaco installed) | smoke | `pnpm typecheck` (types resolve) | Dynamic import resolves (full editor in Phase 5) |
| DATA-01 (page schema) | unit (compile) | `go generate ./ent && make vet` | `ent/page.go` generated |
| DATA-02 (regen, no break) | regression | `make test-unit` | Existing ent tests pass |
| DATA-03 (migrate idempotent) | integration | `make migrate && make migrate` (twice) | `\d pages` shows table; `\d page_views` unchanged |

---

## Wave 0 Requirements

Phase 1 uses **existing** test infrastructure — no Wave 0 stubs needed.

- [x] `frontend/vite.config.ts` — vitest configured (existing)
- [x] `backend/Makefile` — `test-unit` target (existing)
- [x] `backend/ent/enttest/` — ent test helpers (existing)

*Existing infrastructure covers all phase requirements. No new test files created in Phase 1 — this is a foundation phase; tests for new code come in Phases 2-6.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TERALEMO homepage visual parity | DEP-01 | Visual regression not automatable in vitest | `pnpm dev` → visit `/` → compare to pre-change (layout, colors, animations, dark mode) |
| Dashboard/config render in dark mode | DEP-01 | Visual | Visit `/admin/dashboard` + `/admin/homepage` → toggle dark mode → no broken styles |
| shadcn Button renders | DEP-02 | Smoke (runtime render) | Scratch route with `<Button>Click</Button>` → renders, no console error |
| gsap animation plays | DEP-03 | Runtime animation | Scratch route with `useGSAP` → element animates, no error, cleans up on unmount |
| `pages` table schema correct | DATA-01/03 | DDL inspection | `psql ... \d pages` → 9 fields (id/slug/title/visibility/content_type/content_html/content_react/enabled/created_at/updated_at) + unique slug index |
| Existing tables untouched | DATA-02 | DDL inspection | `\d page_views`, `\d feature_clicks`, `\d system_meta` → unchanged from pre-migrate |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies (existing suites cover regression)
- [x] Sampling continuity: every task runs at least `typecheck`/`vet` (no 3-task gap)
- [x] Wave 0 covers all MISSING references (none missing — existing infra)
- [x] No watch-mode flags (commands use `run`, not `watch`)
- [x] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter (set after plan tasks defined + verified)

**Approval:** pending (seeded by plan-phase; finalized when PLAN.md tasks align with this map)
