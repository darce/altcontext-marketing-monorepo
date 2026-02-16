# Fly.io Deployment

Infrastructure configuration for deploying the marketing backend to [Fly.io](https://fly.io).

## Architecture

- **Compute**: `shared-cpu-1x`, 256 MB RAM (Fly Machines)
- **Database**: Fly Postgres (managed)
- **Region**: `yyz` (Toronto)
- **Health checks**: `/v1/healthz` every 30s

## Files

| File         | Purpose                                                               |
| ------------ | --------------------------------------------------------------------- |
| `fly.toml`   | Fly app configuration — VM size, regions, health checks, deploy hooks |
| `Dockerfile` | Multi-stage build: compile TS → production image (node:22-slim)       |

## Prerequisites

1. **Fly CLI**: `brew install flyctl`
2. **Authenticated**: `fly auth login`
3. **Postgres cluster**: Created via `fly postgres create` (or attach existing)

## First-Time Setup

```bash
# 1. Launch the app (creates app + machines)
make -C backend fly-launch

# 2. Attach Postgres (sets DATABASE_URL secret)
make -C backend fly-pg-attach

# 3. Import secrets
make -C backend fly-secrets

# 4. Deploy
make -C backend fly-deploy
```

## Common Operations

```bash
make -C backend fly-deploy        # quality gates → build → deploy → verify
make -C backend fly-deploy-only   # deploy without quality gates
make -C backend fly-migrate       # run Prisma migrations (pre-deploy)
make -C backend fly-secrets       # import .env.production secrets (staged)
make -C backend fly-logs          # tail production logs
make -C backend fly-ssh           # SSH into the running machine
make -C backend fly-status        # show app status
make -C backend fly-checks        # show health check state
make -C backend fly-pg-attach     # attach a Fly Postgres cluster
```

## Deploy Workflow

```
make fly-deploy
  ├── make check (typecheck + lint + format)
  ├── fly deploy --config infra/fly/fly.toml
  │   ├── Docker build (multi-stage)
  │   │   ├── Stage 1: npm ci → prisma generate → tsc build
  │   │   └── Stage 2: npm ci --omit=dev → copy dist + prisma artifacts
  │   ├── Push image to Fly registry
  │   ├── Run release_command (prisma migrate deploy)
  │   └── Start machine
  └── fly checks list (verify health)
```

## Resource Constraints

The app runs on a 256 MB `shared-cpu-1x` machine. Memory budget:

| Component                       | Estimated RSS |
| ------------------------------- | ------------- |
| Linux kernel + init + fly-proxy | ~30–50 MB     |
| V8 + Node.js 22 runtime         | ~40–60 MB     |
| App code + Fastify + deps       | ~10–20 MB     |
| **Available headroom**          | ~120–170 MB   |

> **Note**: After completing [task 0.3 (Remove Prisma Runtime)](../../../agentic/tasks/backend-tasks/0.3.remove-prisma-runtime.md), the Prisma library engine (~40–80 MB) will be removed, making 256 MB viable. Until then, OOM risk exists on cold start.

V8 heap is capped at 384 MB via `--max-old-space-size=384` in the Dockerfile CMD.

## Secrets Management

Secrets are stored in `.env.production` (git-ignored) and imported via `make fly-secrets`:

```bash
# Required secrets
DATABASE_URL=postgresql://...
IP_HASH_PEPPER=<32+ hex chars>
ADMIN_API_KEY=<24+ hex chars>
CORS_ALLOWED_ORIGINS=https://yourdomain.com
```

Secrets are **staged** (not applied immediately). Run `make fly-deploy` to apply staged secrets.

## Troubleshooting

### OOM Kills on Cold Start

**Symptom**: Machine restarts repeatedly, logs show `SIGKILL`.

**Check**: `fly logs --config infra/fly/fly.toml` — look for "out of memory".

**Solution**: Complete task 0.3 (remove Prisma runtime) to reduce baseline RSS by ~40–80 MB. Or temporarily increase VM to `memory = '512mb'` in `fly.toml`.

### Migrations Fail During Deploy

**Symptom**: `release_command` exits non-zero, deploy rolls back.

**Check**: `fly logs --config infra/fly/fly.toml` — look for migration errors.

**Solution**: Run `make fly-migrate` manually to debug. Ensure `DATABASE_URL` secret is set.

### Health Check Fails

**Symptom**: Machine starts but health checks fail.

**Check**: `fly checks list --config infra/fly/fly.toml` and `fly logs`.

**Solution**: Verify the app responds on `/v1/healthz` port 3000. Increase `grace_period` in `fly.toml` if cold start is slow.

## References

- [Backend service rules](../../../agentic/instructions/backend/service-rules.md) — full resource constraints and deploy patterns
- [OCI deployment](../oci/README.md) — alternative deployment target (Always Free tier)
- [Fly.io docs](https://fly.io/docs/)
