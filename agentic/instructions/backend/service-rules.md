# Backend Service Rules

- Backend lives in `backend/` and supports email collection + marketing intelligence workflows.
- Frontend pages must not depend on backend availability for first render.
- HTML forms should still degrade gracefully when JS is absent.
- Full roadmap and data model: `agentic/roadmaps/backend-marketing-server-roadmap.md`.

## Makefile Orchestration

The canonical entry point for all backend tooling is `backend/Makefile`. All multi-step workflows (dev, deploy, DB lifecycle) are Make targets.

```sh
make -C backend dev              # start local Postgres + server with watch
make -C backend stop             # stop local Postgres
make -C backend check            # typecheck + lint + format
make -C backend audit            # check + dead-exports + duplicates (full)
make -C backend dead-exports     # find exports with zero consumers (ts-prune)
make -C backend duplicates       # detect copy-paste clones (jscpd)
make -C backend migrate          # create + apply a dev migration (Prisma)
make -C backend db-reset         # drop, recreate, re-migrate
make -C backend db-studio        # open Prisma Studio
make -C backend fly-deploy       # quality gates → fly deploy → verify health
make -C backend fly-secrets      # import .env.production into Fly (staged)
make -C backend fly-logs         # tail production logs
make -C backend ci               # quality gates + migrate deploy
make -C backend help             # list all targets
```

The Makefile handles dependency ordering (install, DB start, DB create) automatically.

## Canonical npm Scripts

Underlying npm scripts in `backend/package.json` (target state — add as the service is built out):

```sh
npm --prefix backend run start            # start the server
npm --prefix backend run dev              # dev mode with watch
npm --prefix backend run typecheck        # tsc --noEmit
npm --prefix backend run lint             # eslint
npm --prefix backend run migrate          # npx prisma migrate dev
npm --prefix backend run migrate:deploy   # npx prisma migrate deploy (production)
npm --prefix backend run db:studio        # npx prisma studio
```

Prefer Make targets over raw npm scripts for workflows that involve multiple steps.

## API Behavior

- Keep response payloads small.
- Validate all inputs server-side (Zod schemas at route boundaries).
- Apply rate limiting on write endpoints.
- Return explicit non-2xx failures and avoid leaking internals.
- Register `@fastify/cors` with an explicit origin allowlist for the frontend host(s). Without CORS headers, browser `fetch` and `POST` from frontend JS will be blocked.
- Destructive or admin-only endpoints (delete, metrics, purge) must require authentication or be restricted to the Fly private network. Rate limiting alone is not sufficient access control.

## Integration Behavior

- Frontend telemetry and submit events must be non-blocking.
- Do not introduce blocking scripts in `<head>` for analytics.
- Endpoints that accept HTML form POSTs (no-JS fallback) must detect `Content-Type: application/x-www-form-urlencoded` and return a `3xx` redirect — not a JSON body. Verify that nested objects (e.g. UTM params) survive form-encoded payloads or flatten them.

## Deployment (Fly.io)

The backend deploys to Fly.io. Full flyctl patterns, anti-patterns, and command reference are in [`../available-tools.md`](../available-tools.md#flyctl-flyio-cli). All deploy workflows go through the Makefile:

```sh
make -C backend fly-launch        # first-time scaffold
make -C backend fly-deploy        # quality gates → deploy → verify
make -C backend fly-deploy-only   # deploy without gates
make -C backend fly-secrets       # import .env.production (staged)
make -C backend fly-logs          # tail production logs
make -C backend fly-ssh           # shell into machine
make -C backend fly-pg-attach     # wire DATABASE_URL from Fly Postgres
```

## Privacy and Compliance

Ontario jurisdiction (PIPEDA + CASL) — see §9 of the roadmap.

- For Ontario private-sector commercial activities, apply PIPEDA as the baseline privacy regime.
- Health information custodians in Ontario are governed by PHIPA for personal health information; treat health data as out-of-scope for marketing telemetry unless legal review approves.
- Collect only necessary personal information; hash IPs with `HMAC_SHA256(ip, pepper)` and avoid storing raw IPs outside short-lived abuse controls.
- Do not use non-user-controllable cross-site tracking methods (for example, opaque device fingerprinting for behavioural advertising/profiling).
- Require meaningful consent for marketing analytics/profiling beyond reasonable expectations, and keep consent records with property identifier, policy version, timestamp, and source.
- Track consent status per lead: `pending | express | implied | withdrawn`.
- Provide unsubscribe and delete-by-email endpoints.
- When deleting a lead, cascade or scrub all associated PII — including JSONB `payload` fields on related rows that use `onDelete: SetNull`. Orphaned PII violates PIPEDA erasure obligations.
- CASL controls apply to CEM workflows: prior consent, sender identification, and unsubscribe processing within 10 business days.
- Structured logging must redact sensitive fields before they reach Fly logs.
