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

## Integration Behavior

- Frontend telemetry and submit events must be non-blocking.
- Do not introduce blocking scripts in `<head>` for analytics.

## Deployment (Fly.io)

The backend deploys to Fly.io. Full flyctl patterns, anti-patterns, and command reference are in [`../09-available-tools.md`](../09-available-tools.md#flyctl-flyio-cli). All deploy workflows go through the Makefile:

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

Canadian jurisdiction (PIPEDA + CASL) — see §9 of the roadmap.

- Collect only necessary PII; hash IPs with `HMAC_SHA256(ip, pepper)`.
- Track consent status per lead: `pending | express | implied | withdrawn`.
- Provide unsubscribe and delete-by-email endpoints.
- Structured logging must redact sensitive fields before they reach Fly logs.
