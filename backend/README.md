# AltContext Backend

Backend service for email capture and marketing intelligence workflows.

## Commands

- `make -C backend dev` starts local Postgres and the API server in watch mode.
- `make -C backend check` runs typecheck, lint, and format checks.
- `make -C backend test` runs backend unit/integration/database tests.
- `make -C backend migrate` creates/applies Prisma dev migrations.
- `make -C backend migrate-reset` resets the local DB and reapplies migrations.
- `make -C backend rollups-run` recomputes recent daily rollups.
- `make -C backend rollups-backfill ARGS='--from=YYYY-MM-DD --to=YYYY-MM-DD'` backfills a date range.
- `make -C backend rollups-status` prints rollup freshness for the default property.
- `make -C backend rollups-discrepancy ARGS='--from=YYYY-MM-DD --to=YYYY-MM-DD [--property-id=id]'` checks raw vs rollup count drift.
- `make -C backend rollups-mv-init` creates the optional materialized-view read model.
- `make -C backend rollups-mv-refresh` refreshes the optional materialized view.
- `make -C backend fly-deploy` runs gates and deploys to Fly.io.
- `make -C backend deploy` is an alias for Fly deploy (works from `backend/` and runs deploy from repo root so `fly.toml` + Docker build context resolve correctly).
- `make -C backend fly-auth-secrets BOOTSTRAP_TENANT_ID=<uuid> BOOTSTRAP_USER_EMAIL=<email>` sets dashboard auth secrets (prompts for password if unset, enforces minimum 12 chars).
- `make -C backend fly-auth-password-reset` rotates only `BOOTSTRAP_USER_PASSWORD` (prompts if not passed as `BOOTSTRAP_USER_PASSWORD=...`).
- `make -C backend fly-auth-password-unset` removes bootstrap password secrets and forces reconfiguration before deploy.
- `make -C backend fly-migrations-check` blocks deploy when Fly DB has fewer applied migrations than the local migration set.
- `make -C backend fly-secrets-check` verifies required Fly secrets (`DATABASE_URL`, `IP_HASH_PEPPER`, `SESSION_SECRET`, `BOOTSTRAP_TENANT_ID`, `BOOTSTRAP_USER_EMAIL`, `BOOTSTRAP_USER_PASSWORD`, `BOOTSTRAP_USER_PASSWORD_POLICY`) and, when a machine is running, validates runtime bootstrap password length.
- `make -C backend fly-start-stopped` starts any stopped Fly machines for the app.

## Prisma CLI Env Contract

- Prisma CLI reads `backend/.env` via `backend/prisma.config.ts`.
- `DATABASE_URL` should include an explicit DB role/user (`postgresql://<role>@host:port/db`) to avoid local auth ambiguity.
- `npm run migrate:reset`, `npm run migrate:status`, and `npm run migrate:deploy` work locally without exporting `DATABASE_URL` if `backend/.env` is populated.
- For remote targets (for example Fly Postgres through a proxy), override with an explicit `DATABASE_URL=... npx prisma migrate deploy`.

## Dashboard Login Workflow

- Keep `BOOTSTRAP_TENANT_ID`, `BOOTSTRAP_USER_EMAIL`, and `BOOTSTRAP_USER_PASSWORD` set as Fly secrets for recurring dashboard login.
- Password policy is enforced at secret-write time through `make -C backend fly-auth-secrets` / `make -C backend fly-auth-password-reset` (minimum 12 chars).
- On startup, the backend ensures the bootstrap user exists and synchronizes its password hash from `BOOTSTRAP_USER_PASSWORD`.
- Rotate password: `make -C backend fly-auth-password-reset`.
- Unset password (break-glass): `make -C backend fly-auth-password-unset`, then set a new one and redeploy.

## Runtime Contract

- `GET /v1/healthz`
- `POST /v1/events`
- `POST /v1/leads/capture`
- `POST /v1/leads/unsubscribe`
- `POST /v1/leads/delete`
- `GET /v1/metrics/summary`

## Privacy Contact

- `privacy@altcontext.local`

## Security and Browser Access

- Configure `CORS_ALLOWED_ORIGINS` as a comma-separated allowlist for static site and dashboard hosts.
- `POST /v1/leads/delete` requires the `x-admin-key` header matching `ADMIN_API_KEY`.
- `GET /v1/metrics/summary` requires the same `x-admin-key`/`ADMIN_API_KEY` admin auth.
