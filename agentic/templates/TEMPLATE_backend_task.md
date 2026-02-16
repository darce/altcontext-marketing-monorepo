# Backend Task Plan Template

> Extends [TEMPLATE_task.md](./TEMPLATE_task.md) with backend-specific sections.
> Use for all implementation plans under `agentic/tasks/backend-tasks/`.
>
> Rules that apply to every backend task are routed via [`instructions.md`](../instructions.md#backend-tasks) — do not restate them in task docs.
> Task docs contain only **task-specific** principles, patterns, and checklist items.

---

# [TASK_TITLE]

## Applicable Instruction Files

Standard backend files per the [routing table](../instructions.md#backend-tasks).

[Add task-specific instruction files here if needed, e.g.:

| File | Load when… |
|------|------------|
| [`available-tools.md`](../instructions/available-tools.md) | Task involves flyctl, deployment, or infrastructure commands |

Remove this table if no task-specific additions are needed.]

## Problem Statement

[What user-visible behavior needs to change. 2-3 sentences max.]

## Workflow Principles

[Only task-specific principles. Standard rules from `language-standards.md`, `backend/service-rules.md`, and `backend/verification.md` always apply — do not repeat them.]

- [Task-specific principle, e.g., "Greenfield-first: no data migration/backfill SQL"]
- [Another task-specific principle]

## Terminology

- **[Term]**: [Definition as used in this task context]

## Current State Analysis

[What works, what's broken, what's missing. Use bullet points with file + line references.]

- `path/to/file.ts` L47: does X but should do Y.

## Proposed Solution

[Narrative description of the approach. Keep it concise — details go in Patterns to Follow.]

## Patterns to Follow

### [Pattern Name]

```typescript
// Code snippet showing the target pattern
```

## Functions to Change

| File | Line(s) | Change |
|------|---------|--------|
| `path/to/file.ts` | 47 | [Specific change description] |

## Related Files

| File | Note |
|------|------|
| `path/to/related.ts` | [Why this file is relevant but not directly changed] |

## Agent Do / Don't (This Task)

[Standard Do/Don't from `backend/verification.md` apply once loaded. List only **task-specific** additions here.]

### Do

- [Task-specific action, e.g., "Run `make -C backend db-reset` to regenerate canonical init migration"]

### Do Not

- [Task-specific prohibition, e.g., "Add data backfill SQL to the init migration"]

## Manual Review Checklist

Per `backend/verification.md` § "Rules not yet enforced by tooling" — list only items that apply to this task, with concrete details (column names, aggregation patterns, cast guards):

- [ ] [Applicable rule + task-specific description]

[Remove this section if no non-tooling rules apply.]

---

# Consolidated Checklist

## Completed

- [ ] [Pre-existing completed work, if any]

## Phase 0: [Scaffolding / Schema / Setup]

- [ ] [Task-specific scaffolding step]
- [ ] **Gate**: `make -C backend check` passes.

## Phase 1: [Core Implementation]

- [ ] [Task 1]
- [ ] [Task 2]
- [ ] **Gate**: `make -C backend check` passes.
- [ ] **Gate**: `make -C backend dead-exports` — no orphaned exports.

## Phase 2: [Migration / Data / Integration]

- [ ] [Task 1]
- [ ] **Gate**: `make -C backend check` passes.

## Phase 3: Tests and Verification

- [ ] [Update/add integration tests]
- [ ] **Gate**: `make -C backend test` — full pass.
- [ ] **Gate**: `make -C backend audit` — full pass (check + dead-exports + duplicates).
- [ ] Complete Manual Review Checklist (above).

## Stretch Goals

- [ ] [Nice-to-have that won't block completion]

## Success Criteria

- [ ] `make -C backend audit` passes.
- [ ] `make -C backend test` passes — all integration tests green.
- [ ] [Task-specific observable outcome]
- [ ] [Another task-specific observable outcome]
