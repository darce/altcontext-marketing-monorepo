# Agentic Orchestration: AltContext Marketing Monorepo

This file is the orchestration entrypoint for agent cold starts.

Goal: load only the minimum instruction files required for the current task to reduce token consumption and speed up planning.

## Monorepo Scope

- `frontend/`: static marketing site and build tooling
- `backend/`: email collection and marketing intelligence server

## Cold-Start Load Protocol

1. Always load:
   - [`agentic/instructions/01-context-and-architecture.md`](./instructions/01-context-and-architecture.md)
   - [`agentic/instructions/02-performance-and-budgets.md`](./instructions/02-performance-and-budgets.md)
2. Then load only the domain files needed for the task (see routing table below).
3. Avoid loading all instruction files unless the task explicitly spans multiple domains.

## Task Routing Table

| Task Type | Load These Files |
|---|---|
| Build scripts, npm pipeline, recrop behavior | [`03-build-pipeline-and-scripts.md`](./instructions/03-build-pipeline-and-scripts.md), [`07-language-standards.md`](./instructions/07-language-standards.md) |
| SCSS, UI, typography, CSS delivery | [`04-frontend-authoring-and-runtime-js.md`](./instructions/04-frontend-authoring-and-runtime-js.md), [`02-performance-and-budgets.md`](./instructions/02-performance-and-budgets.md) |
| Runtime TS/JS interaction logic | [`04-frontend-authoring-and-runtime-js.md`](./instructions/04-frontend-authoring-and-runtime-js.md), [`07-language-standards.md`](./instructions/07-language-standards.md) |
| Backend endpoint or integration behavior | [`05-backend-service-rules.md`](./instructions/05-backend-service-rules.md) |
| Local Apache/dev URL/path issues | [`06-local-development-apache.md`](./instructions/06-local-development-apache.md) |
| Offline Python scripts | [`07-language-standards.md`](./instructions/07-language-standards.md) |
| Verification, QA, release checks, acceptance | [`08-verification-and-agent-roe.md`](./instructions/08-verification-and-agent-roe.md), [`02-performance-and-budgets.md`](./instructions/02-performance-and-budgets.md) |

## Hard Invariants (Always Apply)

- Deployable static artifact is `frontend/dist/`.
- Keep first paint static-first; backend is never paint-critical.
- Default builds should be fast; expensive recrop must be opt-in.
- JS/TS functions should use arrow functions unless `this` binding requires `function`.

## Instruction Modules

- [`01-context-and-architecture.md`](./instructions/01-context-and-architecture.md)
- [`02-performance-and-budgets.md`](./instructions/02-performance-and-budgets.md)
- [`03-build-pipeline-and-scripts.md`](./instructions/03-build-pipeline-and-scripts.md)
- [`04-frontend-authoring-and-runtime-js.md`](./instructions/04-frontend-authoring-and-runtime-js.md)
- [`05-backend-service-rules.md`](./instructions/05-backend-service-rules.md)
- [`06-local-development-apache.md`](./instructions/06-local-development-apache.md)
- [`07-language-standards.md`](./instructions/07-language-standards.md)
- [`08-verification-and-agent-roe.md`](./instructions/08-verification-and-agent-roe.md)
