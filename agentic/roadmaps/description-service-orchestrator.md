# Description Service Integration — Orchestrator Roadmap

Last updated: 2026-02-16

## Table of Contents

- [1. Purpose](#1-purpose)
- [2. Context](#2-context)
- [3. Epic](#3-epic)
- [4. Dependency Graph](#4-dependency-graph)
- [5. Delivery Sequence](#5-delivery-sequence)
- [6. High-Level Checklist](#6-high-level-checklist)

---

## 1. Purpose

Bridge the marketing backend and the AltContext description service (commercial image description + facial recognition product). This orchestrator tracks the work required to close the attribution gap between marketing leads and paying tenants.

The full technical design — data model, API contracts, webhook schemas, metrics formulas, privacy handling — lives in the epic:

> **[epics/description-service-integration.md](epics/description-service-integration.md)**

## 2. Context

| System | Role |
|--------|------|
| Marketing backend (`backend/`) | Stores visitor/lead data; receives webhooks from description service; computes funnel + usage rollups |
| Description service (`context-alt-text-monorepo`) | Fires lifecycle and usage webhooks (tenant created, scan completed, etc.) |
| Dashboard (`dashboard/`) | Displays funnel metrics and service usage analytics |

The two services are loosely coupled via HTTPS webhooks. The marketing backend never calls the description service directly. Full architecture: [epics/description-service-integration.md §4](epics/description-service-integration.md).

### Prerequisites

- Backend deployed to Fly.io (master roadmap Phase 4).
- Multi-tenancy + RLS active (master roadmap Phase 6 / [epics/multi-tenancy-rls.md](epics/multi-tenancy-rls.md)).
- Description service deploys a webhook emitter (tracked outside this monorepo).

## 3. Epic

| Epic | File | Status | Summary |
|------|------|--------|---------|
| Description Service Integration | [epics/description-service-integration.md](epics/description-service-integration.md) | Not started | Webhook ingestion, `TenantEvent` + `ServiceUsageRollup` tables, funnel metrics, lead-to-tenant attribution, privacy/PIPEDA compliance |

### Key deliverables

- `POST /v1/webhooks/description-service` — webhook receiver with Zod validation, idempotency, admin auth.
- `GET /v1/metrics/service-usage` — aggregated usage + funnel metrics endpoint.
- Extension of `GET /v1/metrics/summary` with `includeFunnel` parameter.
- Lead-to-tenant attribution when `tenant.created` email matches a known lead.
- Daily `ServiceUsageRollup` aggregation from raw `TenantEvent` rows.

## 4. Dependency Graph

```text
Backend Phase 4 (Fly deploy) ──────────┐
                                        │
Multi-Tenancy MT-1–2 (tenant model) ───┤
                                        │
Description service webhook emitter ───┤  (external repo)
                                        │
    ┌───────────────────────────────────┘
    │
    ├─→ Phase A: Webhook Ingestion
    │     ├─ TenantEvent model + migration
    │     ├─ Webhook route + Zod validation
    │     ├─ Lead-to-tenant attribution
    │     └─ Idempotency guard
    │
    ├─→ Phase B: Usage Rollups
    │     ├─ ServiceUsageRollup model + migration
    │     ├─ Rollup engine extension
    │     └─ Rollup idempotency tests
    │
    └─→ Phase C: Metrics API
          ├─ GET /v1/metrics/service-usage
          ├─ Funnel computation
          └─ Extend GET /v1/metrics/summary
```

## 5. Delivery Sequence

| # | Phase | Estimate | Depends on |
|---|-------|----------|------------|
| A | Webhook Ingestion | 1–2 days | Backend deployed + multi-tenancy active + description service emitter ready |
| B | Usage Rollups | 1–2 days | Phase A |
| C | Metrics API | 1–2 days | Phase B |
| D | Description Service Webhook Emitter | External | Tracked in `context-alt-text-monorepo` |

## 6. High-Level Checklist

### Phase A: Webhook Ingestion

- [ ] `TenantEvent` Prisma model + migration
- [ ] `POST /v1/webhooks/description-service` route (Zod, admin auth, rate limiting)
- [ ] Lead-to-tenant attribution (email normalisation + lookup on `tenant.created`)
- [ ] Idempotency guard (duplicate suppression)
- [ ] Integration tests: auth, validation, attribution, idempotency

### Phase B: Usage Rollups

- [ ] `ServiceUsageRollup` Prisma model + migration
- [ ] Rollup engine aggregates `tenant_events` → `service_usage_rollups` per tenant per UTC day
- [ ] `rollups-service-usage` script + Make target
- [ ] Unit + integration tests for rollup aggregation and idempotency

### Phase C: Metrics API

- [ ] `GET /v1/metrics/service-usage` endpoint (admin auth, date window, comparison)
- [ ] Funnel computation (visitors → leads → tenants → API key → first scan → active)
- [ ] `GET /v1/metrics/summary?includeFunnel=true` extension
- [ ] Integration tests for response contract, comparison windows, empty states

### Phase D: Webhook Emitter (external)

- [ ] Webhook emitter module in description service
- [ ] Events: `tenant.created`, `apikey.created`, `scan.completed`, `scan.failed`, `cluster.created`, `suggestion.resolved`
- [ ] Retry with exponential backoff (3 attempts)
- [ ] Delivery logging

### Privacy & Compliance

- [ ] Email from `tenant.created` used transiently, not persisted in `tenant_events`
- [ ] Delete-by-email nullifies `leadId` on related `tenant_events`
- [ ] `tenant_events` follow 90-day raw event retention
- [ ] `service_usage_rollups` follow 24-month rollup retention

## References

- Full epic: [epics/description-service-integration.md](epics/description-service-integration.md)
- Master roadmap: [ROADMAP.md](ROADMAP.md)
- Backend epic: [epics/backend-marketing-server.md](epics/backend-marketing-server.md)
- Multi-tenancy epic: [epics/multi-tenancy-rls.md](epics/multi-tenancy-rls.md)
