# Agentic Orchestration: AltContext Marketing Monorepo

This file is the orchestration entrypoint for agent cold starts.

Goal: load only the minimum instruction files required for the current task to reduce token consumption and speed up planning.

## Monorepo Scope

- `static/`: static marketing site and build tooling (formerly `frontend/`)
- `backend/`: email collection and marketing intelligence server
- `dashboard/`: SvelteKit admin dashboard — co-deployed with backend on the same Fly.io machine

## Cold-Start Load Protocol

1. **Always load** the shared context file:
   - [`context-and-architecture.md`](./instructions/context-and-architecture.md) — monorepo layout, hosting model
2. **Determine the task domain** (frontend, backend, or both) from the user's request.
3. **Load the domain-specific set** (see routing table below).
4. **Add shared files only when relevant** — language standards, verification conventions, or tool inventory.
5. Avoid loading all instruction files unless the task explicitly spans both domains.

## Task Routing Table

### Static site tasks

> Build pipeline, SCSS/CSS, runtime JS, face-pose, derivatives, offline Python scripts, local dev, performance, deploy to GitHub Pages.

| File | When |
|------|------|
| [`static/architecture.md`](./instructions/static/architecture.md) | Always for static site tasks — file tree, data flow |
| [`static/build-pipeline.md`](./instructions/static/build-pipeline.md) | Build scripts, derivatives, atlas, recrop |
| [`static/performance-and-budgets.md`](./instructions/static/performance-and-budgets.md) | FCP budgets, critical CSS, async loading |
| [`static/authoring-and-runtime.md`](./instructions/static/authoring-and-runtime.md) | SCSS, fonts, images, runtime JS patterns |
| [`static/local-development.md`](./instructions/static/local-development.md) | Apache config, local dev URL |
| [`static/language-standards.md`](./instructions/static/language-standards.md) | Python offline-scripts, pipeline module pattern |
| [`static/verification.md`](./instructions/static/verification.md) | Quality gates, Lighthouse, derivative validation |
| [`language-standards.md`](./instructions/language-standards.md) | TypeScript standards (shared) |

### Backend tasks

> API endpoints, Fly.io deploy, DB migrations, Prisma, privacy/compliance, secrets.

| File | When |
|------|------|
| [`backend/service-rules.md`](./instructions/backend/service-rules.md) | Always for backend tasks — API, Makefile, Fly.io, compliance |
| [`backend/verification.md`](./instructions/backend/verification.md) | Quality gates, deploy checks |
| [`backend/code-review-checklist.md`](./instructions/backend/code-review-checklist.md) | Pre-review protocol, recurring defect patterns |
| [`available-tools.md`](./instructions/available-tools.md) | flyctl reference, Homebrew inventory |
| [`language-standards.md`](./instructions/language-standards.md) | TypeScript standards (shared) |

Backend workflow note: use `make -C backend db-seed-baseline` to run the standalone baseline seed helper (`backend/test/helpers/seed-baseline.ts`) for retention/rollup smoke-test data.
Prisma workflow note: `backend/prisma.config.ts` loads `backend/.env`, so Prisma npm scripts/Make targets resolve `DATABASE_URL` locally without manual shell exports.

### Cross-domain tasks

> Makefile conventions, tool-calling rules, agent rules of engagement.

| File | When |
|------|------|
| [`verification-and-agent-roe.md`](./instructions/verification-and-agent-roe.md) | Tool-calling conventions, target naming, agent rules |

## Hard Invariants (Always Apply)

- Deployable static artifact is `static/dist/`.
- Keep first paint static-first; backend is never paint-critical.
- Default builds should be fast; expensive recrop must be opt-in.
- JS/TS functions should use arrow functions unless `this` binding requires `function`.

## Instruction Modules

### Shared (root)

- [`context-and-architecture.md`](./instructions/context-and-architecture.md)
- [`language-standards.md`](./instructions/language-standards.md)
- [`verification-and-agent-roe.md`](./instructions/verification-and-agent-roe.md)
- [`available-tools.md`](./instructions/available-tools.md)

### Static Site

- [`static/architecture.md`](./instructions/static/architecture.md)
- [`static/performance-and-budgets.md`](./instructions/static/performance-and-budgets.md)
- [`static/build-pipeline.md`](./instructions/static/build-pipeline.md)
- [`static/authoring-and-runtime.md`](./instructions/static/authoring-and-runtime.md)
- [`static/local-development.md`](./instructions/static/local-development.md)
- [`static/language-standards.md`](./instructions/static/language-standards.md)
- [`static/verification.md`](./instructions/static/verification.md)

### Dashboard

- Dashboard instructions will be added as the SvelteKit dashboard is built out.

### Backend

- [`backend/service-rules.md`](./instructions/backend/service-rules.md)
- [`backend/verification.md`](./instructions/backend/verification.md)
- [`backend/code-review-checklist.md`](./instructions/backend/code-review-checklist.md)
