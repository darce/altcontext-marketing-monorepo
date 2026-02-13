# Backend Phase 0-1: Foundations and Capture

## Problem Statement

The backend marketing server in `backend/` is not yet implemented, but the roadmap requires a robust Phase 0 foundation and Phase 1 capture/identity pipeline. We need an implementation plan that turns the roadmap into concrete work items, API contracts, and acceptance checks. The result must preserve static-first frontend behavior while enabling durable event and lead ingestion.

## Workflow Principles

- Frontend first paint must remain independent of backend availability.
- All write endpoints must validate inputs and apply rate limiting.
- Identity linking must prioritize explicit `anonId + email` links over heuristics.
- JS/TS functions use arrow functions unless `this` binding requires otherwise.

## Terminology

- **anonId**: Stable anonymous visitor ID generated client-side and submitted with events/forms.
- **Lead**: Email identity record for marketing workflows.
- **Identity Link**: Association between `visitor` and `lead` with source and confidence.
- **Consent Event**: Audit record tracking CASL/PIPEDA consent state transitions.

## Current State Analysis

- `backend/` currently has only minimal package scaffolding; no production API contract is implemented.
- Required Phase 0 concerns (env validation, health endpoint, DB schema/migration baseline) are not in place.
- Required Phase 1 routes (`POST /v1/events`, `POST /v1/leads/capture`) and linkage logic are missing.
- Compliance-critical data handling (consent tracking, hashed IP strategy, retention hooks) is not yet implemented.

## Proposed Solution

Implement backend in two sequential phases. Phase 0 establishes service scaffolding, typed config, Prisma schema, migrations, and operational baseline. Phase 1 adds event and lead capture endpoints with validation, non-blocking ingestion behavior, identity stitching (`anonId` first, heuristic second), consent audit logging, and anti-abuse controls.

## Patterns to Follow

### Route Handler Pattern

```typescript
const captureLeadHandler = async (request, reply) => {
  const payload = LeadCaptureSchema.parse(request.body);
  const result = await leadService.capture(payload, requestContextFrom(request));
  return reply.code(200).send(result);
};
```

### Server-side IP Hashing Pattern

```typescript
const toIpHash = (ip: string, pepper: string): string =>
  createHmac("sha256", pepper).update(ip).digest("hex");
```

### Identity Linking Priority Pattern

```typescript
const linkPriority = ["form_submit", "same_ip_ua_window"] as const;
```

## Functions to Change

| File | Line | Change |
| `backend/package.json` | 1 | Add build/dev/test/migrate scripts for TS + Prisma workflow. |
| `backend/src/server.ts` | 1 | Create Fastify app bootstrap with health check and plugin registration. |
| `backend/src/config/env.ts` | 1 | Add typed env parsing/validation for DB URL, secrets, and runtime flags. |
| `backend/src/routes/events.ts` | 1 | Implement `POST /v1/events` with validation and rate limiting. |
| `backend/src/routes/leads.ts` | 1 | Implement `POST /v1/leads/capture` and `POST /v1/leads/unsubscribe`. |
| `backend/src/services/identity.ts` | 1 | Add visitor/lead linking and confidence assignment logic. |
| `backend/src/services/consent.ts` | 1 | Add consent state transitions and consent audit event writes. |
| `backend/prisma/schema.prisma` | 1 | Define MVP tables for visitors, sessions, events, leads, lead_identities, form_submissions, consent_events. Add suggested indexes from roadmap §5. |
| `backend/prisma/migrations/*` | 1 | Add initial migration for Phase 0 schema baseline. |
| `backend/Makefile` | — | Already exists. Use `make -C backend dev`, `make -C backend migrate`, `make -C backend check` for all multi-step workflows. Do not replicate Makefile sequencing in ad-hoc shell commands. |

## Related Files

| File | Note |
| --- | --- |
| `agentic/roadmaps/backend-marketing-server-roadmap.md` | Source of phase scope and acceptance expectations. |
| `agentic/instructions/backend/service-rules.md` | Backend invariants (API behavior, non-blocking frontend integration). |
| `agentic/instructions/backend/verification.md` | Test/deploy verification standards for backend changes. |

---

# Consolidated Checklist

## Completed

- [x] Roadmap defined for backend marketing server.
- [x] Phase 0 and Phase 1 implementation plan documented in this task.

## Phase 0: Scaffolding

- [ ] Add backend TS runtime scaffold (`src/`) with Fastify entrypoint.
- [ ] Add env schema validation and startup failure on invalid config.
- [ ] Add Prisma setup and initial schema for MVP entities.
- [ ] Run and commit first Prisma migration.
- [ ] Add `GET /v1/healthz` endpoint.
- [ ] Add structured logging with request-id correlation and PII redaction (no raw IPs/emails in log output).
- [ ] Add Fly-compatible start command and listen host/port behavior (`0.0.0.0`).

## Phase 1: Capture + Identity

- [ ] Implement `POST /v1/events` with schema validation and response contract.
- [ ] Implement `POST /v1/leads/capture` with email normalization and upsert logic.
- [ ] Persist `visitors`, `sessions`, `events`, `leads`, `lead_identities`, `form_submissions`.
- [ ] Add suggested indexes from roadmap §5 (`events(visitor_id, timestamp)`, `leads(email_normalized)`, etc.).
- [ ] Define session creation and timeout strategy (e.g. 30-min inactivity window, new session on new UTM params).
- [ ] Enforce primary identity link via `anonId + email` on submit.
- [ ] Add optional heuristic link path (`ip_hash + ua_hash + time window`) with lower confidence.
- [ ] Implement `consent_status` and `consent_events` audit logging.
- [ ] Implement `POST /v1/leads/unsubscribe` to set `consent_status=withdrawn`.
- [ ] Add rate limiting and honeypot/bot mitigation on write endpoints.
- [ ] Ensure no route blocks frontend render path; endpoints must be async and non-blocking.

## Compliance (Phase 1)

- [ ] Add delete-by-email endpoint or admin command for PIPEDA erasure requests.
- [ ] Stub automated retention purge job (raw events > 90 days, raw IP > 7 days) — can be a manual script initially.
- [ ] Document privacy contact in project README.

## Phase 2: Deferred (Out of Current Scope)

- [ ] Add metrics rollups and `GET /v1/metrics/summary`.
- [ ] Add cohort/multi-touch analysis.

## Testing

- [ ] Unit tests for env parsing, validation schemas, identity linking, consent transitions.
- [ ] Integration tests for `POST /v1/events`, `POST /v1/leads/capture`, `POST /v1/leads/unsubscribe`.
- [ ] Database tests for unique constraints and migration correctness.
- [ ] E2E verification that frontend can submit without blocking first paint.

## Stretch Goals

- [ ] Add idempotency keys for event ingestion.
- [ ] Add queued write path for traffic spikes.

## Success Criteria

- [ ] Backend starts cleanly with validated env and successful DB connection.
- [ ] `GET /v1/healthz` returns 200 on local and Fly runtime.
- [ ] Event ingestion persists validated records with server-side IP/UA hashing.
- [ ] Lead capture persists normalized email and visitor identity links.
- [ ] Consent changes are auditable via `consent_events`.
- [ ] Unsubscribe request updates consent status immediately.
- [ ] Rate limiting blocks abusive write bursts without affecting healthy traffic.
