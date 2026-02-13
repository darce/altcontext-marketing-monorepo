# Verification and Agent Rules of Engagement

## Verification Gates

Domain-specific gates are in the respective subdirectory:

- Frontend: [`frontend/verification.md`](./frontend/verification.md)
- Backend: [`backend/verification.md`](./backend/verification.md)

## Agent Rules of Engagement

### Do

- Keep builds deterministic and fast by default.
- Keep backend integration off the paint-critical path.
- Run quality gates before deploys and atlas packing.

### Do Not

- Run raw multi-step shell sequences when a Make target exists — use the Makefile.
- Call `cd backend && fly deploy` directly — use `make -C backend fly-deploy` so quality gates run first.

## Tool-Calling Conventions

All orchestration in this monorepo flows through **Makefiles** (`frontend/Makefile`, `backend/Makefile`). This standardises the interface for both humans and agents.

### Rules

1. **Use Make targets for multi-step workflows.** A single `make` invocation handles install gating, dependency ordering, and sequencing. Never replicate that logic in ad-hoc shell commands.
2. **Use npm scripts for single-step operations.** `npm run lint:fix`, `npm run format:write`, etc. are fine to call directly when only one step is needed.
3. **Use flyctl through the backend Makefile.** `make -C backend fly-deploy` runs quality gates before deploy. Only use bare `fly` commands for one-off inspection (`fly status`, `fly logs`).
4. **Use git / gh directly.** Git operations are atomic enough that Makefile wrapping adds no value — except `make -C backend pr` for convenience.
5. **Environment variables pass through Make.** Use `make -C frontend build-full VERBOSE=1 LIMIT=100` — the Makefile exports them to npm.
6. **Run from the monorepo root with `-C`.** `make -C frontend <target>` and `make -C backend <target>` keep the cwd correct without requiring `cd`.

### Target Naming Convention

| Pattern | Meaning | Examples |
|---------|---------|----------|
| `verb` | Default composite action | `build`, `deploy`, `dev` |
| `noun` | Data/asset group | `data`, `assets` |
| `noun-verb` | Scoped action | `data-recrop`, `db-reset`, `fly-deploy` |
| `check` | All quality gates (no build) | `check` |
| `ci` | Full CI pipeline | `ci` |
| `help` | List targets with descriptions | `help` |
