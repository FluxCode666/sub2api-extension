# External Integrations

**Analysis Date:** 2026-08-18

## APIs & External Services

**sub2api (parent/host system - admin identity provider + iframe host):**
- Used for: verifying admin identity and proxying admin login. sub2api-extension does NOT import any sub2api Go package; it calls sub2api's public HTTP API only.
- SDK/Client: custom `Sub2APIClient` at `backend/internal/integration/sub2api_client.go` (plain `net/http`, 10s timeout, no SDK dependency).
- Auth: forwards the admin's sub2api JWT via `Authorization: Bearer <token>` header to `GET /api/v1/auth/me`; proxies email/password to `POST /api/v1/auth/login`.
- Endpoints consumed (base URL from `SUB2API_BASE_URL`, trailing slash trimmed):
  - `GET  {baseURL}/api/v1/auth/me` - verifies JWT and returns user role; `data.role == "admin"` grants access (`VerifyAdminJWT`).
  - `POST {baseURL}/api/v1/auth/login` - email/password login; returns `access_token`, `refresh_token`, `user`; 2FA branch (`requires_2fa=true`) is rejected by sub2api-extension (`Login`).
- Response envelope mirrored: `{code, message, reason, data}` - see `sub2APIEnvelope` struct. 401 maps to `ErrInvalidToken`/`ErrInvalidCredentials`; network errors wrap `ErrSub2APIUnreachable` (consumed by handler to return 503).
- Iframe embedding: sub2api embeds sub2api-extension via `home_content` URL and `custom_menu_items` (with empty `page_slug` so sub2api appends `user_id`, `token`, `theme`, `lang`, `ui_mode=embedded`, `src_host`, `src_url`). Frontend parses these in `frontend/src/lib/embedded.ts` (`parseEmbeddedParams`).
- Network: same Docker network (`sub2api-network`, declared external) uses `http://sub2api:8080`; cross-network uses sub2api's public domain. See `deploy/docker-compose.dev.yml`, `deploy/docker-compose.yml`, `docs/INTEGRATION.md`.
- Verification cache: `AuthService` caches verification results keyed by SHA-256 of the sub2api token, TTL 5 min (`backend/internal/service/auth_service.go`), to avoid re-hitting sub2api `/auth/me` on every request.

**No other third-party HTTP APIs are consumed.** No Stripe/Supabase/AWS/Stripe/Resend/etc. detected.

## Data Storage

**Databases:**
- PostgreSQL 18 (self-owned, independent of sub2api's DB - "R1 自有数据库")
  - Connection env: `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_DBNAME`, `DATABASE_SSLMODE` (DSN assembled in `backend/internal/config/config.go` `DatabaseConfig.DSN()`; empty password omits the `password=` param).
  - Client: Ent ORM (`entgo.io/ent` v0.14.6) opened with `ent.Open("postgres", dsn)` in `backend/cmd/server/main.go` `initEnt()`. Driver `github.com/lib/pq` v1.12.3. A `database/sql` pool is opened first to `PingContext` before creating the ent client.
  - Dev DB: `aux-postgres` service in `deploy/docker-compose.dev.yml`, host port `127.0.0.1:15433`, db `auxdb`, user `aux`.
  - Prod DB: external (compose has no DB image); may reuse sub2api's postgres or a standalone instance (see `deploy/.env.example`).
  - Migration: ent auto-migration via `go run ./cmd/server -migrate` (Makefile `migrate` target) - `migrate.NewSchema(drv).Create(ctx)` in `main.go` `runMigration()`. NOT run automatically on server start (avoid prod schema drift).
  - Tables (Ent schemas in `backend/ent/schema/`):
    - `page_views` (`page_view.go`) - append-only page-view telemetry: `page_id`(max128), `visitor_id`(max128), `is_admin`(bool), `created_at`(timestamptz, immutable). Indexes on page_id, visitor_id, created_at, (page_id,created_at).
    - `feature_clicks` (`feature_click.go`) - append-only feature-click telemetry: `page_id`, `feature_id`, `visitor_id`, `is_admin`, `created_at`. Indexes on page_id, feature_id, visitor_id, created_at, (page_id,feature_id), (page_id,created_at).
    - `system_meta` (`system_meta.go`) - key/value store (`key` unique max128, `value` text). Currently stores homepage config under key `homepage.config` as JSON (see `backend/internal/service/homepage_config_service.go` `HomepageConfigKey`).

**File Storage:**
- Local filesystem only. Built frontend dist embedded in the Docker image at `/app/frontend/dist` and served same-origin by the backend (`backend/internal/server/router.go` `registerFrontendStatic`, env `SUB2API_EXTENSION_FRONTEND_DIST`). No S3/GCS/blob storage.

**Caching:**
- In-process only. `AuthService` verification cache (`map[string]cachedVerification` guarded by `sync.Mutex`, 5 min TTL) in `backend/internal/service/auth_service.go`. No Redis/Memcached.

## Authentication & Identity

**Auth Provider:**
- sub2api is the identity provider for admins (delegated). sub2api-extension issues its OWN session JWT (two-token model, strictly separated):
  - sub2api JWT: held by user/iframe, forwarded to sub2api `/auth/me` for verification, never persisted by sub2api-extension.
  - sub2api-extension session JWT: signed by sub2api-extension (HS256, `jwt.SigningMethodHS256`), stored in browser `localStorage` under key `aux_admin_session`, sent on guarded requests via `X-Aux-Session` header.
- Implementation: `backend/internal/service/auth_service.go` (`IssueSession`/`ValidateSession`), `backend/internal/server/middleware/admin_guard.go` (validates `X-Aux-Session`).
- Two login paths (both end in sub2api-extension issuing its own session JWT):
  1. Iframe token exchange: `POST /api/aux/admin/session { token }` → `VerifyAdminToken` (forwards to sub2api `/auth/me`, cached). Errors: 403 non-admin, 401 invalid token, 503 sub2api unreachable.
  2. Credentials login: `POST /api/aux/admin/login { email, password }` → `LoginAdmin` (proxies sub2api `/auth/login`). Errors: 401 bad creds, 403 `NOT_ADMIN`, 403 `TWO_FACTOR_REQUIRED` (2FA unsupported, rejected), 503 unreachable.
- JWT config env: `JWT_SECRET` (required; recommend `openssl rand -hex 32`), `JWT_EXPIRE_HOUR` (default 24). Claims: `user_id`, `email`, `username`, `role`, issuer `sub2api-extension`, subject = user id.
- Frontend session handling: `frontend/src/lib/admin-auth.ts` - `exchangeSession`, `loginWithCredentials`, `getAdminSession`, `getAdminSessionToken`, `clearAdminSession`; client-side JWT expiry validation (`decodeJWTExpiry`, rejects alg != HS256 or expired). 10s timeout on session exchange (`SESSION_EXCHANGE_TIMEOUT_MS`).
- Public (non-admin) visitors are anonymous; no auth for public homepage read (`GET /api/aux/homepage/config`) or telemetry ingestion.

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/Datadog/etc.). Errors surface only through Gin `Recovery` middleware (`backend/internal/server/router.go`) and Go `log` package.

**Logs:**
- Go stdlib `log` (stdout). Gin `gin.Logger()` middleware for request logs. Production docker-compose configures `json-file` log driver with rotation (`max-size` 100m, `max-file` 5) in `deploy/docker-compose.yml`.
- No structured logging library; no log levels.

## CI/CD & Deployment

**Hosting:**
- Single Docker container (backend binary + embedded frontend dist) on a single production server. Deployed via `deploy/docker-compose.yml` (`aux-backend` service). Joined to sub2api's external `sub2api-network`.

**CI Pipeline:**
- GitHub Actions, four workflows in `.github/workflows/`:
  - `ci.yml` (on push to `main` + PRs): backend unit tests (`go test -race`), backend lint (`golangci-lint-action@v9` v2.9), frontend test + typecheck + build (pnpm 9 / Node 20). Go version pinned/verified to `1.26.5`.
  - `security-scan.yml` (on PRs + weekly cron Mon 03:00 UTC): backend `govulncheck ./...`, frontend `pnpm audit --prod --audit-level=high`.
  - `deploy-test.yml` (push to `test` or manual): builds `test-<sha7>`/`test-latest` and deploys the isolated test environment.
  - `deploy-production.yml` (`workflow_dispatch` manual, takes `version` input): builds multi-arch image (`linux/amd64,linux/arm64`) with QEMU/Buildx, pushes `${{ ghcr_image }}:<version>` + `:latest` to GHCR, then SSH-deploys (`appleboy/ssh-action@v1`) to the production host: updates `.env` `SUB2API_EXTENSION_IMAGE_TAG`, runs Compose, waits for healthy, and attempts rollback on failure.
- Secrets required for deploy: test Environment `TEST_DEPLOY_HOST`/`TEST_DEPLOY_USER`/`TEST_DEPLOY_PASSWORD` or `TEST_DEPLOY_SSH_KEY`, and production Environment `DEPLOY_HOST`/`DEPLOY_USER`/`DEPLOY_PASSWORD` or `DEPLOY_SSH_KEY`; both use `GHCR_PAT` (read:packages). Optional ports default to 22.
- Image registry: GHCR (`ghcr.io/<owner-lower>/sub2api-extension`). Auth uses `GITHUB_TOKEN` for push, `GHCR_PAT` for prod pull.

## Environment Configuration

**Required env vars:**
- `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_DBNAME` (port defaults 5432, sslmode defaults disable)
- `JWT_SECRET` (required, no default; Compose maps `${SUB2API_EXTENSION_JWT_SECRET:?...}`)
- `SUB2API_BASE_URL` (required; dev default `http://127.0.0.1:8003` per Makefile `DEV_SUB2API_BASE_URL`, prod `http://sub2api:8080`)
- Optional with defaults: `SERVER_HOST` (0.0.0.0), `SERVER_PORT` (8787; dev 8004), `SERVER_MODE` (debug/release), `JWT_EXPIRE_HOUR` (24), `SUB2API_EXTENSION_FRONTEND_DIST` (set in Dockerfile to `/app/frontend/dist`), `TZ` (Asia/Shanghai).
- Compose-only: `SUB2API_EXTENSION_POSTGRES_PASSWORD` (dev compose, required), `SUB2API_EXTENSION_POSTGRES_USER`/`SUB2API_EXTENSION_POSTGRES_DB`/`SUB2API_EXTENSION_POSTGRES_HOST_PORT` (defaults aux/auxdb/15433), `SUB2API_EXTENSION_IMAGE`/`SUB2API_EXTENSION_IMAGE_TAG` (prod compose), `BIND_HOST` (0.0.0.0), `DOCKER_LOG_MAX_SIZE`/`DOCKER_LOG_MAX_FILE` (prod logging).

**Secrets location:**
- `deploy/.env.dev` (dev, gitignored - file exists locally but do NOT commit), `deploy/.env` (prod, created on server from `.env.example`). GitHub Actions secrets for deploy SSH creds + GHCR PAT. No vault/KMS detected.

## Webhooks & Callbacks

**Incoming:**
- None (no webhook receivers). Public HTTP endpoints exposed by sub2api-extension itself:
  - `GET  /health` - health check (public).
  - `GET  /api/aux` - group status (public).
  - `GET  /api/aux/homepage/config` - public homepage config read (anonymous).
  - `POST /api/aux/telemetry/page-view` - anonymous telemetry ingest (rate-limited, body ≤4KB via `TelemetryGuard`).
  - `POST /api/aux/telemetry/feature-click` - anonymous telemetry ingest (same guard).
  - `POST /api/aux/admin/session` - exchange sub2api iframe token for aux session (outside AdminGuard).
  - `POST /api/aux/admin/login` - email/password login via sub2api (outside AdminGuard).
  - `GET  /api/aux/admin/analytics/overview` - aggregated telemetry (AdminGuard).
  - `GET  /api/aux/admin/homepage/config` + `PUT /api/aux/admin/homepage/config` - homepage config read/write (AdminGuard).
  - `GET  /api/aux/admin/examples/status` - example guarded endpoint (AdminGuard).
  - SPA fallback: non-API, non-health paths serve `index.html` when `SUB2API_EXTENSION_FRONTEND_DIST` is set (`backend/internal/server/router.go` NoRoute handler).

**Outgoing:**
- sub2api-extension → sub2api: `GET /api/v1/auth/me`, `POST /api/v1/auth/login` (server-side, from `Sub2APIClient`). No other outbound webhooks.

---

*Integration audit: 2026-08-18*
