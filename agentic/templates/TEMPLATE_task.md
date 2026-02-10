# Task Plan Template

> Use this template for all implementation plans under `agentic/tasks/`.

---

# [TASK_TITLE]

## Problem Statement

[What user-visible behavior needs to change. 2-3 sentences max.]

## Workflow Principles

- [Key behavioral rule that guides implementation decisions]
- [Another principle, e.g., "Confirmed clusters only for suggestion eligibility"]

## Terminology

- **[Term]**: [Definition as used in this task context]

## Current State Analysis

[What works, what's broken, what's missing. Use bullet points.]

- [Component/endpoint] does X but should do Y.
- [Frontend/backend] currently [behavior]. This conflicts with [requirement].

## Proposed Solution

[Narrative description of the approach. Keep it concise — details go in Patterns to Follow.]

## Patterns to Follow

### [Pattern Name]

```javascript
 Code snippet showing the pattern to implement
```

## Functions to Change

| File | Line | Change |
| `path/to/file.ts` | 47 | [Specific change description] |

## Related Files

| File | Note |
| --- | --- |
| `path/to/related.ts` | [Why this file is relevant but not directly changed] |

---

# Consolidated Checklist

## Completed

- [ ] [Pre-existing completed work, if any]

## Phase 0: Scaffolding

- [ ] Add interface/method signatures with type hints and docstrings.
- [ ] Add `raise NotImplementedError("TODO: ...")` stubs.

## Phase 1: [Description]

- [ ] [Task 1]
- [ ] [Task 2]

## Phase 2: [Description]

- [ ] [Task 1]
- [ ] [Task 2]

## Phase 3: Tests

- [ ] [Unit test coverage]
- [ ] [Integration test coverage]
- [ ] [Frontend test coverage]

## Stretch Goals

- [ ] [Nice-to-have that won't block completion]

## Success Criteria

- [ ] [Observable outcome that proves the task is done]
- [ ] [Another observable outcome]
