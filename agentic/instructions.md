# Agentic Orchestration: AltContext Marketing Monorepo

This file is the orchestration entrypoint for agent cold starts.

Goal: load only the minimum instruction files required for the current task to reduce token consumption and speed up planning.

## Monorepo Scope

- `frontend/`: static marketing site and build tooling
- `backend/`: email collection and marketing intelligence server

## Cold-Start Load Protocol

1. **Always load** the shared context file:
   - [`context-and-architecture.md`](./instructions/context-and-architecture.md) — monorepo layout, hosting model
2. **Determine the task domain** (frontend, backend, or both) from the user's request.
3. **Load the domain-specific set** (see routing table below).
4. **Add shared files only when relevant** — language standards, verification conventions, or tool inventory.
5. Avoid loading all instruction files unless the task explicitly spans both domains.

## Task Routing Table

### Frontend tasks

> Build pipeline, SCSS/CSS, runtime JS, face-pose, derivatives, offline Python scripts, local dev, performance, deploy to GitHub Pages.

| File | When |
|------|------|
| [`frontend/architecture.md`](./instructions/frontend/architecture.md) | Always for frontend tasks — file tree, data flow |
| [`frontend/build-pipeline.md`](./instructions/frontend/build-pipeline.md) | Build scripts, derivatives, atlas, recrop |
| [`frontend/performance-and-budgets.md`](./instructions/frontend/performance-and-budgets.md) | FCP budgets, critical CSS, async loading |
| [`frontend/authoring-and-runtime.md`](./instructions/frontend/authoring-and-runtime.md) | SCSS, fonts, images, runtime JS patterns |
| [`frontend/local-development.md`](./instructions/frontend/local-development.md) | Apache config, local dev URL |
| [`frontend/language-standards.md`](./instructions/frontend/language-standards.md) | Python offline-scripts, pipeline module pattern |
| [`frontend/verification.md`](./instructions/frontend/verification.md) | Quality gates, Lighthouse, derivative validation |
| [`language-standards.md`](./instructions/language-standards.md) | TypeScript standards (shared) |

### Backend tasks

> API endpoints, Fly.io deploy, DB migrations, Prisma, privacy/compliance, secrets.

| File | When |
|------|------|
| [`backend/service-rules.md`](./instructions/backend/service-rules.md) | Always for backend tasks — API, Makefile, Fly.io, compliance |
| [`backend/verification.md`](./instructions/backend/verification.md) | Quality gates, deploy checks |
| [`available-tools.md`](./instructions/available-tools.md) | flyctl reference, Homebrew inventory |
| [`language-standards.md`](./instructions/language-standards.md) | TypeScript standards (shared) |

### Cross-domain tasks

> Makefile conventions, tool-calling rules, agent rules of engagement.

| File | When |
|------|------|
| [`verification-and-agent-roe.md`](./instructions/verification-and-agent-roe.md) | Tool-calling conventions, target naming, agent rules |

## Hard Invariants (Always Apply)

- Deployable static artifact is `frontend/dist/`.
- Keep first paint static-first; backend is never paint-critical.
- Default builds should be fast; expensive recrop must be opt-in.
- JS/TS functions should use arrow functions unless `this` binding requires `function`.

## Instruction Modules

### Shared (root)

- [`context-and-architecture.md`](./instructions/context-and-architecture.md)
- [`language-standards.md`](./instructions/language-standards.md)
- [`verification-and-agent-roe.md`](./instructions/verification-and-agent-roe.md)
- [`available-tools.md`](./instructions/available-tools.md)

### Frontend

- [`frontend/architecture.md`](./instructions/frontend/architecture.md)
- [`frontend/performance-and-budgets.md`](./instructions/frontend/performance-and-budgets.md)
- [`frontend/build-pipeline.md`](./instructions/frontend/build-pipeline.md)
- [`frontend/authoring-and-runtime.md`](./instructions/frontend/authoring-and-runtime.md)
- [`frontend/local-development.md`](./instructions/frontend/local-development.md)
- [`frontend/language-standards.md`](./instructions/frontend/language-standards.md)
- [`frontend/verification.md`](./instructions/frontend/verification.md)

### Backend

- [`backend/service-rules.md`](./instructions/backend/service-rules.md)
- [`backend/verification.md`](./instructions/backend/verification.md)
