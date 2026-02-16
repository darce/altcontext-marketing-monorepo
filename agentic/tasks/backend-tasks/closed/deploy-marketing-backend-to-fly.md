# Deploy Marketing Backend to Fly.io — ✅ SUPERSEDED

> **Status**: Superseded by [`0.4.1.deploy-to-fly.md`](./0.4.1.deploy-to-fly.md), which reflects the post-Prisma-removal architecture (`pg` driver only, 256MB VM). This document is retained for historical context only.

## Problem Statement

The marketing backend is fully implemented locally (Phases 0–2: event ingestion, lead capture, consent management, daily rollups, metrics summary) but has never been deployed. The frontend has zero integration with the backend — no `fetch` calls, no form POSTs, no `sendBeacon`. Until the backend is live, all backend code is untested against real traffic.

## Workflow Principles

- Ship the smallest deployable slice first — health check reachable, then event ingestion, then lead capture.
- No speculative features in the deploy. Only code that exists and passes `make -C backend check` ships.
- Secrets never committed. All sensitive values via `fly secrets set`.
- Canadian region (`yyz` or `yul`) — data sovereignty alignment with PIPEDA.

## Terminology

- **Fly Machine**: A Fly.io micro-VM that runs the backend container.
- **Managed Postgres**: Fly's hosted Postgres service, co-located with the app.
- **Release command**: A migration step that runs before a new version receives traffic.

## Current State Analysis

- Backend compiles, passes typecheck, lint, and tests locally.
- No `fly.toml` exists — `fly launch` has never been run.
- No `Dockerfile` exists — needs to be created for the Node.js + Prisma build.
- Frontend (`frontend/dist/`) deploys to GitHub Pages. CORS env config (`CORS_ALLOWED_ORIGINS`) exists but has no production value set.
- `WebTrafficLog` model (42 columns) is implemented but flagged for deprecation — do NOT block deploy on removing it, but do not create new writes to it post-deploy.
- Materialized view rollups (`rollups:mv:*`) are gated behind `METRICS_USE_MATERIALIZED_VIEW=true` and should remain **off** for initial deploy.

## Proposed Solution

1. Create `Dockerfile` and `fly.toml` for the backend.
2. Provision Fly app + Managed Postgres in Canadian region.
3. Set all required secrets.
4. Deploy with Prisma migration as release command.
5. Verify health check, then smoke-test event and lead endpoints from curl.
6. Update `CORS_ALLOWED_ORIGINS` to include the GitHub Pages domain.
7. Set up cron-equivalent for daily rollup job.

## Patterns to Follow

### Dockerfile (multi-stage)

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### fly.toml essentials

```toml
app = "altcontext-marketing"
primary_region = "yyz"

[build]

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "suspend"
  auto_start_machines = true
  min_machines_running = 0

[deploy]
  release_command = "npx prisma migrate deploy"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

### Secret provisioning

```bash
fly secrets set \
  DATABASE_URL="postgres://..." \
  IP_HASH_PEPPER="$(openssl rand -hex 32)" \
  ADMIN_API_KEY="$(openssl rand -hex 32)" \
  CORS_ALLOWED_ORIGINS="https://<your-github-pages-domain>" \
  PRIVACY_CONTACT_EMAIL="privacy@altcontext.com"
```

## Functions to Change

| File | Line | Change |
|---|---|---|
| `backend/Dockerfile` | new | Create multi-stage Dockerfile |
| `backend/fly.toml` | new | Create Fly.io deployment config |
| `backend/.dockerignore` | new | Exclude `node_modules`, `test/`, `.env*`, `prisma/migrations/*.sql` (keep dir structure) |
| `backend/src/config/env.ts` | — | Verify all env vars have sensible defaults or are required |

## Related Files

| File | Note |
| --- | --- |
| `backend/prisma/schema.prisma` | Must be included in container for `prisma migrate deploy` |
| `backend/package.json` | `build` and `start` scripts define the container entrypoint |
| `backend/src/server.ts` | Must bind `0.0.0.0` (not `localhost`) for Fly proxy |
| `agentic/roadmaps/epics/backend-marketing-server.md` | §10 Fly.io Deployment — source of truth for deployment steps |

---

# Consolidated Checklist

## Completed

- [x] Backend Phases 0–2 implemented and passing locally.
- [x] Health, events, leads, metrics routes implemented.
- [x] CORS, rate limiting, admin auth, Zod validation in place.

## Phase 1: Container and Config (1 day)

- [ ] Create `backend/Dockerfile` (multi-stage: build + runner).
- [ ] Create `backend/.dockerignore`.
- [ ] Create `backend/fly.toml` with Canadian region, release command, health check.
- [ ] Verify `backend/src/server.ts` binds `0.0.0.0:3000`.
- [ ] Verify all required env vars are documented and have defaults where appropriate.
- [ ] Local `docker build` + `docker run` smoke test passes (health endpoint responds).

## Phase 2: Fly Provisioning (1 day)

- [ ] `fly launch` in `backend/` — attach to generated `fly.toml`.
- [ ] `fly postgres create --region yyz` — provision Managed Postgres.
- [ ] `fly postgres attach <pg-app>` — sets `DATABASE_URL` secret.
- [ ] `fly secrets set` for all remaining secrets (see pattern above).
- [ ] `fly deploy` — verify release command runs Prisma migration.
- [ ] `fly checks list` confirms health check passing.

## Phase 3: Smoke Tests and CORS (0.5 days)

- [ ] `curl -X POST https://<app>.fly.dev/v1/events` with test payload — returns 202.
- [ ] `curl -X POST https://<app>.fly.dev/v1/leads/capture` with test email — returns 200.
- [ ] `curl -H "x-admin-key: ..." https://<app>.fly.dev/v1/metrics/summary` — returns rollup data.
- [ ] CORS preflight from GitHub Pages domain succeeds (check `Access-Control-Allow-Origin`).
- [ ] Verify rate limiting active (exceed 180 events/min → 429).
- [ ] Verify honeypot rejection (submit with honeypot field → silent 202, no DB write).

## Phase 4: Operational Baseline (0.5 days)

- [ ] Run `rollups:run` manually via `fly ssh console` or one-off machine to verify rollup job works in production.
- [ ] Configure daily rollup execution (Fly Machine schedule, external cron, or GitHub Action).
- [ ] Test `retention:purge` script against production DB (dry-run first if supported).
- [ ] Verify Fly dashboard shows logs (Pino structured JSON).
- [ ] Document the production URL and admin key location (secrets manager, not plaintext).

## Stretch Goals

- [ ] Set up Fly log drain to external service for long-term log retention.
- [ ] Add `fly scale count 2` for zero-downtime deploys once traffic justifies it.
- [ ] Automated deploy via GitHub Actions on push to `main` (backend path filter).

## Success Criteria

- [ ] `https://<app>.fly.dev/v1/healthz` returns `{ "ok": true }` from the public internet.
- [ ] An event beacon from the live marketing site is stored in the production database.
- [ ] A lead capture from the live marketing site creates a `leads` + `lead_identities` row.
- [ ] `GET /v1/metrics/summary` returns non-zero visitor/event counts after 24h of live traffic.
- [ ] No secrets are committed to the repository.
