---
phase: 01-dependencies-data-foundation
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - backend/ent/schema/page.go
  - backend/ent/ (generated — page.go, page/, pagecreate/, pageupdate/, etc.)
autonomous: true
requirements: [DATA-01, DATA-02, DATA-03]
estimate:
  tokens: 35000
  raw_tokens: 18000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "backend/ent/schema/page.go exists and defines a Page ent.Schema with fields: slug, title, visibility, content_type, content_html, content_react, enabled, created_at, updated_at"
    - "page.go uses entsql.Annotation{Table: \"pages\"} (mirroring existing schema style)"
    - "page.go marks created_at as Immutable() with timestamptz SchemaType; updated_at uses UpdateDefault(time.Now)"
    - "page.go defines a unique index on slug"
    - "go generate ./ent succeeds and generates ent/page.go + ent/page/ package"
    - "make vet exits 0"
    - "make test-unit exits 0 (existing backend tests pass unchanged)"
    - "make migrate creates a pages table; re-running make migrate is a no-op (idempotent)"
    - "Existing page_views, feature_clicks, system_meta tables are unchanged after migrate"
  artifacts:
    - "backend/ent/schema/page.go"
    - "backend/ent/page.go"
    - "backend/ent/page/"
    - "backend/ent/pagecreate/"
    - "backend/ent/pageupdate/"
  key_links:
    - "Page schema registered in ent/schema/ → ent generate produces Page client → migrate creates pages table"
---

<objective>
Add the `page` Ent schema for dynamic pages, regenerate the Ent client, and migrate the database via the explicit `-migrate` flag — without touching existing telemetry/system_meta tables.

Purpose: Phase 1 foundation — Phases 2 (backend APIs) and 3 (frontend registry) depend on the pages table existing. The schema mirrors existing conventions (page_view.go style) so the codebase stays consistent.
Output: ent/schema/page.go (new), regenerated ent client code, pages table in PostgreSQL.
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
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/STRUCTURE.md
@backend/ent/schema/page_view.go
@backend/ent/schema/feature_click.go
@backend/ent/schema/system_meta.go
@backend/cmd/server/main.go
@backend/Makefile
</context>

<tasks>

<task type="tracer">
  <name>Task 1: Create page Ent schema (foundation tracer)</name>
  <files>backend/ent/schema/page.go</files>
  <read_first>
    - backend/ent/schema/page_view.go (style template — entsql.Annotation, Chinese comments, timestamptz, Immutable, index.Fields)
    - backend/ent/schema/feature_click.go (second style reference)
    - backend/ent/schema/system_meta.go (third style reference)
    - .planning/phases/01-dependencies-data-foundation/01-RESEARCH.md (Section 4.2 — exact page.go schema definition)
  </read_first>
  <action>
    Create backend/ent/schema/page.go defining a Page ent.Schema. Mirror the existing page_view.go style exactly: package schema with Chinese doc comment referencing dynamic page management; entsql.Annotation{Table: "pages"}; fields with Chinese comments — slug (String, MaxLen 128, NotEmpty), title (String, MaxLen 256, NotEmpty), visibility (String, MaxLen 16, Default "public"), content_type (String, MaxLen 16, Default "html"), content_html (String, Optional, text SchemaType for postgres), content_react (String, Optional, text SchemaType), enabled (Bool, Default true), created_at (Time, Default time.Now, Immutable, timestamptz SchemaType), updated_at (Time, Default time.Now, UpdateDefault time.Now, timestamptz SchemaType). Edges() returns nil. Indexes() returns unique index on slug + index on visibility + index on enabled. The page table is MUTABLE (CRUD) — do NOT apply Immutable() to updated_at (only created_at is immutable). Use the exact schema definition from RESEARCH.md Section 4.2.
  </action>
  <verify>
    <automated>test -f backend/ent/schema/page.go</automated>
    <automated>grep -q 'entsql.Annotation{Table: "pages"}' backend/ent/schema/page.go</automated>
    <automated>grep -q 'field.String("slug")' backend/ent/schema/page.go</automated>
    <automated>grep -q 'field.String("content_html")' backend/ent/schema/page.go</automated>
    <automated>grep -q 'field.Bool("enabled")' backend/ent/schema/page.go</automated>
    <automated>grep -q 'Immutable()' backend/ent/schema/page.go</automated>
    <automated>grep -q 'index.Fields("slug").Unique()' backend/ent/schema/page.go</automated>
    <automated>cd backend && go vet ./ent/schema/ exits 0</automated>
  </verify>
  <done>
    backend/ent/schema/page.go exists, mirrors page_view.go style, defines all 9 fields with correct types + a unique slug index, go vet on schema package passes.
  </done>
</task>

<task type="auto">
  <name>Task 2: Regenerate Ent client</name>
  <files>backend/ent/ (generated: page.go, page/, pagecreate/, pageupdate/, client.go, migrate/schema.go, etc.)</files>
  <read_first>
    - backend/ent/schema/page.go (the schema just created)
    - backend/ent/generate.go (the go:generate directive — confirm command)
    - backend/ent/client.go (existing client to see how schemas register)
  </read_first>
  <action>
    In backend/, run `go generate ./ent`. This regenerates the entire ent client including the new Page schema: creates ent/page.go (Page entity), ent/page/ (query builders), ent/pagecreate/ (create builder), ent/pageupdate/ (update builder), ent/pagedelete/ (delete builder), updates ent/client.go to register Page, updates ent/migrate/schema.go to include the pages table. If generate fails, fix compile errors in page.go (common: missing import, wrong field type) and re-run. Do NOT hand-edit generated files.
  </action>
  <verify>
    <automated>cd backend && go generate ./ent exits 0</automated>
    <automated>test -f backend/ent/page.go</automated>
    <automated>test -d backend/ent/page</automated>
    <automated>test -d backend/ent/pagecreate</automated>
    <automated>grep -q 'Page' backend/ent/client.go</automated>
    <automated>grep -q 'pages' backend/ent/migrate/schema.go</automated>
    <automated>cd backend && make vet exits 0</automated>
    <automated>cd backend && make test-unit exits 0 (existing tests pass — no regression from new schema)</automated>
  </verify>
  <done>
    go generate ./ent succeeds; ent/page.go + ent/page/ + ent/pagecreate/ + ent/pageupdate/ exist; client.go registers Page; migrate/schema.go includes pages; make vet + make test-unit pass.
  </done>
</task>

<task type="auto">
  <name>Task 3: Migrate database + verify idempotency + verify existing tables untouched</name>
  <files>backend/ent/migrate/schema.go (generated, already in Task 2)</files>
  <read_first>
    - backend/cmd/server/main.go (lines ~43, 60, 186 — the -migrate flag mechanism: flag.Bool("migrate", false, ...), migrate.NewSchema(drv).Create(ctx), then exit)
    - backend/Makefile (the migrate target wrapping go run ./cmd/server -migrate)
    - .planning/phases/01-dependencies-data-foundation/01-RESEARCH.md (Section 4.3-4.4 — migrate command + safety verification)
  </read_first>
  <action>
    Ensure a dev PostgreSQL is running (the local aux-pg container at 127.0.0.1:15433, per README). In backend/, run `make migrate` once to create the pages table. Then run `make migrate` a SECOND time to verify idempotency (ent auto-migrate is additive — second run should be a no-op, no errors). After migrate, connect to the dev DB and verify: (1) \d pages shows all 9 columns (id, slug, title, visibility, content_type, content_html, content_react, enabled, created_at, updated_at) + unique index on slug; (2) \d page_views is unchanged (still has page_id, visitor_id, is_admin, created_at); (3) \d feature_clicks unchanged; (4) \d system_meta unchanged. If any existing table altered, STOP — this is a regression (ent should only add the new table).
  </action>
  <verify>
    <automated>cd backend && make migrate exits 0</automated>
    <automated>cd backend && make migrate exits 0 (second run — idempotency)</automated>
    <automated>cd backend && make test-unit exits 0</automated>
    <automated>PGPASSWORD=aux psql -h 127.0.0.1 -p 15433 -U aux -d auxdb -c "\d pages" exits 0 and output contains slug, title, visibility, content_type, content_html, content_react, enabled, created_at, updated_at</automated>
    <automated>PGPASSWORD=aux psql -h 127.0.0.1 -p 15433 -U aux -d auxdb -c "\d page_views" exits 0 and output contains page_id, visitor_id, is_admin, created_at (unchanged)</automated>
    <automated>PGPASSWORD=aux psql -h 127.0.0.1 -p 15433 -U aux -d auxdb -c "\d feature_clicks" exits 0 and output contains page_id, feature_id, visitor_id, is_admin, created_at (unchanged)</automated>
    <automated>PGPASSWORD=aux psql -h 127.0.0.1 -p 15433 -U aux -d auxdb -c "\d system_meta" exits 0 and output contains key, value (unchanged)</automated>
  </verify>
  <done>
    make migrate creates pages table with all 9 fields + unique slug index; second make migrate is a no-op (idempotent); page_views/feature_clicks/system_meta tables unchanged; make test-unit passes.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| DB migration → existing data | New pages table creation must not alter/drop existing telemetry tables |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-01-03 | Tampering | ent auto-migrate touching existing tables | high | mitigate | ent auto-migrate is additive by design; verify with \d on all 4 tables post-migrate; existing page_views/feature_clicks/system_meta must be byte-identical in schema |
| T-01-04 | Repudiation | pages table has no audit trail for CRUD | low | accept | Audit trail deferred — Phase 2 service layer handles CRUD; telemetry (page_views) is separate append-only concern. v1 accepts no page-edit audit log. |
| T-01-05 | Information Disclosure | content_html/content_react stored as plaintext text | low | accept | Content is admin-authored page HTML/React, not user PII; stored as text is appropriate. Size limit (256KB) enforced in Phase 2 service layer. |
</threat_model>

<verification>
- cd backend && make vet (go vet passes)
- cd backend && make test-unit (existing tests pass — no regression)
- cd backend && make migrate (creates pages table)
- cd backend && make migrate (second run — idempotent no-op)
- psql \d pages (9 fields + unique slug index)
- psql \d page_views, \d feature_clicks, \d system_meta (all unchanged)
</verification>

<success_criteria>
- page Ent schema exists mirroring existing style (9 fields, unique slug index, Immutable created_at, UpdateDefault updated_at)
- go generate ./ent succeeds; client code regenerated
- make vet + make test-unit pass (no regression)
- make migrate creates pages table idempotently
- Existing telemetry + system_meta tables untouched
</success_criteria>

<output>
Create `.planning/phases/01-dependencies-data-foundation/02-SUMMARY.md` when done
</output>
