# Backend Verification

## Build and Quality Gates

```sh
make -C backend check            # typecheck + lint + format
make -C backend audit            # check + dead-exports + duplicates (full)
make -C backend ci               # quality gates + migrate deploy
```

### Additional analysis tools

```sh
make -C backend dead-exports     # ts-prune: find exports with zero consumers
make -C backend duplicates       # jscpd: detect copy-paste clones (≥ 50 tokens / 6 lines)
```

## Agent Do / Don't (Backend)

### Do

- Keep backend integration off the paint-critical path.
- Run quality gates before every deploy — use `make -C backend fly-deploy`.
- Run `make -C backend check` before marking any implementation task complete.

### Do Not

- Run raw multi-step shell sequences when a Make target exists — use the Makefile.
- Call `cd backend && fly deploy` directly — use `make -C backend fly-deploy` so quality gates run first.
- Spend inference tokens checking for violations that `typecheck`, `lint`, or `format` catch deterministically — run the tool first.

## Task Plan Requirements

Every backend task plan (under `agentic/tasks/backend-tasks/`) must include:

1. **Gate cadence**: `make -C backend check` after each implementation phase. `make -C backend audit` after the final phase (before marking the task complete).
2. **Manual Review Checklist**: list which items from "Rules not yet enforced by tooling" (below) apply to the task. Include concrete descriptions — column names, aggregation patterns, cast guards — not just the generic rule name.
3. **Task-specific Agent Do / Don't**: add prohibitions and requirements beyond the standard set above that are unique to the task (e.g. "do not add backfill SQL to the init migration").

Use [`TEMPLATE_backend_task.md`](../../templates/TEMPLATE_backend_task.md) as the structural scaffold.

## Deterministic Tool Coverage

The following language-standard rules are enforced automatically by existing tooling. Agents and reviewers should run these gates rather than manually inspecting for violations.

| Rule | Enforced by | Command |
|---|---|---|
| No floating promises | ESLint `@typescript-eslint/no-floating-promises` | `npm --prefix backend run lint` |
| Consistent type imports | ESLint `@typescript-eslint/consistent-type-imports` | `npm --prefix backend run lint` |
| No unused variables | ESLint `@typescript-eslint/no-unused-vars` | `npm --prefix backend run lint` |
| No explicit `any` | ESLint `@typescript-eslint/no-explicit-any` | `npm --prefix backend run lint` |
| Arrow callbacks | ESLint `prefer-arrow-callback` | `npm --prefix backend run lint` |
| `node:` prefix on builtins | ESLint `no-restricted-imports` | `npm --prefix backend run lint` |
| Strict types (no implicit any, strict null checks) | `tsconfig.json` `"strict": true` | `npm --prefix backend run typecheck` |
| No unchecked indexed access | `tsconfig.json` `"noUncheckedIndexedAccess": true` | `npm --prefix backend run typecheck` |
| Formatting consistency | Prettier | `npm --prefix backend run format` |
| Dead exports | `ts-prune` | `npm --prefix backend run dead-exports` |
| Code duplication | `jscpd` | `npm --prefix backend run duplicates` |

### Rules not yet enforced by tooling (require manual review)

These rules from `language-standards.md` cannot be caught by the current toolchain and require human or agent review:

- Aggregate percentile correctness (semantic, not syntactic)
- Metric column populated from real data vs. hardcoded stub
- Column/field names match semantic data source
- No blind casts on untrusted data
- Shared schemas not duplicated (jscpd catches exact clones but not near-duplicates with different error messages)
- Use write results inside transactions instead of re-reading
