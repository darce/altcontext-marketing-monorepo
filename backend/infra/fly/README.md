# Fly.io Deployment

Infrastructure configuration for deploying the marketing backend to [Fly.io](https://fly.io).

## Architecture

- **Compute**: `shared-cpu-1x`, 256 MB RAM (Fly Machines)
- **Database**: Fly Postgres (unmanaged legacy cluster)
- **Region**: `yyz` (Toronto)
- **Health checks**: `/v1/healthz` every 30s

## Files

| File                           | Purpose                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| `fly.toml` (monorepo root)     | Fly app configuration — VM size, regions, health checks, build path |
| `backend/infra/fly/Dockerfile` | Multi-stage build: compile TS → production image (node:22-slim)     |

> `fly.toml` lives at the **monorepo root** (Docker build context). Run `fly deploy` from the monorepo root. The Dockerfile stays in `backend/infra/fly/` and is referenced via `[build] dockerfile`.

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
make -C backend fly-secrets       # import .env.production secrets (staged)
make -C backend fly-logs          # tail production logs
make -C backend fly-ssh           # SSH into the running machine
make -C backend fly-status        # show app status
make -C backend fly-checks        # show health check state
make -C backend fly-pg-attach     # attach a Fly Postgres cluster
```

> **Migrations**: Prisma is excluded from the production image (`npm ci --omit=dev`). Run migrations locally via `fly proxy` + `npx prisma migrate deploy`. See task 0.4.1 Phase 1.

## Deploy Workflow

```
make fly-deploy
  ├── make check (typecheck + lint + format)
  ├── fly deploy (reads fly.toml from monorepo root)
  │   ├── Docker build (multi-stage, infra/fly/Dockerfile)
  │   │   ├── Stage 1: npm ci → tsc build
  │   │   └── Stage 2: npm ci --omit=dev → copy dist/
  │   ├── Push image to Fly registry
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

Prisma has been removed from the production image (task 0.3). The `pg` driver runs lean within 256 MB.

V8 heap is capped at 192 MB via `--max-old-space-size=192` in the Dockerfile CMD.

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

**Check**: `fly logs` — look for "out of memory".

**Solution**: Check for memory leaks in route handlers or `pg` pool exhaustion. Heap is capped at 192 MB — if needed, increase to `memory = '512mb'` in `fly.toml` temporarily for diagnosis.

### Migrations Fail via Proxy

**Symptom**: `prisma migrate deploy` errors when run through `fly proxy`.

**Check**: Verify the proxy is running (`fly proxy 15432:5432 -a <pg-app>`) and `DATABASE_URL` points to `localhost:15432`.

**Solution**: Ensure the Fly Postgres app is running (`fly status -a <pg-app>`). Check credentials from `fly postgres attach`.

### Health Check Fails

**Symptom**: Machine starts but health checks fail.

**Check**: `fly checks list` and `fly logs`.

**Solution**: Verify the app responds on `/v1/healthz` port 3000. Increase `grace_period` in `fly.toml` if cold start is slow.

## References

- [Backend service rules](../../../agentic/instructions/backend/service-rules.md) — full resource constraints and deploy patterns
- [OCI deployment](../oci/README.md) — alternative deployment target (Always Free tier)
- [Fly.io docs](https://fly.io/docs/)
