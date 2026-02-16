# Description Service Marketing and Observability Roadmap

Last updated: 2026-02-13

## Table of Contents

- [1. Context](#1-context)
- [2. Goals](#2-goals)
- [3. Constraints](#3-constraints)
- [4. System Architecture](#4-system-architecture)
- [5. Integration Data Model](#5-integration-data-model)
- [6. API Contract](#6-api-contract)
- [7. Metrics](#7-metrics)
- [8. Privacy and Compliance](#8-privacy-and-compliance)
- [9. Delivery Phases](#9-delivery-phases)
- [10. Acceptance Checklist](#10-acceptance-checklist)

## 1. Context

### The Description Service

AltContext operates a commercial image description and facial recognition service (`context-alt-text-monorepo/apps/prototype-description-service`). It is a Python/FastAPI application backed by PostgreSQL + pgvector, with:

- **Recognition context**: Face detection (InsightFace), embedding generation, incremental clustering (representative/centroid/graph discovery), assignment gating with constraint checks, and identity suggestion workflows.
- **Multi-tenant isolation**: Row-level security per tenant, API key auth, rate-limit tiers.
- **Job system**: Async scan worker for media analysis (scan, clustering, curation, split jobs) with SSE progress streaming.
- **Observability**: `ClusteringLogger`, `BatchJobReport`, `ObservabilityRepository`, decision logs, and curation event logs — all persisted to Postgres.
- **Persistence**: ~15 tables including `tenants`, `api_keys`, `media_identities`, `identity_clusters`, `identity_scan_jobs`, `identity_suggestions`, `cluster_merge_suggestions`, plus materialized views for centroids.

Full architecture: `/context-alt-text-monorepo/docs/agentic/diagrams/backend-uml/`.

### The Marketing Backend

This monorepo (`altcontext-marketing-monorepo/backend/`) already has:

- Visitor tracking, session management, event ingestion.
- Lead capture with email normalization, consent management (PIPEDA/CASL).
- Daily rollup engine with pre-aggregated metrics.
- Admin metrics summary endpoint (`GET /v1/metrics/summary`).

Full spec: `agentic/roadmaps/backend-marketing-server-roadmap.md`.

### The Gap

The marketing backend tracks anonymous visitors on the static marketing site. The description service tracks tenants, API usage, and recognition quality for the commercial product. There is no bridge between them:

- No way to attribute a marketing lead to a paying tenant.
- No visibility into description service health, adoption, or usage trends from the marketing backend.
- No funnel metric from "visited marketing site" → "signed up" → "created API key" → "ran first scan" → "active usage".

This roadmap defines changes to the **marketing backend** to close that gap.

## 2. Goals

- Track the full acquisition funnel: marketing site visit → lead capture → tenant signup → API key creation → first scan → active usage.
- Surface description service usage and health metrics alongside existing marketing KPIs.
- Enable marketing to understand which channels produce tenants that actually use the product (not just email captures).
- Keep the two services loosely coupled — the description service pushes events to the marketing backend via webhook or lightweight API; the marketing backend never calls the description service directly.
- Maintain PIPEDA/CASL compliance for any new data flowing between services.

## 3. Constraints

- **No changes to the description service in this roadmap.** The description service already has an observability layer (`ObservabilityRepository`, `BatchJobReport`, decision logs). This roadmap adds a lightweight webhook emitter on that side and all data modeling and analytics on the marketing backend side.
- **No new infrastructure.** The marketing backend runs on Fly.io. The description service deployment is TBD (requires GPU for inference — likely a GPU cloud provider such as RunPod, Lambda, or a dedicated VM). The two services share no database. Communication is HTTPS webhooks over the public internet (TLS-secured, shared secret auth).
- **Property-aware.** The marketing backend already supports `propertyId` on all rollups. The description service integration uses a dedicated property (e.g., `"description-service"`) to keep metrics separate from marketing site traffic.
- **Existing auth patterns.** Webhook ingestion reuses the `ADMIN_API_KEY` + `x-admin-key` auth pattern already established.

## 4. System Architecture

```text
Static marketing site (GitHub Pages)
  ├─ page/event beacons → marketing backend /v1/events
  └─ lead capture form → marketing backend /v1/leads/capture
                                ↕
                    marketing backend (Fly.io)
                    ├─ existing: visitor, session, lead, rollup tables
                    ├─ new: tenant_events, service_usage_rollups
                    └─ new: /v1/webhooks/description-service
                                ↑
                    description service (GPU host — TBD)
                    ├─ webhook emitter (new, lightweight)
                    └─ fires: tenant.created, apikey.created,
                       scan.completed, scan.failed,
                       cluster.created, suggestion.resolved
```

### Data Flow

1. **Marketing funnel** (existing): Visitor → session → events → lead capture. No changes.
2. **Tenant lifecycle** (new): Description service fires webhooks on tenant/API-key creation. Marketing backend stores these as `tenant_events`.
3. **Usage telemetry** (new): Description service fires webhooks on scan completion/failure. Marketing backend aggregates into `ServiceUsageRollup`.
4. **Lead-to-tenant attribution** (new): When a tenant is created with an email that matches a known lead, the marketing backend links them via `lead_id` on the tenant event.

## 5. Integration Data Model

### New tables (Prisma models in marketing backend)

```prisma
model TenantEvent {
  id              String   @id @default(uuid())
  tenantId        String   @db.VarChar(128) @map("tenant_id")
  eventType       String   @db.VarChar(64) @map("event_type")
  payload         Json?
  leadId          String?  @map("lead_id")
  occurredAt      DateTime @map("occurred_at")
  receivedAt      DateTime @default(now()) @map("received_at")
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([tenantId, occurredAt], map: "tenant_events_tenant_occurred_idx")
  @@index([eventType, occurredAt], map: "tenant_events_type_occurred_idx")
  @@index([leadId], map: "tenant_events_lead_idx")
  @@map("tenant_events")
}

model ServiceUsageRollup {
  id                    String   @id @default(uuid())
  day                   DateTime @db.Date
  tenantId              String   @db.VarChar(128) @map("tenant_id")
  scansCompleted        Int      @default(0) @map("scans_completed")
  scansFailed           Int      @default(0) @map("scans_failed")
  mediaProcessed        Int      @default(0) @map("media_processed")
  identitiesDetected    Int      @default(0) @map("identities_detected")
  clustersCreated       Int      @default(0) @map("clusters_created")
  suggestionsGenerated  Int      @default(0) @map("suggestions_generated")
  suggestionsResolved   Int      @default(0) @map("suggestions_resolved")
  avgScanDurationMs     Int?     @map("avg_scan_duration_ms")
  generatedAt           DateTime @default(now()) @map("generated_at")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, day], map: "service_usage_rollups_tenant_day_key")
  @@index([day], map: "service_usage_rollups_day_idx")
  @@map("service_usage_rollups")
}
```

### Webhook event types

| Event type | Fired when | Payload fields |
|---|---|---|
| `tenant.created` | New tenant row created in description service | `tenantId`, `siteUrl`, `email`, `createdAt` |
| `apikey.created` | New API key issued | `tenantId`, `keyPrefix`, `rateLimitTier`, `createdAt` |
| `scan.completed` | Scan job finishes successfully | `tenantId`, `jobId`, `mediaCount`, `identitiesDetected`, `durationMs`, `completedAt` |
| `scan.failed` | Scan job fails | `tenantId`, `jobId`, `mediaCount`, `errorMessage`, `failedAt` |
| `cluster.created` | New identity cluster created | `tenantId`, `clusterId`, `identityCount`, `algorithm`, `createdAt` |
| `suggestion.resolved` | User accepts/rejects a suggestion | `tenantId`, `suggestionId`, `resolution`, `resolvedAt` |

### Lead-to-tenant attribution

When a `tenant.created` webhook arrives with an `email` field:

1. Normalize the email (same logic as lead capture).
2. Look up `leads` by `email_normalized`.
3. If a match exists, store `leadId` on the `TenantEvent`.

This links the marketing funnel exit (lead) to the product funnel entry (tenant) without merging databases.

## 6. API Contract

### `POST /v1/webhooks/description-service`

Receives webhook events from the description service.

**Auth**: `x-admin-key` header (shared `ADMIN_API_KEY`).

**Request body**:

```jsonc
{
  "eventType": "scan.completed",
  "tenantId": "uuid",
  "occurredAt": "2026-02-13T12:00:00Z",
  "payload": {
    // event-type-specific fields
  }
}
```

**Response**: `{ "ok": true, "eventId": "uuid" }`

**Behavior**:
- Validates with Zod schema at boundary.
- Stores raw event in `tenant_events`.
- For `tenant.created`, attempts lead attribution by email.
- Rate limited: 300/min (higher than admin endpoints — webhook bursts expected during batch scans).
- Idempotent: duplicate `tenantId + eventType + occurredAt` within 60s is accepted but not re-inserted.

### `GET /v1/metrics/service-usage`

Returns aggregated description service usage metrics for a date window.

**Auth**: `x-admin-key` header.

**Query parameters**: `from`, `to`, `tenantId` (optional; defaults to all tenants), `compareTo` (optional boolean).

**Response**:

```jsonc
{
  "ok": true,
  "window": { "from": "2026-01-14", "to": "2026-02-13" },
  "compareTo": null,
  "usage": {
    "totalScansCompleted": { "value": 142, "delta": null },
    "totalScansFailed": { "value": 3, "delta": null },
    "scanSuccessRate": { "value": 0.979, "delta": null },
    "totalMediaProcessed": { "value": 2840, "delta": null },
    "totalIdentitiesDetected": { "value": 8920, "delta": null },
    "avgScanDurationMs": { "value": 3200, "delta": null },
    "totalClustersCreated": { "value": 45, "delta": null },
    "suggestionResolutionRate": { "value": 0.82, "delta": null }
  },
  "funnel": {
    "marketingVisitors": 1420,
    "leadsCapured": 34,
    "tenantsCreated": 8,
    "tenantsWithApiKey": 6,
    "tenantsWithFirstScan": 5,
    "tenantsActive30d": 4
  },
  "trend": [
    { "day": "2026-02-07", "scansCompleted": 18, "mediaProcessed": 360, "identitiesDetected": 1120 }
  ]
}
```

### `GET /v1/metrics/summary` (existing, extended)

Add optional `includeFunnel=true` query parameter. When present, the existing summary response includes a `funnel` block showing the lead-to-tenant conversion pipeline alongside traffic metrics.

## 7. Metrics

### Acquisition Funnel Metrics (new)

| Metric | Source | Formula |
|---|---|---|
| Leads → tenants conversion rate | `tenant_events` + `leads` | Tenants with matched `leadId` ÷ total leads in window |
| Time-to-first-scan | `tenant_events` | `scan.completed.occurredAt - tenant.created.occurredAt` for first scan per tenant |
| Tenant activation rate | `tenant_events` | Tenants with ≥1 `scan.completed` ÷ tenants created in window |
| API key creation rate | `tenant_events` | Tenants with `apikey.created` ÷ tenants created in window |

### Service Usage Metrics (new)

| Metric | Source | Formula |
|---|---|---|
| Scan success rate | `ServiceUsageRollup` | `scansCompleted ÷ (scansCompleted + scansFailed)` |
| Media throughput | `ServiceUsageRollup` | `SUM(mediaProcessed)` per day/window |
| Identities per scan | `ServiceUsageRollup` | `identitiesDetected ÷ scansCompleted` |
| Avg scan duration | `ServiceUsageRollup` | Weighted average of `avgScanDurationMs` |
| Suggestion resolution rate | `ServiceUsageRollup` | `suggestionsResolved ÷ suggestionsGenerated` |
| Cluster growth rate | `ServiceUsageRollup` | `SUM(clustersCreated)` per window |

### Existing Metrics (unchanged)

All marketing metrics from `backend-marketing-server-roadmap.md` §8 remain. The new metrics are additive — they appear under `usage` and `funnel` keys in the API response, separate from `metrics` and `ingest`.

## 8. Privacy and Compliance

### Data Classification

| Data | Classification | Handling |
|---|---|---|
| `tenantId` | Pseudonymous identifier | Stored as-is — not PII on its own |
| `email` in `tenant.created` | PII | Used only for lead attribution lookup; NOT stored in `tenant_events.payload`. Only the `leadId` reference is persisted. |
| Scan job metadata | Non-personal | Counts, durations, error messages — no media content crosses the wire |
| Webhook payloads | Mixed | Strip any PII fields before storage. Only retain structural/count fields. |

### PIPEDA Alignment

- Email from `tenant.created` events is used transiently for lead lookup and discarded. The `leadId` FK is the only cross-reference persisted.
- Retention: `tenant_events` follow the same 90-day raw event policy. `ServiceUsageRollup` follows the 24-month rollup policy.
- Delete-by-email cascade already covers `leads` and `lead_identities`. Any `tenant_events` with a matching `leadId` have `leadId` set to `null` on lead deletion (not cascaded — the usage event itself is not PII).

### CASL

No additional CASL controls. Webhook events are system-to-system; no commercial electronic messages are involved.

## 9. Delivery Phases

### Phase A: Webhook Ingestion (1-2 days)

**Prerequisite**: Description service deploys webhook emitter (out of scope for this monorepo).

- [ ] Add `TenantEvent` model to Prisma schema. Migration.
- [ ] Add `POST /v1/webhooks/description-service` route with Zod validation, admin auth, rate limiting.
- [ ] Implement lead-to-tenant attribution (email normalization + lookup on `tenant.created`).
- [ ] Implement idempotency guard (duplicate suppression).
- [ ] Add env config: `WEBHOOK_RATE_LIMIT` (default 300/min).
- [ ] Integration tests: auth, validation, attribution, idempotency.

### Phase B: Usage Rollups (1-2 days)

- [ ] Add `ServiceUsageRollup` model to Prisma schema. Migration.
- [ ] Extend rollup engine to aggregate `tenant_events` into `ServiceUsageRollup` per tenant per UTC day.
- [ ] Add `rollups-service-usage` script and Make target.
- [ ] Unit tests for aggregation formulas.
- [ ] Integration tests for rollup idempotency.

### Phase C: Metrics API (1-2 days)

- [ ] Add `GET /v1/metrics/service-usage` endpoint with admin auth.
- [ ] Add `funnel` computation: query `tenant_events` for pipeline stage counts, join with existing lead/visitor counts from `DailyMetricRollup`.
- [ ] Extend `GET /v1/metrics/summary` with optional `includeFunnel` parameter.
- [ ] Zod schemas for service usage query.
- [ ] Integration tests for response contract, comparison windows, empty states.

### Phase D: Description Service Webhook Emitter (separate repo)

> This phase is tracked outside this monorepo. Listed here for completeness.

- [ ] Add lightweight webhook emitter module in description service.
- [ ] Fire events on: tenant creation, API key creation, scan job completion/failure, cluster creation, suggestion resolution.
- [ ] Configure target URL + shared secret via environment variables.
- [ ] Retry with exponential backoff (3 attempts, 1s/5s/30s).
- [ ] Log all webhook delivery attempts for debugging.

## 10. Acceptance Checklist

- [ ] `POST /v1/webhooks/description-service` accepts and stores tenant lifecycle events.
- [ ] `tenant.created` events with email auto-link to existing leads.
- [ ] `ServiceUsageRollup` table populated from tenant events, idempotent on re-run.
- [ ] `GET /v1/metrics/service-usage` returns usage + funnel metrics for a date window.
- [ ] `GET /v1/metrics/summary?includeFunnel=true` returns funnel alongside existing marketing metrics.
- [ ] Email from webhook payloads is used transiently and not persisted in `tenant_events`.
- [ ] Delete-by-email nullifies `leadId` on related `tenant_events`.
- [ ] All new endpoints protected by `ADMIN_API_KEY`.
- [ ] `make -C backend audit` passes with no new violations.
- [ ] All new code follows `agentic/instructions/language-standards.md`.

## References

- Description service architecture: `/context-alt-text-monorepo/docs/agentic/diagrams/backend-uml/`
- Marketing backend roadmap: `agentic/roadmaps/backend-marketing-server-roadmap.md`
- Language standards: `agentic/instructions/language-standards.md`
- Backend verification: `agentic/instructions/backend/verification.md`
