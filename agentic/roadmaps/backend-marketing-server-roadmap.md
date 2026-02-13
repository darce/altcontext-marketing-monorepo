# Backend Marketing Server Roadmap

Last updated: 2026-02-13

## Table of Contents

- [1. Goals](#1-goals)
- [2. Project Constraints](#2-project-constraints)
- [3. Stack](#3-stack)
- [4. System Architecture](#4-system-architecture)
- [5. Data Model (MVP)](#5-data-model-mvp)
- [6. Visitor IP and Email Association Strategy](#6-visitor-ip-and-email-association-strategy)
- [7. API Contract (MVP)](#7-api-contract-mvp)
- [8. Marketing Metrics](#8-marketing-metrics)
- [9. Security, Privacy, Compliance, and Retention](#9-security-privacy-compliance-and-retention)
- [10. Fly.io Deployment](#10-flyio-deployment)
- [11. Delivery Phases](#11-delivery-phases)
- [12. Acceptance Checklist](#12-acceptance-checklist)

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

## 3. Stack

PostgreSQL + Prisma + TypeScript Node API.

- Runtime: Node.js 20 + TypeScript
- API framework: Fastify
- ORM / migrations: Prisma
- Database: PostgreSQL (Fly Managed Postgres)
- Validation: Zod
- Queue (phase 2+): Postgres-backed jobs → Redis if needed
- Observability: OpenTelemetry + structured JSON logs

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

## 8. Marketing Metrics

### MVP Metrics

- Unique visitors (daily/weekly), returning visitors %
- Traffic source mix (`utm_source` / referrer)
- Landing page conversion rate (page view → form submit)
- Form completion rate (start → submit)
- Lead capture rate (unique emails / unique visitors)
- Time-to-first-capture (first visit → email)
- API ingestion reliability (event success %, p95 latency)

### Phase 3+

- Cohort conversion, multi-touch attribution
- Domain quality segmentation (free vs business)
- Cost per lead (when ad spend exists)

## 9. Security, Privacy, Compliance, and Retention

### Security Baseline

- Rate limiting on write endpoints.
- Bot checks: honeypot + optional Turnstile/reCAPTCHA at form endpoint.
- All secrets via `fly secrets set` — never commit real credentials.
- PII kept minimal; hash where feasible (`HMAC_SHA256(ip, pepper)`).

### Data Retention

| Data | Retention | Notes |
|------|-----------|-------|
| Raw events | 90 days | then purge or archive |
| Rollups / aggregates | 24 months | |
| Raw IP | 0–7 days | abuse controls only |
| Raw email | until deletion request | see compliance |

### Canadian Jurisdiction Compliance

The service operates under Canadian law. Two federal statutes govern data handling:

#### PIPEDA (Personal Information Protection and Electronic Documents Act)

- **Consent**: Obtain meaningful consent before collecting, using, or disclosing personal information. Implied consent is acceptable for non-sensitive data when the purpose is obvious (e.g. analytics cookies).
- **Purpose limitation**: State why data is collected at or before the time of collection. Do not repurpose without fresh consent.
- **Minimisation**: Collect only what is necessary. Hash IPs; do not store raw IP longer than required for abuse controls.
- **Retention and disposal**: Define retention periods (see table above). Implement automated purge jobs. Provide a delete-by-email workflow so individuals can exercise their right to erasure.
- **Safeguards**: Encrypt data at rest (Fly Managed Postgres encryption) and in transit (TLS). Restrict DB access to the Fly private network.
- **Accountability**: Designate a privacy contact. Document data flows and retention policies in an internal privacy log.
- **Breach notification**: Mandatory notification to the Office of the Privacy Commissioner of Canada (OPC) and affected individuals if a breach creates a "real risk of significant harm".

#### CASL (Canada's Anti-Spam Legislation)

- **Express consent required** before sending any commercial electronic message (CEM) — marketing emails, drip sequences, promotional notifications.
- **Implied consent** is time-limited (6 months from inquiry, 24 months from existing business relationship). Track consent timestamps per lead.
- **Required message content**: sender identity, mailing address, functional unsubscribe mechanism processed within 10 business days.
- **Record keeping**: store the method, time, and purpose of each consent grant. The `leads.consent_status` field and a `consent_events` audit log satisfy this.
- **No purchased lists**: only email addresses obtained with direct consent may receive CEMs.

#### Implementation Checklist

- [ ] Consent capture UI with clear purpose statement on every form.
- [ ] `consent_status` enum: `pending`, `express`, `implied`, `withdrawn`.
- [ ] `consent_events` audit table: `lead_id`, `status`, `source`, `timestamp`, `ip_hash`.
- [ ] Unsubscribe endpoint (`POST /v1/leads/unsubscribe`) that sets `consent_status = withdrawn` within 10 business days (implement immediately).
- [ ] Automated retention purge job (raw events > 90 days, raw IP > 7 days).
- [ ] Delete-by-email endpoint or admin command for PIPEDA erasure requests.
- [ ] Privacy contact documented in project README.

## 10. Fly.io Deployment

### Infrastructure

- One Fly app for backend API (`backend/`).
- One Fly Managed Postgres cluster, same region.
- Single region initially (`yyz` — Toronto, or nearest Canadian region); scale later.

### Deployment Steps

1. `cd backend && fly launch` — generates `fly.toml` + Dockerfile.
2. `fly postgres create --region yul` → `fly postgres attach <pg-app>`.
3. `fly secrets set SESSION_SECRET=... IP_HASH_PEPPER=...`
4. Add `[deploy] release_command = "npx prisma migrate deploy"` to `fly.toml`.
5. Ensure `internal_port` in `[http_service]` matches the app listen port, bind `0.0.0.0`.
6. `fly deploy`.
7. `fly checks list` to verify health.

### `fly.toml` Essentials

```toml
[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[deploy]
  release_command = "npx prisma migrate deploy"
```

### Reliability

- `GET /v1/healthz` registered as Fly HTTP check.
- Daily Postgres backup + tested restore.
- Alerting on error rate, p95 latency, DB storage, failed migrations.

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

## 12. Acceptance Checklist

- [ ] Backend service in `backend/` deployed to Fly and reachable.
- [ ] `POST /v1/events` ingests telemetry with server-side IP/UA hashing.
- [ ] `POST /v1/leads/capture` captures emails with consent, links to visitor identity.
- [ ] `POST /v1/leads/unsubscribe` withdraws consent and is processed immediately.
- [ ] Frontend form works both with JS and no-JS fallback.
- [ ] Dashboard summary endpoint returns MVP metrics.
- [ ] Rate limiting and spam controls enabled on write endpoints.
- [ ] PIPEDA retention/deletion workflows defined and tested.
- [ ] CASL consent audit log (`consent_events`) operational.
- [ ] Backup + restore test completed.
- [ ] p95 API latency and ingest error budgets documented.

## References

- Fly JavaScript basics: https://fly.io/docs/js/the-basics/
- Fly Managed Postgres: https://fly.io/docs/mpg/
- Fly secrets management: https://fly.io/docs/apps/secrets/
- Prisma on Fly (Postgres): https://fly.io/docs/js/prisma/postgres/
- PIPEDA overview: https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/
- CASL overview: https://crtc.gc.ca/eng/internet/anti.htm
- OPC breach reporting: https://www.priv.gc.ca/en/report-a-concern/report-a-privacy-breach-at-your-organization/
