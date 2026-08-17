# Plan 02 Summary: Backend Schema

**Phase:** 1 — Dependencies & Data Foundation
**Plan:** 02 — backend-schema
**Status:** Complete
**Date:** 2026-08-18

## What Was Built

Added the `page` Ent schema for dynamic pages, regenerated the Ent client, and migrated the database via the explicit `-migrate` flag — without touching existing telemetry/system_meta tables.

### Artifacts Created
- `backend/ent/schema/page.go` — Page entity schema (9 fields: slug/title/visibility/content_type/content_html/content_react/enabled/created_at/updated_at), mirrors page_view.go style (entsql.Annotation{Table:"pages"}, Chinese comments, timestamptz, Immutable created_at, UpdateDefault updated_at, unique slug index)
- `backend/ent/page.go` + `ent/page/` + `ent/page_create.go` + `ent/page_delete.go` + `ent/page_query.go` + `ent/page_update.go` (generated client code)

### Files Modified (generated)
- `backend/ent/client.go`, `ent.go`, `mutation.go`, `tx.go`, `runtime.go`, `hook/hook.go`, `predicate/predicate.go`, `migrate/schema.go` (ent regen output)
- `backend/go.sum` (minor additions from go mod tidy during generate)

## Deviations from Plan

1. **`make migrate` requires `SUB2API_BASE_URL`** — the Makefile migrate target doesn't set it; config validation rejects startup without it. Fixed by `export SUB2API_BASE_URL=http://127.0.0.1:8003` before `make migrate`. (Not a plan defect — environment setup.)

## Verification

- `go vet ./ent/schema/` — exit 0 ✓
- `go generate ./ent` — succeeds, all page.* files generated ✓
- `make vet` — exit 0 ✓
- `make test-unit` — all packages ok (config, handler, handler/admin, integration, server, server/middleware, service) ✓
- `make migrate` (1st) — "Migration completed successfully" ✓
- `make migrate` (2nd) — "Migration completed successfully" (idempotent no-op) ✓
- `pages` table: 9 columns (id/slug/title/visibility/content_type/content_html/content_react/enabled/created_at/updated_at) + UNIQUE(slug) + idx(visibility) + idx(enabled) ✓
- `page_views`, `feature_clicks`, `system_meta` — schemas unchanged (additive migration) ✓

## Requirements Covered

DATA-01 (page schema), DATA-02 (regen, no break), DATA-03 (migrate idempotent)
