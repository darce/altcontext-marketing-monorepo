# Backend Marketing Server Roadmap

Last updated: 2026-02-13

## Table of Contents

- [1. Goals](#1-goals)
- [2. Project Constraints](#2-project-constraints)
- [3. Recommended Stack (Decision)](#3-recommended-stack-decision)
- [4. System Architecture](#4-system-architecture)
- [5. Data Model (MVP)](#5-data-model-mvp)
- [6. Visitor IP and Email Association Strategy](#6-visitor-ip-and-email-association-strategy)
- [7. API Contract (MVP)](#7-api-contract-mvp)
- [8. Marketing Metrics for a Bootstrap SaaS](#8-marketing-metrics-for-a-bootstrap-saas)
- [9. Security, Privacy, and Retention](#9-security-privacy-and-retention)
- [10. Fly.io Deployment Plan](#10-flyio-deployment-plan)
- [11. Delivery Phases](#11-delivery-phases)
- [12. DB Choice: Postgres vs MySQL vs MongoDB](#12-db-choice-postgres-vs-mysql-vs-mongodb)
- [13. Acceptance Checklist](#13-acceptance-checklist)

## 1. Goals

- Build a backend marketing server in `backend/` that connects to static frontend pages in `frontend/dist/`.
- Maintain a durable marketing database with an email database at its core.
- Track visitor activity.
- If visitors enter email, associate anonymous visitors with submitted emails by IP and user agent heuristics.
- Provide actionable marketing analytics for an early-stage SaaS.
- Keep frontend first paint static-first; backend must not block rendering.

## 2. Project Constraints

- Frontend is static-first and deploys from `frontend/dist/`.
- Backend is separate and non-paint-critical.
- Form submission must degrade gracefully if JS is unavailable.
- Telemetry must be non-blocking (e.g., `sendBeacon`, async `fetch`, short timeouts).

These constraints are aligned with:

- `agentic/instructions.md`
- `agentic/instructions/01-context-and-architecture.md`
- `agentic/instructions/05-backend-service-rules.md`

## 3. Recommended Stack (Decision)

**Decision:** Use **PostgreSQL + Prisma + TypeScript Node API**.

### Proposed stack

- Runtime: Node.js 20 + TypeScript
- API framework: Fastify (or Express if team preference)
- ORM/migrations: Prisma
- Database: PostgreSQL
- Validation: Zod
- Queue (phase 2+): Redis or Postgres-backed jobs (start simple)
- Observability: OpenTelemetry + structured JSON logs

### Why this stack

- Your problem is relational: visitors, sessions, events, forms, campaigns, and identities need reliable joins.
- Durable event ingestion benefits from ACID and mature indexing.
- Prisma gives fast iteration with type-safe queries and migrations.
- PostgreSQL has strong durability and recovery characteristics and fits both OLTP and moderate analytics workloads.

## 4. System Architecture

```text
frontend/dist (static pages)
  ├─ form POST (progressive enhancement) ───────────────┐
  ├─ page/event beacons (non-blocking JS) ──────────────┤
  └─ anon visitor cookie/localStorage id ───────────────┘
                                                        │
                                                 backend API (Fly.io app)
                                                        │
                                           Prisma + PostgreSQL (primary DB)
                                                        │
                                           materialized views / rollups (phase 3)
```

### Integration pattern

- Frontend posts page events to backend `/v1/events`.
- Frontend form posts to `/v1/leads/capture` (XHR if JS enabled; normal form POST fallback otherwise).
- Backend derives IP from request metadata and stores a privacy-safe representation.

## 5. Data Model (MVP)

### Core tables

- `visitors`
  - `id` (uuid)
  - `anon_id` (unique string from cookie/localStorage)
  - `first_seen_at`, `last_seen_at`
  - `first_ip_hash`, `last_ip_hash`
  - `first_ua_hash`, `last_ua_hash`

- `sessions`
  - `id` (uuid)
  - `visitor_id`
  - `started_at`, `ended_at`
  - `landing_path`, `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`

- `events`
  - `id` (uuid)
  - `visitor_id`, `session_id`
  - `event_type` (`page_view`, `cta_click`, `form_start`, `form_submit`, `email_verify`, etc.)
  - `path`, `timestamp`
  - `ip_hash`, `ua_hash`
  - `props` (jsonb)

- `leads`
  - `id` (uuid)
  - `email_normalized` (unique)
  - `email_domain`
  - `consent_status`
  - `first_captured_at`, `last_captured_at`
  - `source_channel`

- `lead_identities`
  - `id` (uuid)
  - `lead_id`, `visitor_id`
  - `link_source` (`form_submit`, `same_ip_ua_window`, `manual_merge`)
  - `confidence` (0-1)
  - `linked_at`

- `form_submissions`
  - `id` (uuid)
  - `lead_id`, `visitor_id`, `session_id`
  - `form_name`, `payload` (jsonb)
  - `submitted_at`
  - `validation_status`

### Suggested initial indexes

- `events(visitor_id, timestamp desc)`
- `events(event_type, timestamp desc)`
- `events(path, timestamp desc)`
- `sessions(visitor_id, started_at desc)`
- `leads(email_normalized)`
- `lead_identities(lead_id, linked_at desc)`
- `lead_identities(visitor_id, linked_at desc)`

## 6. Visitor IP and Email Association Strategy

### Association rules

- Primary key for identity stitching: `anon_id` (client-side stable ID).
- Strong link: form submit includes `anon_id` and email.
- Secondary heuristic link (optional): same `ip_hash + ua_hash + short time window` with lower confidence.
- Never auto-merge leads across different emails without explicit rule.

### IP tracking guidance

- Derive IP server-side only (never trust client-provided IP fields).
- Keep raw IP only for short-lived abuse controls (optional, e.g., 7 days).
- Store hashed IP (`HMAC_SHA256(ip, pepper)`) for analytics and dedupe.
- Use clear retention windows and deletion workflows.

## 7. API Contract (MVP)

### `POST /v1/events`

- Purpose: ingest non-blocking frontend telemetry.
- Body: `anonId`, `eventType`, `path`, optional `utm`, optional `props`, `timestamp`.
- Behavior: validate payload, attach server timestamp and IP/UA hashes, enqueue/insert.

### `POST /v1/leads/capture`

- Purpose: capture lead email and associate to visitor.
- Body: `email`, `anonId`, optional marketing fields.
- Behavior: normalize email, upsert `leads`, link `lead_identities`, write `form_submissions`.
- Response: explicit success/failure shape; never expose internals.

### `GET /v1/healthz`

- Purpose: health check for Fly machines and monitoring.

### `GET /v1/metrics/summary` (internal/admin)

- Purpose: return daily rollups for dashboard.
- Protection: admin auth or private network only.

## 8. Marketing Metrics for a Bootstrap SaaS

### Start with these 12 metrics

- Unique visitors (daily/weekly)
- Returning visitors %
- Traffic source mix (`utm_source`/referrer)
- Landing page conversion rate (page view -> form submit)
- Form start -> form submit completion rate
- Lead capture rate (unique emails / unique visitors)
- Email verification rate (if verification enabled)
- Cost per lead (when ad spend exists)
- Time-to-first-capture (from first visit to email)
- Lead-to-signup rate (if product signup exists)
- Lead-to-activation rate (if product activation event exists)
- API ingestion reliability (event success %, p95 latency)

### Add in phase 3+

- Cohort conversion (by week/source)
- Assisted conversion paths (multi-touch)
- Domain quality segmentation (free vs business domains)
- Bot/spam score trend

## 9. Security, Privacy, and Retention

- Add rate limiting on write endpoints.
- Add bot checks (honeypot + optional Turnstile/Recaptcha at form endpoint).
- Encrypt secrets and DB URL via Fly secrets.
- Keep PII minimal; hash where feasible.
- Document retention:
  - events raw: 90 days (example)
  - rollups: 24 months
  - raw IP: 0-7 days (optional)
- Provide delete-by-email workflow for compliance operations.

## 10. Fly.io Deployment Plan

### Infrastructure shape

- One Fly app for backend API (`backend/`).
- One Postgres cluster (prefer managed for durability).
- Single region initially (near primary audience), scale later.

### Initial deployment steps

1. `cd backend`
2. `fly launch` (app creation)
3. Provision Postgres (managed or attached cluster)
4. `fly secrets set DATABASE_URL=...`
5. Deploy: `fly deploy`
6. Run migrations in release command or one-off job

### Reliability baseline

- Health check endpoint required.
- At least one daily backup and tested restore workflow.
- Alerting for error rate, p95 latency, DB storage, and failed migrations.

## 11. Delivery Phases

### Phase 0: Foundations (1-2 days)

- Initialize backend TypeScript service.
- Add Prisma schema and first migration.
- Add health endpoint, logging, and env validation.

### Phase 1: Capture + Identity (2-4 days)

- Implement `/v1/events` and `/v1/leads/capture`.
- Add `anon_id` issuance in frontend and form integration.
- Add visitor/email association logic and confidence scoring.
- Add basic anti-spam/rate limits.

### Phase 2: Dashboard API + Rollups (2-3 days)

- Add daily rollup jobs/materialized views.
- Add `/v1/metrics/summary` for internal use.
- Add operational telemetry and error monitoring.

### Phase 3: Optimization (ongoing)

- Improve attribution models.
- Add cohort reports.
- Add data quality monitors and auto-clean tasks.

## 12. DB Choice: Postgres vs MySQL vs MongoDB

### Recommendation

- Use **PostgreSQL** for this project.

### Why Postgres wins here

- Best fit for relational identity stitching and funnel queries.
- Strong durability/recovery primitives.
- JSONB support for flexible event payloads without abandoning relational structure.
- Excellent tooling for analytics-style SQL as your dataset grows.

### MySQL

- Viable and durable with InnoDB, but less ergonomic for mixed relational + event-json analytics compared to Postgres for this use case.

### MongoDB

- Flexible documents, but your core problem needs reliable joins and attribution logic.
- Transaction model and operational constraints can add complexity for this specific workload.

## 13. Acceptance Checklist

- [ ] Backend service in `backend/` deployed to Fly and reachable.
- [ ] `POST /v1/events` ingests telemetry with server-side IP/UA hashing.
- [ ] `POST /v1/leads/capture` captures emails and links to visitor identity.
- [ ] Frontend form works both with JS and no-JS fallback.
- [ ] Dashboard summary endpoint returns the 12 core bootstrap metrics.
- [ ] Rate limiting and spam controls enabled on write endpoints.
- [ ] Retention/deletion workflows defined and tested.
- [ ] Backup + restore test completed successfully.
- [ ] p95 API latency and ingest error budgets documented.

## References

- Fly JavaScript basics: https://fly.io/docs/js/the-basics/
- Fly Managed Postgres: https://fly.io/docs/mpg/
- PostgreSQL WAL and reliability: https://www.postgresql.org/docs/current/wal-intro.html
- MySQL InnoDB ACID model: https://dev.mysql.com/doc/refman/8.4/en/mysql-acid.html
- MongoDB transaction production considerations: https://www.mongodb.com/docs/manual/core/transactions-production-consideration/
- Prisma connection pooling behavior: https://www.prisma.io/docs/concepts/components/prisma-client/working-with-prismaclient/connection-pool
