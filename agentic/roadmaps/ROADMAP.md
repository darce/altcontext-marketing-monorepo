# AltContext Marketing Monorepo — Master Roadmap

Last updated: 2026-02-16

## Table of Contents

- [1. Vision](#1-vision)
- [2. Workspaces](#2-workspaces)
- [3. Epic Index](#3-epic-index)
- [4. Dependency Graph](#4-dependency-graph)
- [5. Delivery Sequence](#5-delivery-sequence)
- [6. Cross-Cutting Concerns](#6-cross-cutting-concerns)
- [7. High-Level Checklist](#7-high-level-checklist)

---

## 1. Vision

Build an integrated marketing intelligence platform for AltContext:

- **Backend** (`backend/`): Fastify + PostgreSQL API for visitor tracking, lead capture, consent management, and marketing analytics. The backend is the platform core — it serves any number of tenants, each with one or more properties.
- **Dashboard** (`dashboard/`): SvelteKit admin dashboard co-deployed with the backend on Fly.io. Tenant-scoped views of metrics, leads, and events.
- **Static site** (`static/`): The AltContext marketing site — a static-first site hosted on GitHub Pages. From the backend's perspective, `static/` is the **first client property** within the bootstrap tenant. It sends telemetry beacons and form submissions to the backend API like any other property would. It is not a platform component; it is a consumer of the platform.

The platform tracks the full acquisition funnel — from anonymous marketing site visit through lead capture to tenant signup and product usage — while maintaining PIPEDA/CASL compliance, WCAG 2.2 AA accessibility, and i18n readiness.

## 2. Workspaces

### Platform

| Workspace | Stack | Deploy target | Role |
|-----------|-------|---------------|------|
| `backend/` | Fastify + pg + PostgreSQL + Zod | Fly.io (single machine) | Platform core — API, data, rollups |
| `dashboard/` | SvelteKit 2 + shadcn-svelte + Tailwind | Fly.io (same process as backend) | Platform UI — tenant-scoped admin |

### Client Properties

| Workspace | Stack | Deploy target | Role |
|-----------|-------|---------------|------|
| `static/` | HTML + SCSS + TypeScript (build tools) | GitHub Pages (Apache) | First property of bootstrap tenant — marketing site |

`static/` is a **client** of the backend, not part of the platform itself. It sends `POST /v1/events` beacons and `POST /v1/leads/capture` form submissions to the backend using the bootstrap tenant's ingest API key. Future properties (docs site, blog, etc.) would follow the same integration pattern.

Architecture details: `agentic/instructions/context-and-architecture.md`.

## 3. Epic Index

Each epic contains full design, data model, API contracts, delivery phases, and acceptance criteria.

### Backend Epics

| Epic | File | Status | Summary |
|------|------|--------|---------|
| Backend Marketing Server | [epics/backend-marketing-server.md](epics/backend-marketing-server.md) | Phases 0–2B complete; Prisma removed; test coverage in progress | Core API: events, leads, sessions, rollups, metrics, i18n, runtime assertions, auth, multi-property |
| Multi-Tenancy & RLS | [epics/multi-tenancy-rls.md](epics/multi-tenancy-rls.md) | Not started | Tenant model, API keys, RLS policies, dashboard auth, multi-property + future multi-org |

### Dashboard Epics

| Epic | File | Status | Summary |
|------|------|--------|---------|
| Dashboard | [epics/dashboard.md](epics/dashboard.md) | Skeleton only | Auth, metrics pages, i18n (Paraglide), WCAG AA, unit tests (Vitest), runtime assertions |

### Cross-Workspace Epics

| Epic | File | Status | Summary |
|------|------|--------|---------|
| e2e Testing Harness | [epics/e2e-testing-harness.md](epics/e2e-testing-harness.md) | Proposal | Playwright for backend API + dashboard + static; @axe-core/playwright for WCAG; Storybook optional |

> **Note — static site:** The static site (`static/`) does not have its own epic. Its backend integration (beacons, email form) is Phase 5 of the [backend epic](epics/backend-marketing-server.md). Its WCAG requirements are in `agentic/instructions/static/performance-and-budgets.md`. Its e2e tests are part of the [e2e testing harness](epics/e2e-testing-harness.md).

## 4. Dependency Graph

```text
Phase 0–2: Backend foundations ✅
  │
  ├─→ Phase 2B: Consolidate WebTrafficLog → Event ✅
  │     │
  │     ├─→ Phase 0.3: Remove Prisma runtime ✅
  │     │
  │     └─→ Phase 4: Deploy to Fly.io (infra provisioned; smoke tests pending)
  │           │
  │           ├─→ Phase 5: First property integration (static site → bootstrap tenant)
  │           │     Wire beacons + email form to backend using bootstrap tenant's ingest API key
  │           │
  │           └─→ Phase 6: Multi-Tenancy & RLS (epics/multi-tenancy-rls.md)
  │                 │
  │                 ├─→ Dashboard D-1: Skeleton + Auth
  │                 │     │
  │                 │     ├─→ D-2: Metrics Overview
  │                 │     │     │
  │                 │     │     └─→ D-5: Event Explorer + Lead List
  │                 │     │           │
  │                 │     │           └─→ D-6: Settings + Team
  │                 │     │
  │                 │     ├─→ D-3: i18n + WCAG Foundation
  │                 │     │
  │                 │     └─→ D-4: Unit Tests + Runtime Assertions
  │                 │
  │                 └─→ Description Service Integration (separate orchestrator)
  │
  └─→ e2e Testing Harness (can start after D-1)
        ├─→ E2E-1: Foundation
        ├─→ E2E-2: Backend API coverage
        ├─→ E2E-3: Dashboard + WCAG
        ├─→ E2E-4: Static site (first property) + WCAG
        └─→ E2E-5: CI pipeline
```

## 5. Delivery Sequence

Recommended implementation order with estimated effort.

| # | Phase | Epic | Estimate | Depends on |
|---|-------|------|----------|------------|
| 1 | Phase 2B: Consolidate WTL → Event | Backend | 1–2 days | ✅ Done |
| 1a | Phase 0.3: Remove Prisma runtime | Backend | — | ✅ Done |
| 1b | Phase 0.3.1: Post-Prisma audit | Backend | — | ✅ Done |
| 1c | Phase 0.4: Test coverage (core routes) | Backend | — | In progress (Phase 1 done) |
| 2 | Phase 4: Deploy to Fly.io | Backend | 1–2 days | Infra provisioned; smoke tests pending |
| 3 | Phase 5: First property integration | Backend (static client) | 2–3 days | #2 |
| 4 | Phase 6 / MT-1: Tenant model + API keys | Multi-Tenancy | 2–3 days | #2 |
| 5 | Phase 6 / MT-2: Row-Level Security | Multi-Tenancy | 1–2 days | #4 |
| 6 | Phase 6 / MT-3 + D-1: Dashboard auth | Multi-Tenancy + Dashboard | 2–3 days | #5 |
| 7 | D-2: Metrics Overview | Dashboard | 2–3 days | #6 |
| 8 | D-3: i18n + WCAG Foundation | Dashboard | 2–3 days | #6 |
| 9 | D-4: Unit Tests + Runtime Assertions | Dashboard | 1–2 days | #6 |
| 10 | Backend i18n + runtime assertions | Backend | 2–3 days | #2 |
| 11 | D-5: Event Explorer + Lead List | Dashboard | 2–3 days | #7 |
| 12 | D-6: Settings + Team Management | Dashboard | 2–3 days | #11 |
| 13 | E2E-1–5: e2e Testing + WCAG CI | e2e Harness | 5–8 days | #6 |
| 14 | MT-5: Tenant onboarding | Multi-Tenancy | 1–2 days | #12 |

## 6. Cross-Cutting Concerns

These apply to both **platform** workspaces (backend + dashboard) and **client properties** (static site). Epic-level detail is in the referenced files.

### Internationalisation (i18n)

- Backend: message catalogue + `Accept-Language` resolution → [epics/backend-marketing-server.md §13](epics/backend-marketing-server.md)
- Dashboard: Paraglide JS compile-time i18n → [epics/dashboard.md §5](epics/dashboard.md)
- Default locale: `en`. First additional: `fr` (Canadian French).

### Runtime Assertions

- Backend: `src/lib/assert.ts` `invariant()` → [epics/backend-marketing-server.md §14](epics/backend-marketing-server.md)
- Dashboard: `$lib/assert.ts` `invariant()` → [epics/dashboard.md §6](epics/dashboard.md)

### Authentication

- API key auth (ingest) + session auth (dashboard) → [epics/backend-marketing-server.md §15](epics/backend-marketing-server.md)
- Dashboard guards → [epics/dashboard.md §7](epics/dashboard.md)
- Full multi-tenancy auth → [epics/multi-tenancy-rls.md §7](epics/multi-tenancy-rls.md)

### Multi-Tenancy

- Tenant model + RLS → [epics/multi-tenancy-rls.md](epics/multi-tenancy-rls.md)
- Multi-property (required now) + multi-org (future) → [epics/backend-marketing-server.md §16](epics/backend-marketing-server.md)
- Dashboard property picker → [epics/dashboard.md §8](epics/dashboard.md)

### WCAG 2.2 AA Compliance

- Dashboard (platform UI): colour contrast, ARIA, keyboard nav, semantic structure → [epics/dashboard.md §9](epics/dashboard.md)
- Static site (first client property): colour contrast, alt text, skip links, focus indicators → `agentic/instructions/static/performance-and-budgets.md` (WCAG section)
- Testing: Playwright + axe-core → [epics/e2e-testing-harness.md §7](epics/e2e-testing-harness.md)

### Testing Strategy

| Layer | Backend | Dashboard | Static (client property) |
|-------|---------|-----------|--------|
| Unit | `node:test` + `tsx` | Vitest + `@testing-library/svelte` | N/A |
| Integration | `node:test` + real Postgres | — | — |
| e2e (API) | Playwright `request` context | — | — |
| e2e (browser) | — | Playwright (Chromium/FF/WebKit) | Playwright |
| WCAG | — | axe-core (Playwright + Storybook) | axe-core (Playwright + Lighthouse) |

Full proposal: [epics/e2e-testing-harness.md](epics/e2e-testing-harness.md)

### Privacy & Compliance

- PIPEDA + CASL → [epics/backend-marketing-server.md §9](epics/backend-marketing-server.md)
- Tenant-scoped consent isolation → [epics/multi-tenancy-rls.md §10](epics/multi-tenancy-rls.md)

## 7. High-Level Checklist

### Backend

- [x] Event ingestion (`POST /v1/events`)
- [x] Lead capture (`POST /v1/leads/capture`)
- [x] Consent management (CASL audit log)
- [x] Daily rollups + metrics summary
- [x] Consolidate `WebTrafficLog` → `Event` (Phase 2B)
- [x] Remove Prisma runtime — `pg` driver only (Phase 0.3)
- [x] Post-Prisma-removal audit (Phase 0.3.1)
- [x] Core route test coverage — events, leads, health, delete (Phase 0.4 P1)
- [ ] Test coverage — service-layer edge cases + utilities (Phase 0.4 P2/P3)
- [ ] Deploy to Fly.io — smoke tests + operational baseline (Phase 4)
- [ ] Geo enrichment (MaxMind GeoLite2)
- [ ] i18n message catalogue + locale resolution
- [ ] Runtime assertions (tenant context, rollups, ingest)
- [ ] Basic auth (login/logout, session cookies)
- [ ] Multi-property formalisation (`properties` table, FK enforcement)
- [ ] Search keyword + referral link metrics in rollups

### Multi-Tenancy & RLS

- [ ] Tenant model + API keys (MT-1)
- [ ] Row-Level Security policies (MT-2)
- [ ] Dashboard auth integration (MT-3)
- [ ] Tenant-scoped dashboard pages (MT-4)
- [ ] Tenant onboarding flow (MT-5)
- [ ] Multi-org design preserved (schema-ready, no implementation)

### Dashboard

- [ ] Auth (login, session, guards)
- [ ] Metrics overview + property picker
- [ ] i18n (Paraglide, `en` + `fr`)
- [ ] WCAG AA (contrast, ARIA, keyboard, landmarks)
- [ ] Unit tests (Vitest ≥80% coverage on `$lib/`)
- [ ] Runtime assertions
- [ ] Event explorer + lead list
- [ ] Settings + team management

### Static Site (First Client Property — Bootstrap Tenant)

- [ ] Email capture form wired to backend (JS + no-JS fallback)
- [ ] Telemetry beacons to backend (page_view, engagement, CWV)
- [ ] Ingest API key configured for bootstrap tenant property
- [ ] WCAG AA (contrast, alt text, skip links, focus)

### e2e Testing & WCAG CI

- [ ] Playwright foundation + fixtures
- [ ] Backend API e2e coverage
- [ ] Dashboard e2e coverage + axe-core WCAG sweep
- [ ] Static site (first property) e2e + Lighthouse budgets
- [ ] CI pipeline (GitHub Actions, zero AA violations gate)

### Description Service Integration

Tracked separately: [description-service-orchestrator.md](description-service-orchestrator.md)

- [ ] Webhook ingestion endpoint
- [ ] Usage rollups
- [ ] Funnel + service usage metrics API
- [ ] Lead-to-tenant attribution
