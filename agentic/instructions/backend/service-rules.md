# Backend Service Rules

- Backend lives in `backend/` and supports email collection + marketing intelligence workflows.
- Frontend pages must not depend on backend availability for first render.
- HTML forms should still degrade gracefully when JS is absent.
- Full roadmap and data model: `agentic/roadmaps/epics/backend-marketing-server.md`.

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

## Testing

### Test Runner

The backend uses the **Node.js native test runner** (`node:test`) executed via `tsx --test --test-concurrency=1`. The test command is in `package.json` under `"test"`. Do not introduce Vitest, Jest, or other test frameworks.

**Imports:**
```typescript
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
```

### Test Database

Tests run against a local PostgreSQL instance managed by the Makefile (`make -C backend test` handles `db-start`, `db-create`, `migrate:reset` automatically). The test schema is reset between suites via `test/helpers/db.ts`.

### Writing Tests

- **Integration tests** use `app.inject()` (Fastify) — no real HTTP server.
- **Unit tests** mock the `pg.PoolClient` — but mock by SQL pattern matching, not exact text (see code-review-checklist #14).
- Test files live in `test/integration/` and `test/unit/`.
- Shared helpers live in `test/helpers/`.

### SQL-Specific Testing Traps

1. **JSONB columns**: The `pg` driver serializes JS arrays as PostgreSQL array literals, not JSON. Always `JSON.stringify()` values destined for JSONB columns before passing them as bind parameters.
2. **Schema-qualified names**: `tableRef()` prepends the schema (e.g. `"public"."events"`). Test mocks and assertions must not assume unqualified table names.
3. **`emptySql()` returns `SqlQuery`**: When composing optional SQL fragments, always use `emptySql()` which returns `{ text: "", values: [] }`. Never return a bare `""` string where a `SqlQuery` is expected — the `sql` tagged template will treat it as a bind parameter.
4. **Column list drift**: After any schema migration, verify that all raw `INSERT`/`UPDATE` SQL in `src/services/` still lists the correct columns. The TypeScript compiler cannot catch column mismatches in the `sql` template.

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

### Fly Postgres (Unmanaged Legacy Cluster)

The production database is an **unmanaged Fly Postgres cluster** provisioned via `fly postgres create`. This is *not* Fly's managed database offering — see [Fly Postgres overview](https://fly.io/docs/flyctl/postgres/). The backend team is responsible for:

- **Backups**: No automatic backups. Scheduled `pg_dump` must be configured (cron job or GitHub Action).
- **Upgrades**: Major Postgres version upgrades are manual — provision a new cluster, migrate data, reattach.
- **Monitoring**: Use `fly ssh console -a <pg-app>` + `pg_stat_activity` or `fly logs -a <pg-app>` for health. Fly does not provide managed monitoring.
- **Failover**: Single-node by default. Can add a replica with `fly machine clone` but failover is manual.
- **Connection string**: Set automatically by `fly postgres attach <pg-app>` as the `DATABASE_URL` secret on the consumer app. Do not set `DATABASE_URL` manually.

The cluster runs in the same Fly private network as the backend app — no SSL required for internal connections.

### Resource Constraints

**256MB VM** is the target for Node.js 22 + `pg` driver on Fly.io. Prisma is a dev-only dependency — it is not present in the production image.

**Memory breakdown (pg driver, no Prisma):**
- V8 + Node.js runtime: ~40–60MB
- App code + Fastify + `pg` pool: ~10–20MB
- Linux kernel + init + fly-proxy: ~30–50MB on the VM
- **Total baseline:** ~80–130MB RSS (headroom for request spikes)

**Required configuration:**
- `fly.toml`: `memory = '256mb'` in `[[vm]]` block
- Dockerfile CMD: `node --max-old-space-size=192 dist/server.js` (caps V8 heap at 192MB)

### Migrations

Prisma is a **dev-only** tool used for schema management (`prisma migrate dev`) on developer machines. It is excluded from the production image via `npm ci --omit=dev`.

- Prisma must **never** be added to production dependencies or the production Docker image.
- Migrations CANNOT be run from the deployed container.
- Apply migrations to the production database from a dev machine via `fly proxy` + `npx prisma migrate deploy`, or from CI/CD.
- `fly.toml` must not contain a `release_command` referencing Prisma.
- PostgreSQL major-version baseline is **18**. Any review or verification claim about PG18-only features must be executed against a PG18 runtime.

## Deployment (Oracle Cloud Infrastructure Always Free)

The backend can also deploy to OCI Always Free tier. OCI CLI patterns and command reference are in [`../available-tools.md`](../available-tools.md#oci-cli).

### Always Free Tier Resource Limits

**Compute:**
- **VM.Standard.E2.1.Micro** (AMD): 1/8 OCPU, 1 GB RAM, 50 GB boot volume
  - Max 2 instances per tenancy (in home region only)
  - Can only be created in 1 availability domain
- **VM.Standard.A1.Flex** (Arm): 4 OCPU + 24 GB RAM total (flexible allocation)
  - Can create up to 4 instances (depending on OCPU/memory split)
  - Available in any availability domain

**Storage:**
- 200 GB total combined boot + block volume storage (home region)
- 5 volume backups total
- Default boot volume: 50 GB (minimum 47 GB)

**Networking:**
- 2 VCNs max (Free Tier tenancies)
- 1 public IP per instance included
- 10 GB flow logs per month (shared across OCI Logging)
- 50 IPSec connections for Site-to-Site VPN

**Database:**
- 2 Always Free Autonomous Databases (20 GB each, 1 OCPU)
- 1 MySQL HeatWave standalone DB system (50 GB + 50 GB backup)
- Autonomous DB cannot be scaled but can be upgraded to paid

**Load Balancing:**
- 1 Flexible Load Balancer (10 Mbps min/max)
- 1 Network Load Balancer

**Object Storage:**
- 20 GB combined (Standard/Infrequent Access/Archive tiers)
- 50,000 API requests per month

**Outbound Transfer:**
- 10 TB per month

**Important Constraints:**
- All Always Free resources must be created in the **home region** (us-ashburn-1 for this account)
- Idle instances (CPU < 20%, network < 20%, memory < 20% for 7 days) may be reclaimed
- VM.Standard.E2.1.Micro instances can only be created in 1 availability domain in multi-AD regions

### Recommended Configuration for Marketing Backend

**For Always Free deployment:**
- **Shape**: VM.Standard.E2.1.Micro (AMD) — simpler, adequate for MVP
- **OS**: Ubuntu or Oracle Linux (Always Free-eligible images)
- **Database**: Containerized PostgreSQL via Docker Compose on the same VM
- **Boot volume**: 50 GB (default)
- **Container runtime**: Docker + Docker Compose installed via cloud-init
- **Memory**: 1 GB total — requires lean configuration:
  - Node.js with `--max-old-space-size=512` (cap heap at ~512MB)
  - PostgreSQL with shared_buffers=128MB, effective_cache_size=256MB
  - No Prisma in production — Prisma is dev-only (see § Migrations)

**Migration path to managed DB:**
- Once validated, can migrate to Always Free Autonomous Database (20 GB, 1 OCPU)
- Or provision VM.Standard.A1.Flex with more resources for self-managed Postgres

### Arm (A1.Flex) Limitations for ML Workloads

**VM.Standard.A1.Flex** (Arm64) is more powerful than E2.1.Micro but has significant limitations for the image description service:

**InsightFace (face recognition):**
- Requires GPU acceleration (CUDA) for production-grade performance
- CPU-only inference on Arm64 is possible but 10-50x slower
- ONNX Runtime has Arm64 builds but no GPU support without NVIDIA CUDA
- **Not viable on Always Free Arm instances**

**Phi-3 (vision-language model):**
- Requires GPU (CUDA) or Apple Metal for acceptable inference speed
- CPU-only inference on Arm64: ~5-30 seconds per image (unacceptable for production)
- Quantized models (4-bit) can run on CPU but still slow
- **Not viable on Always Free Arm instances**

### External GPU Providers: Cost Comparison for ML Service

For the image description service (InsightFace + Phi-3), external GPU providers are significantly cheaper than OCI for **low-volume, bursty workloads**. OCI GPU instances are only cost-effective at high, sustained volume.

#### Pricing Comparison (February 2026)

**Pay-per-use (Serverless):**
- **Replicate.com**: ~$0.0001-0.001 per image, auto-scaling, no cold start if warm
  - Phi-3 vision inference: ~$0.0005/image (~12s latency on cold start)
  - InsightFace detection: ~$0.0002/image
  - **Best for**: <5K images/month, intermittent usage, prototype/MVP

**Dedicated instances (24/7 or on-demand):**

| Provider | GPU | vCPU | RAM | VRAM | $/hour | $/month (24/7) | Notes |
|---|---|---|---|---|---|---|---|
| **Hugging Face** | T4 small | 4 | 15 GB | 16 GB | **$0.40** | **$288** | +$30/month for persistent storage |
| **Hugging Face** | T4 medium | 8 | 30 GB | 16 GB | **$0.60** | **$432** | +$30/month for persistent storage |
| **Hugging Face** | 1xL4 | 8 | 30 GB | 24 GB | **$0.80** | **$576** | +$30/month for persistent storage |
| **Hugging Face** | A10G small | 4 | 15 GB | 24 GB | **$1.00** | **$720** | +$30/month for persistent storage |
| **RunPod** | A10 (spot) | — | — | 24 GB | **~$0.39** | **~$280** | Spot instances, may be preempted |
| **Lambda Labs** | A10 | — | — | 24 GB | **~$0.60** | **~$432** | On-demand, persistent storage included |
| **OCI** | VM.GPU.A10.1 | 15 | 240 GB | 24 GB | **$2.00** | **$1,440** | Full control, warm instances, no cold starts |

#### Cost Estimate by Usage Pattern

**Low volume, bursty (100-1,000 images/month):**
- **Replicate.com**: $0.05-0.50/month
- **Hugging Face T4 small (on-demand)**: ~$5-20/month (pay only when running)
- **OCI VM.GPU.A10.1**: $1,440/month (overkill for this volume)
- **Winner**: Replicate.com

**Medium volume, bursty (1K-10K images/month):**
- **Replicate.com**: $0.50-5.00/month
- **Hugging Face T4 medium (persistent, on-demand)**: ~$50-150/month
- **RunPod A10 (spot)**: ~$30-100/month (if you manage spin-up/down)
- **OCI VM.GPU.A10.1**: $1,440/month (still overkill)
- **Winner**: Hugging Face T4 medium or RunPod spot

**High volume, bursty (10K-50K images/month):**
- **Replicate.com**: $5-25/month
- **Hugging Face 1xL4 (persistent, 24/7)**: ~$606/month
- **Lambda Labs A10 (24/7)**: ~$432/month
- **OCI VM.GPU.A10.1**: $1,440/month
- **Winner**: Lambda Labs A10 for 24/7 warm instance

**Very high volume, constant (>50K images/month):**
- **Hugging Face 1xL4 (24/7)**: ~$606/month
- **Lambda Labs A10 (24/7)**: ~$432/month
- **OCI VM.GPU.A10.1**: $1,440/month
- **OCI breakeven at**: ~150K-200K images/month (when warm instance + full control justifies premium)
- **Winner**: Lambda Labs A10 or Hugging Face 1xL4

#### Cold Start Latency Tradeoffs

**Replicate.com:**
- Cold start: 30-60 seconds (model download + load to VRAM)
- Warm instance: <1 second
- Acceptable for: async/batch processing, non-critical user workflows

**Hugging Face with ephemeral storage:**
- Cold start: 45-90 seconds (model download + load)
- Warm after first request: <1 second
- Acceptable for: low-traffic, cost-sensitive MVP

**Hugging Face with persistent storage (+$30/month):**
- Cold start: 5-10 seconds (load from disk to VRAM)
- Warm after first request: <1 second
- Acceptable for: production with occasional cold starts

**OCI VM.GPU.A10.1 (always warm):**
- Cold start: 0 seconds (instance never pauses)
- All requests: <1 second
- Required for: <1s latency SLA, high-frequency inference

#### Recommendation for Image Description Service

**Phase 1 (MVP, <5K images/month):**
- Use **Replicate.com** pay-per-image API
- Cost: ~$0.50-5/month
- Tradeoff: 12-30s cold start latency acceptable for async workflows
- Deploy marketing backend on **OCI Always Free**

**Phase 2 (Production, 5K-20K images/month):**
- Use **Hugging Face T4 medium** with persistent storage ($462/month)
- Or **RunPod A10 spot** with auto-scaling ($280-450/month)
- Tradeoff: 5-10s cold start if instance paused, acceptable for most workflows
- Marketing backend stays on **OCI Always Free** or upgrade to paid tier

**Phase 3 (Scale, >50K images/month):**
- Use **Lambda Labs A10** 24/7 ($432/month) or **Hugging Face 1xL4** ($606/month)
- Or migrate to **OCI VM.GPU.A10.1** if >150K images/month + need <1s latency SLA ($1,440/month)
- Marketing backend on **OCI paid tier** (VM.Standard.E5 ~$50/month)

**Only consider OCI GPU instances if:**
- Volume exceeds 150K-200K images/month (cost-effective breakeven)
- Latency SLA requires <1s warm inference with zero cold starts
- Regulatory compliance prohibits external GPU providers
- Need full root access for custom CUDA libraries or kernel optimization

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
