# AltContext Backend

Backend service for email capture and marketing intelligence workflows.

## Commands

- `make -C backend dev` starts local Postgres and the API server in watch mode.
- `make -C backend check` runs typecheck, lint, and format checks.
- `make -C backend test` runs backend unit/integration/database tests.
- `make -C backend migrate` creates/applies Prisma dev migrations.
- `make -C backend fly-deploy` runs gates and deploys to Fly.io.

## Runtime Contract

- `GET /v1/healthz`
- `POST /v1/events`
- `POST /v1/leads/capture`
- `POST /v1/leads/unsubscribe`
- `POST /v1/leads/delete`

## Privacy Contact

- `privacy@altcontext.local`

## Security and Browser Access

- Configure `CORS_ALLOWED_ORIGINS` as a comma-separated allowlist for frontend hosts.
- `POST /v1/leads/delete` requires the `x-admin-key` header matching `ADMIN_API_KEY`.
