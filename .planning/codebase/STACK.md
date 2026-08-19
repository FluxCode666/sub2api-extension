# Technology Stack

**Analysis Date:** 2026-08-18

## Languages

**Primary:**
- Go 1.26.5 - Backend HTTP server, ORM, business logic, sub2api integration (`backend/`)
- TypeScript ~5.6.0 - Frontend SPA, API client, telemetry SDK (`frontend/src/`)

**Secondary:**
- SQL (PostgreSQL dialect) - Ent-generated schema/migrations, raw `timestamptz`/`text` types defined in `backend/ent/schema/`
- CSS (Tailwind utility classes) - Styling via `frontend/src/index.css` + `frontend/tailwind.config.js`
- YAML - Docker Compose (`deploy/docker-compose*.yml`), CI workflows (`.github/workflows/`), config example (`deploy/config.example.yaml`)
- Dockerfile syntax - Multi-stage build at `Dockerfile`

## Runtime

**Environment:**
- Go 1.26.5 (backend runtime; locked and verified in CI via `go version | grep -q 'go1.26.5'` in `.github/workflows/ci.yml`)
- Node.js 20 (frontend build + CI; `node-version: '20'` in `.github/workflows/ci.yml`). Dockerfile builder uses `node:24-alpine` for the image build stage.
- PostgreSQL 18 (`postgres:18-alpine` in `deploy/docker-compose.yml`); production points at external PostgreSQL (no DB image in `deploy/docker-compose.prod.yml`)
- Alpine Linux 3.21 (`alpine:3.21` final runtime image in `Dockerfile`)

**Package Manager:**
- Go modules (`backend/go.mod`, `backend/go.sum`) - module name `sub2api-extension`
- pnpm 9 (frontend; pinned via corepack in `Dockerfile`, `pnpm/action-setup@v4` in CI). Lockfile: `frontend/pnpm-lock.yaml` (present)

## Frameworks

**Core:**
- Gin `github.com/gin-gonic/gin` v1.12.0 - HTTP router/middleware (`backend/internal/server/router.go`, `backend/internal/handler/`)
- Ent ORM `entgo.io/ent` v0.14.6 - Code-generated data layer; schemas in `backend/ent/schema/`, generated code in `backend/ent/` (e.g. `backend/ent/client.go`)
- React 18 `react` ^18.3.1 + `react-dom` ^18.3.1 - SPA UI (`frontend/src/`)
- react-router-dom `^6.26.0` - Client routing (`frontend/src/App.tsx`, `frontend/src/main.tsx`)
- Vite `^5.0.10` (`@vitejs/plugin-react` ^4.3.1) - Dev server + bundler (`frontend/vite.config.ts`)
- Tailwind CSS `^3.4.0` - Utility CSS (`frontend/tailwind.config.js`, `frontend/postcss.config.js` with `autoprefixer` ^10.4.16)
- Viper `github.com/spf13/viper` v1.21.0 - Config loading (env + YAML) in `backend/internal/config/config.go`

**Testing:**
- Go testing (`testing` stdlib) + `github.com/stretchr/testify` v1.11.1 - Backend unit/integration tests
- Vitest `^2.1.9` - Frontend test runner (`frontend/vite.config.ts` test block, `frontend/src/test-setup.ts`)
- `@testing-library/react` ^16.3.2 + `@testing-library/jest-dom` ^6.4.0 + `@testing-library/user-event` ^14.6.4 - Component tests
- jsdom `^24.1.3` - DOM environment for Vitest (`environment: 'jsdom'`)

**Build/Dev:**
- Vite build (`pnpm run build` = `tsc -b && vite build --config vite.config.ts`) - Frontend production bundle to `frontend/dist/`
- `go build` with CGO disabled, ldflags injecting version/commit/date (`backend/Makefile` `build` target, `Dockerfile` Stage 2)
- Docker Buildx multi-arch (`linux/amd64,linux/arm64`) in `.github/workflows/deploy-test.yml` and `.github/workflows/deploy-production.yml`
- govulncheck (backend security), `pnpm audit --prod --audit-level=high` (frontend security) in `.github/workflows/security-scan.yml`

## Key Dependencies

**Critical:**
- `github.com/golang-jwt/jwt/v5` v5.3.1 - Signs/validates the sub2api-extension admin session JWT (HS256) in `backend/internal/service/auth_service.go`; frontend validates expiry client-side in `frontend/src/lib/admin-auth.ts`
- `github.com/lib/pq` v1.12.3 - PostgreSQL driver imported in `backend/cmd/server/main.go` (`_ "github.com/lib/pq"`); DSN built in `backend/internal/config/config.go` `DatabaseConfig.DSN()`
- `github.com/spf13/viper` v1.21.0 - Env-first config with YAML fallback; see `Load()` / `LoadFromEnv()` in `backend/internal/config/config.go`
- `golang.org/x/time` v0.15.0 - `rate.Limiter` token bucket for per-IP throttling on telemetry endpoints (`backend/internal/server/middleware/telemetry_guard.go`)
- `entgo.io/ent` v0.14.6 - Entire data layer (telemetry write + analytics aggregate + system_meta homepage config)

**Infrastructure:**
- `github.com/gin-gonic/gin` v1.12.0 - Request pipeline, JSON binding (`ShouldBindJSON`), `gin.Logger`/`gin.Recovery`
- `github.com/go-playground/validator/v10` v10.30.1 (transitive via Gin) - Request struct validation (`binding:"required,email"`)
- `github.com/google/uuid` v1.3.0 (transitive) - Used by Ent; frontend generates visitor IDs via `crypto.randomUUID()` in `frontend/src/lib/visitor-id.ts`
- `react-router-dom` ^6.26.0 - `BrowserRouter` + `Routes`/`Route`; guard via `AdminGuard` component at `frontend/src/components/AdminGuard.tsx`

## Configuration

**Environment:**
- Primary source: environment variables (viper `AutomaticEnv()` with `.` → `_` replacer). Docker Compose injects all via `environment:` blocks in `deploy/docker-compose.yml` and `deploy/docker-compose.prod.yml`.
- Secondary: optional `config.yaml` (searched in `.` and `./config/`) - see `deploy/config.example.yaml`.
- Required keys validated in `backend/internal/config/config.go` `validate()`: `database.host/user/dbname/port`, `jwt.secret`, `sub2api.base_url`.
- Defaults set in `setDefaults()`: server port `8787`, host `0.0.0.0`, mode `debug`; db port `5432`, sslmode `disable`; jwt expire `24h`.

**Build:**
- `backend/Makefile` - `dev`, `migrate`, `build`, `test`, `test-unit`, `test-integration`, `vet`, `fmt`, `tidy`. Version from `backend/cmd/server/VERSION` (currently `0.1.0`).
- `frontend/vite.config.ts` - dev server on `0.0.0.0:3100`, proxies `/api` → `http://127.0.0.1:8004` (backend dev port from Makefile `DEV_SERVER_PORT=8004`).
- `frontend/tsconfig.json` - strict mode, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, path alias `@/*` → `src/*`, `moduleResolution: bundler`, `jsx: react-jsx`.
- `Dockerfile` - 3-stage multi-arch build: pnpm frontend build → Go backend build (CGO disabled) → Alpine runtime embedding frontend dist at `/app/frontend/dist` (env `AUX_FRONTEND_DIST=/app/frontend/dist`).

## Platform Requirements

**Development:**
- Go 1.26.5, Node 20, pnpm 9, local PostgreSQL on `127.0.0.1:15433` (per Makefile defaults; brought up via `deploy/docker-compose.yml` `aux-postgres` service host port `15433`).
- `make dev` runs `go run ./cmd/server` on port `8004`; `make migrate` runs `go run ./cmd/server -migrate` (ent auto-migration, one-shot table creation).
- Frontend: `pnpm install` then `pnpm dev` (port 3100, proxies `/api` to backend 8004).

**Production:**
- Single Docker image `ghcr.io/<owner>/sub2api-extension:<tag>` (multi-arch amd64/arm64) built by `.github/workflows/deploy-test.yml` or `.github/workflows/deploy-production.yml`, pushed to GHCR.
- Runtime: Alpine 3.21, non-root user `aux` (uid/gid 1000), `libpq` + `ca-certificates` + `tzdata` installed.
- Backend serves SPA same-origin from `/app/frontend/dist` (avoids CORS); listens on `8787` (Dockerfile `EXPOSE 8787`).
- External PostgreSQL required in prod compose (not bundled); `SUB2API_BASE_URL` must point at a reachable sub2api backend.
- Health check: `GET /health` → `{"status":"ok","service":"sub2api-extension"}` (Dockerfile `HEALTHCHECK` uses `wget` against `localhost:8787/health`).

---

*Stack analysis: 2026-08-18*
