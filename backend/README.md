# AltContext Backend

Backend service for email capture and marketing intelligence workflows.

## Commands

- `make -C backend dev` starts local Postgres and the API server in watch mode.
- `make -C backend check` runs typecheck, lint, and format checks.
- `make -C backend test` runs backend unit/integration/database tests.
- `make -C backend migrate` creates/applies Prisma dev migrations.
- `make -C backend rollups-run` recomputes recent daily rollups.
- `make -C backend rollups-backfill ARGS='--from=YYYY-MM-DD --to=YYYY-MM-DD'` backfills a date range.
- `make -C backend rollups-status` prints rollup freshness for the default property.
- `make -C backend rollups-discrepancy ARGS='--from=YYYY-MM-DD --to=YYYY-MM-DD [--property-id=id]'` checks raw vs rollup count drift.
- `make -C backend rollups-mv-init` creates the optional materialized-view read model.
- `make -C backend rollups-mv-refresh` refreshes the optional materialized view.
- `make -C backend fly-deploy` runs gates and deploys to Fly.io.

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

- Configure `CORS_ALLOWED_ORIGINS` as a comma-separated allowlist for frontend hosts.
- `POST /v1/leads/delete` requires the `x-admin-key` header matching `ADMIN_API_KEY`.
- `GET /v1/metrics/summary` requires the same `x-admin-key`/`ADMIN_API_KEY` admin auth.
